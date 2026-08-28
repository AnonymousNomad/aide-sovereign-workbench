// Architect/Editor pattern tests (aide-architect-editor-pattern). The
// agent loop now supports an opt-in two-call decomposition: the architect
// call returns a `## Plan` block; if no tool calls are emitted, the editor
// call gets the plan as a system-prompt prefix and returns the actual
// tool calls. These tests cover the parser, the loop integration, the
// collapse paths, and the per-session cost cap.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const createAgentLoop = require('../../node/src/services/agent-loop.mjs').createAgentLoop;

// Each test creates its own tmp dir; we rm it in afterEach so the
// `.aide/desktop/trajectories` files written by the loop are cleaned up
// before the next test's dir is created (otherwise the OS rejects the
// rmdir with ENOTEMPTY on Windows).
let dir: string;
async function freshDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'aide-arc-'));
}

async function waitForTerminalState(loop: { status: (id: string) => { state: string; iterations: number; error: string | null } }, sessionId: string, timeoutMs = 5000): Promise<{ state: string; iterations: number; error: string | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = loop.status(sessionId);
    if (s.state !== 'running') return s;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return loop.status(sessionId);
}

beforeEach(async () => { dir = await freshDir(); });
afterEach(async () => {
  // Best-effort cleanup; ignore errors so a single test failure doesn't
  // hide a real bug.
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

test('plain one-call loop still works (architectEditor: false default)', async () => {
  // Without attempt_completion the session hits maxMistakes and goes
  // to state='error'. This is acceptable — the test just proves the
  // plain one-call path is intact.
  const chatFn = async () => '<read_file>\n<path>package.json</path>\n</read_file>';
  const loop = createAgentLoop({ workspace: dir, chatFn, maxIterations: 2, maxMistakes: 3 });
  const { session_id } = loop.start('read package.json', 'act');
  const final = await waitForTerminalState(loop, session_id);
  assert.ok(['aborted', 'error'].includes(final.state), `unexpected terminal state: ${final.state}`);
});

test('architect/editor: two-call path with a plan, then attempt_completion on the editor', async () => {
  // The architect returns a plan (no tool calls); the editor returns
  // attempt_completion so the session terminates cleanly. We assert
  // that the loop did the architect/editor handshake on the FIRST
  // turn (one plan event, two calls) and then exited.
  const calls: Array<string> = [];
  const chatFn = async (): Promise<string> => {
    if (calls.length === 0) {
      calls.push('architect');
      return '## Plan\nRead the package.json and report the version. No edits.';
    }
    if (calls.length === 1) {
      calls.push('editor');
      return '<attempt_completion>\n<result>done</result>\n</attempt_completion>';
    }
    calls.push('extra');
    return '';
  };
  const events: Array<Record<string, unknown>> = [];
  const loop = createAgentLoop({
    workspace: dir,
    chatFn,
    maxIterations: 3,
    maxMistakes: 5,
    architectEditor: true,
    onEvent: (e: Record<string, unknown>) => events.push(e)
  });
  const { session_id } = loop.start('inspect package.json', 'act');
  const final = await waitForTerminalState(loop, session_id);
  // 2 calls: architect + editor (the attempt_completion in editor ends the session)
  assert.equal(calls.length, 2, `expected 2 chat calls, got ${calls.length}: ${JSON.stringify(calls)}`);
  assert.deepEqual(calls, ['architect', 'editor']);
  // 1 plan event
  const planEvents = events.filter(e => e.event === 'plan');
  assert.equal(planEvents.length, 1, 'expected exactly one plan event');
  const planEvent = planEvents[0] as { plan: string; cycle: number; max_cycles: number };
  assert.match(planEvent.plan, /Read the package\.json/);
  assert.equal(planEvent.cycle, 1);
  assert.equal(planEvent.max_cycles, 8);

test('architect collapsed into editor: tool calls directly, no plan, no second call', async () => {
  // The architect immediately emits attempt_completion (a single trivial
  // turn). The loop must use it as-is and NOT call the editor a second
  // time. After the first call the session is done.
  let callCount = 0;
  const chatFn = async (): Promise<string> => {
    callCount += 1;
    return '<attempt_completion>\n<result>trivial</result>\n</attempt_completion>';
  };
  const events: Array<Record<string, unknown>> = [];
  const loop = createAgentLoop({
    workspace: dir,
    chatFn,
    maxIterations: 3,
    maxMistakes: 5,
    architectEditor: true,
    onEvent: (e: Record<string, unknown>) => events.push(e)
  });
  const { session_id } = loop.start('trivial', 'act');
  const final = await waitForTerminalState(loop, session_id);
  assert.equal(callCount, 1, `expected exactly 1 chat call (architect collapsed), got ${callCount}`);
  const planEvents = events.filter(e => e.event === 'plan');
  assert.equal(planEvents.length, 0, 'no plan event when architect collapses into editor');
  assert.equal(final.state, 'done');
});

test('architect/editor cost cap: after 8 cycles the loop falls back to one-call', async () => {
  // Architect turns 1..8 produce plan events; turns 9+ are one-call
  // (no second call, no plan event). attempt_completion on the 8th
  // editor call finishes the session.
  let callCount = 0;
  const chatFn = async (): Promise<string> => {
    callCount += 1;
    if (callCount % 2 === 1) {
      // Architect: plan only.
      return '## Plan\nTry a different approach ' + callCount + '.';
    }
    // Editor: a real tool call. We use list_dir (read-only, no approval)
    // so the loop doesn't get stuck awaiting_approval. End the session
    // on the 8th editor call.
    if (callCount >= 16) return '<attempt_completion>\n<result>end</result>\n</attempt_completion>';
    return '<list_dir>\n<path>.</path>\n</list_dir>';
  };
  const events: Array<Record<string, unknown>> = [];
  const loop = createAgentLoop({
    workspace: dir,
    chatFn,
    maxIterations: 30,
    maxMistakes: 5,
    architectEditor: true,
    onEvent: (e: Record<string, unknown>) => events.push(e)
  });
  const { session_id } = loop.start('iterate', 'act');
  const final = await waitForTerminalState(loop, session_id, 8000);
  // The first 8 architect turns produce 8 plan events; turns 9+ must not.
  const planEvents = events.filter(e => e.event === 'plan');
  assert.ok(planEvents.length <= 8, `expected <= 8 plan events, got ${planEvents.length}`);
  assert.ok(planEvents.length >= 1, 'at least one plan event');
  // The attempt_completion finishes the session.
  assert.equal(final.state, 'done');
});

test('plan-mode + architect/editor compose: plan mode is read-only and architect is no-op', async () => {
  // In plan mode the loop is read-only; architect/editor must NOT fire
  // (no plan event, no second call). The plain read tool runs once and
  // attempt_completion ends the session.
  let callCount = 0;
  const chatFn = async (): Promise<string> => {
    callCount += 1;
    if (callCount === 1) return '<read_file>\n<path>package.json</path>\n</read_file>';
    return '<attempt_completion>\n<result>plan ok</result>\n</attempt_completion>';
  };
  const events: Array<Record<string, unknown>> = [];
  const loop = createAgentLoop({
    workspace: dir,
    chatFn,
    maxIterations: 3,
    maxMistakes: 5,
    architectEditor: true,
    onEvent: (e: Record<string, unknown>) => events.push(e)
  });
  const { session_id } = loop.start('plan only', 'plan');
  await waitForTerminalState(loop, session_id);
  assert.equal(callCount, 2, 'plan mode: 1 read + 1 completion (architect/editor is off in plan mode)');
  const planEvents = events.filter(e => e.event === 'plan');
  assert.equal(planEvents.length, 0, 'no plan event in plan mode');
});

test('empty plan block: fall through to one-call path, no second call', async () => {
  // The architect returns just "## Plan\n" (too short) — parsePlanBlock
  // returns null, the loop treats it as editor output (no second call).
  // The reply parses as no tool calls either, so a mistake is recorded
  // and the loop tries again. The second call returns attempt_completion.
  let callCount = 0;
  const chatFn = async (): Promise<string> => {
    callCount += 1;
    if (callCount === 1) return '## Plan\n'; // too short
    return '<attempt_completion>\n<result>done</result>\n</attempt_completion>';
  };
  const events: Array<Record<string, unknown>> = [];
  const loop = createAgentLoop({
    workspace: dir,
    chatFn,
    maxIterations: 5,
    maxMistakes: 5,
    architectEditor: true,
    onEvent: (e: Record<string, unknown>) => events.push(e)
  });
  const { session_id } = loop.start('short plan', 'act');
  const final = await waitForTerminalState(loop, session_id);
  // 2 calls total: 1 architect (empty plan) + 1 editor (completion).
  assert.equal(callCount, 2, `expected 2 calls, got ${callCount}`);
  const planEvents = events.filter(e => e.event === 'plan');
  assert.equal(planEvents.length, 0, 'no plan event when plan block is empty');
  assert.equal(final.state, 'done');
});

  // The session must finish (done), not abort.
  assert.equal(final.state, 'done');
});
