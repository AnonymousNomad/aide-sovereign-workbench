// Desktop Policy Hook tests (aide-inhouse-only-policy-hook). The hook
// is the in-house-only gate: cipher v1 is the default, BYOK providers
// are rejected, override is per-call and capped at 3 per session.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fsp } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDesktopPolicyHook, DesktopPolicyHookError } = require('../../node/src/services/desktop-policy-hook.mjs');

let dir: string = '';

function makeRuntime(replyFor: string | ((m: any, o: any) => string), opts?: { delayMs?: number; throwError?: Error }) {
  const _opts = opts || {};
  const calls: Array<{ messages: any; opts: any }> = [];
  return {
    calls,
    chat: async function(m: any, o: any) {
      calls.push({ messages: m, opts: o });
      if (_opts.delayMs) await new Promise<void>(function(r){ setTimeout(r, _opts.delayMs); });
      if (_opts.throwError) throw _opts.throwError;
      return typeof replyFor === 'function' ? (replyFor as (m: any, o: any) => string)(m, o) : replyFor;
    }
  };
}

beforeEach(async function() {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aide-dph-'));
  const gp = path.join(dir, '.aide', 'desktop', 'grants.json');
  await fsp.mkdir(path.dirname(gp), { recursive: true });
  await fsp.writeFile(gp, JSON.stringify({
    version: 1, enabled: true,
    grants: { apps: ['notepad.exe'], roots: [dir], window_titles: [] },
    session_started_at: new Date().toISOString(),
    ttl_minutes: 10, approved_by: 'operator-wizard'
  }));
});

afterEach(async function() {
  await fsp.rm(dir, { recursive: true, force: true }).catch(function(){});
});

test('cipher proposal: parses a well-formed desktop_action and returns executed', async function() {
  const runtime = makeRuntime('<desktop_action>\nop: list_windows\nnote: peek the desktop\n</desktop_action>\nconfidence: 0.9');
  const hook = createDesktopPolicyHook({ workspace: dir, runtime, sessionId: 's1' });
  const p = await hook.propose({ action_hint: 'list windows' });
  assert.equal(p.op, 'list_windows');
  assert.equal(p.confidence, 0.9);
  assert.equal(p.decision, 'executed');
  assert.equal(p.modelId, 'aide-cipher-4b');
  assert.equal(runtime.calls.length, 1);
});

test('low confidence returns decision=pending, not executed', async function() {
  const runtime = makeRuntime('<desktop_action>\nop: launch_app\ntarget: notepad\n</desktop_action>\nconfidence: 0.2');
  const hook = createDesktopPolicyHook({ workspace: dir, runtime });
  const p = await hook.propose({ action_hint: 'open notepad' });
  assert.equal(p.decision, 'pending');
});

test('OVERRIDE_NEEDS_REASON: byok override is rejected with no reason', async function() {
  const runtime = makeRuntime('<desktop_action>\nop: list_windows\n</desktop_action>');
  const hook = createDesktopPolicyHook({ workspace: dir, runtime });
  await assert.rejects(
    function() { return hook.propose({ action_hint: 'list', overrideModel: 'gpt-5', overrideReason: '' }); },
    function(err: any) { return err instanceof DesktopPolicyHookError && err.code === 'OVERRIDE_NEEDS_REASON'; }
  );
  assert.equal(runtime.calls.length, 0);
});

test('OVERRIDE_LIMIT: 4th override in one session is rejected', async function() {
  const runtime = makeRuntime('<desktop_action>\nop: list_windows\n</desktop_action>');
  const hook = createDesktopPolicyHook({ workspace: dir, runtime, maxOverride: 3 });
  for (let i = 0; i < 3; i++) {
    await hook.propose({ action_hint: 'list', overrideModel: 'gpt-5', overrideReason: 'test override' });
  }
  await assert.rejects(
    function() { return hook.propose({ action_hint: 'list', overrideModel: 'gpt-5', overrideReason: 'fourth try' }); },
    function(err: any) { return err instanceof DesktopPolicyHookError && err.code === 'OVERRIDE_LIMIT'; }
  );
  assert.equal(runtime.calls.length, 3);
});

test('POLICY_MODEL_NOT_READY: hook refuses when runtime.chat is missing', async function() {
  const hook = createDesktopPolicyHook({ workspace: dir, runtime: { calls: [], chat: null } });
  await assert.rejects(
    function() { return hook.propose({ action_hint: 'list windows' }); },
    function(err: any) { return err instanceof DesktopPolicyHookError && err.code === 'POLICY_MODEL_NOT_READY'; }
  );
});

test('POLICY_INVALID_OP: cipher emitting a bad op is rejected', async function() {
  const runtime = makeRuntime('<desktop_action>\nop: shutdown_computer\n</desktop_action>\nconfidence: 1.0');
  const hook = createDesktopPolicyHook({ workspace: dir, runtime });
  await assert.rejects(
    function() { return hook.propose({ action_hint: 'do something' }); },
    function(err: any) { return err instanceof DesktopPolicyHookError && err.code === 'POLICY_INVALID_OP'; }
  );
});

test('POLICY_RESPONSE_UNPARSEABLE: cipher emitting prose is rejected', async function() {
  const runtime = makeRuntime('I think the best thing to do is nothing.');
  const hook = createDesktopPolicyHook({ workspace: dir, runtime });
  await assert.rejects(
    function() { return hook.propose({ action_hint: 'list' }); },
    function(err: any) { return err instanceof DesktopPolicyHookError && err.code === 'POLICY_RESPONSE_UNPARSEABLE'; }
  );
});

test('POLICY_MODEL_FAILED: a thrown cipher error becomes a structured rejection', async function() {
  const runtime = makeRuntime('', { throwError: new Error('cipher 502') });
  const hook = createDesktopPolicyHook({ workspace: dir, runtime });
  await assert.rejects(
    function() { return hook.propose({ action_hint: 'list' }); },
    function(err: any) { return err instanceof DesktopPolicyHookError && err.code === 'POLICY_MODEL_FAILED'; }
  );
});

test('overrides are recorded in the trajectory file (training gold)', async function() {
  const runtime = makeRuntime('<desktop_action>\nop: list_windows\n</desktop_action>');
  const hook = createDesktopPolicyHook({ workspace: dir, runtime, sessionId: 'sess-with-override' });
  await hook.propose({ action_hint: 'list', overrideModel: 'gpt-5', overrideReason: 'debug-only' });
  const trajFile = path.join(dir, '.aide', 'desktop', 'trajectories', 'policy-hook', 'sess-with-override.jsonl');
  const content = await fsp.readFile(trajFile, 'utf8');
  const row = JSON.parse(content.trim().split('\n').pop() || '{}');
  assert.equal(row.kind, 'policy-hook-call');
  assert.equal(row.outcome, 'executed');
  assert.equal(row.override, true);
  assert.equal(row.model, 'gpt-5');
  assert.equal(row.override_reason, 'debug-only');
});

test('status() reports the allowlist, threshold, and override counter', function() {
  const runtime = makeRuntime('ignored');
  const hook = createDesktopPolicyHook({ workspace: dir, runtime, modelId: 'cipher' });
  const s = hook.status();
  assert.equal(s.modelId, 'cipher');
  assert.ok(s.allowlist.includes('cipher'));
  assert.ok(s.allowlist.includes('aide-cipher-4b'));
  assert.equal(s.maxOverride, 3);
  assert.equal(s.overrides.count, 0);
});

