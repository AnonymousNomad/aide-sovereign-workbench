import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { pairServiceFixture } from './authority-fixture.ts';

const require = createRequire(import.meta.url);

const { parseDesktopAction, classForOp, desktopActionPromptHint } =
  require('../../node/src/services/desktop-policy.mjs');
const { createDesktopControl } = require('../../node/src/services/desktop-control.mjs');
const { createAgentTools, ToolError } = require('../../node/src/services/agent-tools.mjs');

let dir: string;
let desktop: ReturnType<typeof createDesktopControl>;
let fixture: Awaited<ReturnType<typeof pairServiceFixture>>;
let actionSequence = 0;

// Pure-parser unit tests — no live desktop, no service. These define the DSL
// the agent's <desktop_action> blocks must conform to.
test('parseDesktopAction accepts a well-formed launch_app proposal', () => {
  const proposal = parseDesktopAction(
    '<desktop_action>\nop: launch_app\ntarget: notepad\nnote: open Notepad\n</desktop_action>'
  );
  assert.equal(proposal.op, 'launch_app');
  assert.equal(proposal.target, 'notepad');
  assert.equal(proposal.note, 'open Notepad');
  assert.equal(proposal.class, 'OPEN');
  assert.deepEqual(proposal.risks, ['starts-a-process']);
});

test('parseDesktopAction accepts list_windows without a target', () => {
  const proposal = parseDesktopAction('<desktop_action>\nop: list_windows\n</desktop_action>');
  assert.equal(proposal.op, 'list_windows');
  assert.equal(proposal.class, 'READ');
  assert.deepEqual(proposal.risks, []);
});

test('parseDesktopAction accepts move_file with destination', () => {
  const proposal = parseDesktopAction(
    '<desktop_action>\nop: move_file\ntarget: C:\\Users\\o\\a.txt\ndestination: C:\\Users\\o\\b.txt\n</desktop_action>'
  );
  assert.equal(proposal.op, 'move_file');
  assert.equal(proposal.destination, 'C:\\Users\\o\\b.txt');
  assert.equal(proposal.class, 'DESTRUCTIVE');
});

test('parseDesktopAction tolerates a missing closing tag and CRLF', () => {
  const proposal = parseDesktopAction(
    '<desktop_action>\r\nop: focus_window\r\ntarget: AIDE Sovereign Workbench'
  );
  assert.equal(proposal.op, 'focus_window');
  assert.equal(proposal.target, 'AIDE Sovereign Workbench');
});

test('parseDesktopAction rejects unknown ops', () => {
  assert.throws(
    () => parseDesktopAction('<desktop_action>\nop: delete_everything\ntarget: C:\\\n</desktop_action>'),
    (err: unknown) => (err as { code: string }).code === 'UNKNOWN_OP'
  );
});

test('parseDesktopAction rejects unknown fields (privilege-escalation guard)', () => {
  assert.throws(
    () => parseDesktopAction('<desktop_action>\nop: launch_app\ntarget: x\napproved: true\n</desktop_action>'),
    (err: unknown) => (err as { code: string }).code === 'UNKNOWN_FIELD'
  );
});

test('parseDesktopAction rejects duplicate fields', () => {
  assert.throws(
    () =>
      parseDesktopAction(
        '<desktop_action>\nop: launch_app\ntarget: a\ntarget: b\n</desktop_action>'
      ),
    (err: unknown) => (err as { code: string }).code === 'DUPLICATE_FIELD'
  );
});

test('parseDesktopAction requires destination for move_file', () => {
  assert.throws(
    () => parseDesktopAction('<desktop_action>\nop: move_file\ntarget: a.txt\n</desktop_action>'),
    (err: unknown) => (err as { code: string }).code === 'MISSING_DESTINATION'
  );
});

test('parseDesktopAction requires target for mutating ops', () => {
  assert.throws(
    () => parseDesktopAction('<desktop_action>\nop: launch_app\n</desktop_action>'),
    (err: unknown) => (err as { code: string }).code === 'MISSING_TARGET'
  );
});

test('parseDesktopAction rejects oversize target', () => {
  const big = 'x'.repeat(501);
  assert.throws(
    () => parseDesktopAction(`<desktop_action>\nop: launch_app\ntarget: ${big}\n</desktop_action>`),
    (err: unknown) => (err as { code: string }).code === 'TARGET_TOO_LONG'
  );
});

test('parseDesktopAction rejects empty body', () => {
  assert.throws(
    () => parseDesktopAction('<desktop_action></desktop_action>'),
    (err: unknown) => (err as { code: string }).code === 'MISSING_OP'
  );
});

// End-to-end: agent tool calls the desktop service via the integration. The
// loop and the desktop service both require canonical authority now, so the
// fixture pairs an operator and approves each exact operation as it is
// proposed: once for the agent.tool call, once for the desktop.action it
// performs.
interface ToolHarness {
  tools: Array<{ name: string; execute: (args: Record<string, string>, execution?: unknown) => Promise<{ ok: boolean; output: string }> }>;
}

function createHarness(withDesktop = true): ToolHarness {
  const desktopAdapter = withDesktop
    ? {
        act: (request: Record<string, unknown>) => {
          // The tool passes destination/note keys that may be undefined; the
          // operation digest only binds plain JSON values, so the approved
          // body drops undefined keys before both prepare and act.
          const body = JSON.parse(JSON.stringify(request)) as Record<string, unknown>;
          return fixture.approveAndExecute('desktop.action', body, `dp-action-${++actionSequence}`,
            execution => desktop.act(body, execution));
        }
      }
    : null;
  return createAgentTools({ workspace: dir, rg: null, desktop: desktopAdapter, authority: fixture.authority });
}

async function runDesktopAction(harness: ToolHarness, args: Record<string, string>, taskId: string) {
  const tool = harness.tools.find(entry => entry.name === 'desktop_action');
  assert.ok(tool, 'desktop_action must be registered with the agent tool set');
  return fixture.approveAndExecute('agent.tool', { name: 'desktop_action', args }, taskId,
    execution => tool.execute(args, execution));
}

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-dp-'));
  fixture = await pairServiceFixture(dir);
  desktop = createDesktopControl({ workspace: dir, authority: fixture.authority });
  // Grant list_windows (read-only) + notepad for the happy-path tests. The
  // manifest write itself is an approved exact desktop.grants operation.
  const grants = {
    version: 1,
    enabled: true,
    grants: { apps: ['notepad.exe'], roots: [dir], window_titles: [] },
    session_started_at: new Date().toISOString(),
    ttl_minutes: 10,
    approved_by: 'operator-wizard'
  };
  await fixture.approveAndExecute('desktop.grants', grants, 'dp-grants', execution => desktop.setGrants(grants, execution));
});

after(async () => {
  if (fixture && desktop) {
    await fixture.approveAndExecute('desktop.panic', {}, 'dp-panic-final', execution => desktop.panic(execution));
    fixture.authority.control.close();
  }
  await fs.rm(dir, { recursive: true, force: true });
});

test('agent tool: list_windows with approved=true executes (granted class)', { skip: process.platform !== 'win32' ? 'list_windows spawns powershell.exe — Windows-only capability; the Windows battery is the live proof' : false }, async () => {
  const harness = createHarness();
  // The list_windows op calls tasklist + powershell — on this machine it
  // should produce SOME output (may be empty, that's fine — we just need ok).
  const result = await runDesktopAction(harness, {
    action: '<desktop_action>\nop: list_windows\n</desktop_action>',
    approved: 'true'
  }, 'dp-tool-list-windows');
  // The act() call on the desktop service returns decision: 'executed'.
  // We don't assert the output content (it varies by what's running) — just
  // that the tool's adapter returned ok=true.
  assert.equal(result.ok, true);
  assert.match(String(result.output), /^executed list_windows \(/);
});

test('agent tool: refuse without approved:true (NO_APPROVAL)', async () => {
  const harness = createHarness();
  await assert.rejects(
    () => runDesktopAction(harness, {
      action: '<desktop_action>\nop: launch_app\ntarget: notepad\n</desktop_action>',
      approved: 'false'
    }, 'dp-tool-no-approval'),
    (err: unknown) => (err as { code: string }).code === 'NO_APPROVAL'
  );
});

test('agent tool: refuse with a target outside grants (NOT_ALLOWLISTED)', async () => {
  const harness = createHarness();
  await assert.rejects(
    () => runDesktopAction(harness, {
      action: '<desktop_action>\nop: launch_app\ntarget: cmd.exe\n</desktop_action>',
      approved: 'true'
    }, 'dp-tool-not-allowlisted'),
    (err: unknown) => (err as { code: string }).code === 'NOT_ALLOWLISTED'
  );
});

test('agent tool: refuse malformed XML (VALIDATION)', async () => {
  const harness = createHarness();
  await assert.rejects(
    () => runDesktopAction(harness, { action: 'no block here', approved: 'true' }, 'dp-tool-missing-tag'),
    (err: unknown) => (err as { code: string }).code === 'MISSING_TAG'
  );
});

test('agent tool: refuse with NO_APPROVAL when approved is missing entirely', async () => {
  const harness = createHarness();
  await assert.rejects(
    () => runDesktopAction(harness, {
      action: '<desktop_action>\nop: list_windows\n</desktop_action>'
    } as unknown as Record<string, string>, 'dp-tool-missing-approved'),
    (err: unknown) => (err as { code: string }).code === 'NO_APPROVAL'
  );
});

test('agent tool: refuse when desktop service is not wired (NOT_READY)', async () => {
  const harness = createHarness(false);
  await assert.rejects(
    () => runDesktopAction(harness, {
      action: '<desktop_action>\nop: list_windows\n</desktop_action>',
      approved: 'true'
    }, 'dp-tool-not-ready'),
    (err: unknown) => (err as { code: string }).code === 'NOT_READY'
  );
});

test('agent tool: trajectory is recorded even on refusal (training gold)', async () => {
  const harness = createHarness();
  // attempt an ungranted op — act() will throw NOT_ALLOWLISTED, but the
  // trajectory file under .aide/desktop/trajectories/<session>.jsonl must
  // still be written (refusal-recovery is a trained skill per the doctrine).
  let caught: unknown = null;
  try {
    await runDesktopAction(harness, {
      action: '<desktop_action>\nop: launch_app\ntarget: cmd.exe\nnote: refused for training\n</desktop_action>',
      approved: 'true'
    }, 'dp-tool-trajectory');
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof ToolError);
  const trajDir = path.join(dir, '.aide', 'desktop', 'trajectories');
  const files = await fs.readdir(trajDir).catch(() => [] as string[]);
  assert.ok(files.length > 0, 'trajectory file must be written even on refusal');
  const content = await fs.readFile(path.join(trajDir, files[0] as string), 'utf8');
  assert.match(content, /NOT_ALLOWLISTED/);
  assert.match(content, /refused for training/);
});

test('panic() also stops further agent-driven desktop actions', async () => {
  await fixture.approveAndExecute('desktop.panic', {}, 'dp-panic-mid', execution => desktop.panic(execution));
  const harness = createHarness();
  await assert.rejects(
    () => runDesktopAction(harness, {
      action: '<desktop_action>\nop: list_windows\n</desktop_action>',
      approved: 'true'
    }, 'dp-tool-panic'),
    (err: unknown) => (err as { code: string }).code === 'PANIC'
  );
});


test('classForOp returns the documented class for every op', () => {
  assert.equal(classForOp('launch_app'), 'OPEN');
  assert.equal(classForOp('move_file'), 'DESTRUCTIVE');
  assert.equal(classForOp('list_windows'), 'READ');
  assert.equal(classForOp('not-a-real-op'), 'WRITE');
});

test('desktopActionPromptHint documents the DSL for the system prompt', () => {
  const hint = desktopActionPromptHint();
  assert.match(hint, /launch_app/);
  assert.match(hint, /<desktop_action>/);
  assert.match(hint, /Deny-by-default/);
});
