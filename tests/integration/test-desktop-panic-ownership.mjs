import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createOwnedProcesses } from '../../node/src/services/owned-process.mjs';
import { createDesktopControl } from '../../node/src/services/desktop-control.mjs';
import { createExecutionAuthority } from '../../node/src/services/execution-authority.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('owned termination errors and unconfirmed exits are truthful, disarmed, and never retried', async () => {
  for (const mode of ['throw', 'refuse', 'unconfirmed']) {
    const owner = createOwnedProcesses({ terminationTimeoutMs: 20 }); owner.arm();
    const fixture = owner.launch(process.execPath, ['-e', 'process.stdin.resume()'], { stdio: ['pipe', 'ignore', 'ignore'] });
    await fixture.spawned;
    const originalKill = ChildProcess.prototype.kill;
    let ownedChild, attempts = 0;
    ChildProcess.prototype.kill = function () {
      assert.equal(this.pid, fixture.handle.pid);
      ownedChild = this; attempts++;
      if (mode === 'throw') throw new Error('injected native termination failure');
      return mode === 'unconfirmed';
    };
    try {
      const [outcome] = await owner.revoke();
      assert.equal(outcome.status, mode === 'unconfirmed' ? 'unconfirmed' : 'failed');
      assert.equal(outcome.killed, false);
      assert.equal(owner.alive(fixture.handle), true);
      assert.throws(() => owner.launch(process.execPath), /disarmed/);
      assert.deepEqual(await owner.revoke(), [outcome]);
      assert.equal(attempts, 1, 'no hidden retry or PID/image fallback');
      console.log(JSON.stringify({ mode, fixturePid: fixture.handle.pid, outcome, disarmed: true, attempts }));
    } finally {
      ChildProcess.prototype.kill = originalKill;
      // Actual retained child handle, not an inferred PID. Fault injection
      // is removed before test-owned cleanup; await the observed exit.
      assert.ok(ownedChild);
      originalKill.call(ownedChild);
      await fixture.finished;
      assert.equal(owner.alive(fixture.handle), false);
    }
  }
});

test('owned native child termination never targets an unrelated identical command or forged PID handle', async () => {
  const args = ['-e', 'process.stdin.resume()'];
  const options = { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true };
  const unrelated = spawn(process.execPath, args, options);
  const owner = createOwnedProcesses();
  let fixture;
  try {
    await once(unrelated, 'spawn');
    owner.arm();
    fixture = owner.launch(process.execPath, args, options);
    await fixture.spawned;
    assert.equal(owner.alive(fixture.handle), true);
    assert.deepEqual(await owner.terminate({ id: fixture.handle.id, pid: unrelated.pid }), { status: 'unowned', killed: false });
    assert.equal(unrelated.exitCode, null);
    const results = await owner.revoke();
    assert.equal(results.length, 1);
    assert.equal(results[0].killed, true);
    assert.equal(owner.alive(fixture.handle), false);
    assert.equal(unrelated.exitCode, null);
    assert.equal(unrelated.signalCode, null);
    assert.deepEqual(await owner.revoke(), []);
    // Historical identity cannot be repurposed to target the still-live peer.
    assert.equal((await owner.terminate({ ...fixture.handle, pid: unrelated.pid })).killed, false);
    assert.equal(unrelated.exitCode, null);
    owner.arm();
    assert.throws(() => owner.launch(process.execPath, args, { ...options, detached: true }), /detached/);
    assert.equal(owner.snapshot().length, 0);
    console.log(JSON.stringify({ ownedPid: fixture.handle.pid, unrelatedPid: unrelated.pid, sameExecutable: true, sameArguments: true, unrelatedSurvived: true, outcomes: results }));
  } finally {
    await owner.revoke();
    if (unrelated.exitCode === null && unrelated.signalCode === null) {
      const closed = once(unrelated, 'close', { signal: AbortSignal.timeout(5000) });
      unrelated.kill(); await closed;
    }
    assert.ok(unrelated.exitCode !== null || unrelated.signalCode !== null);
  }
});

test('panic racing spawn revokes launch and observes its exit, with no detached survivor', async () => {
  const owner = createOwnedProcesses(); owner.arm();
  const fixture = owner.launch(process.execPath, ['-e', 'process.stdin.resume()'], { stdio: ['pipe', 'ignore', 'ignore'] });
  const rejected = assert.rejects(fixture.spawned, /revoked/);
  const result = await owner.revoke();
  await rejected; await fixture.finished;
  assert.equal(result[0].killed, true);
  assert.equal(owner.snapshot().length, 0);
  assert.throws(() => owner.launch(process.execPath, []), /disarmed/);
});

test('an exited original process handle cannot authorize a new termination', async () => {
  const owner = createOwnedProcesses(); owner.arm();
  const fixture = owner.launch(process.execPath, ['-e', '']);
  await fixture.spawned; await fixture.finished;
  assert.deepEqual(await owner.terminate(fixture.handle), { status: 'exited', killed: false });
  assert.deepEqual(await owner.revoke(), []);
});

test('real desktop grant/action/panic uses canonical approvals and protects identical unrelated child', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-desktop-'));
  const records = [];
  const authority = createExecutionAuthority({ workspace, record: async event => { records.push(event); return { persisted: true }; } });
  const origin = 'http://fixture.local';
  const paired = await authority.pair(authority.control.createPairing(origin), origin);
  const actor = authority.authenticate(paired.token, origin);
  const desktop = createDesktopControl({ workspace, authority });
  let task = 0;
  async function execute(kind, body, fn) {
    const input = { workspace, taskId: `desktop-fixture-${++task}`, kind, args: { body } };
    const op = await authority.prepare(actor, input);
    await authority.decide(actor, op.operation_id, 'approve');
    return authority.execute(actor, op.operation_id, input, (_descriptor, handle) => fn(handle));
  }
  const grants = { enabled: true, grants: { apps: [process.execPath], roots: [workspace], window_titles: [] }, ttl_minutes: 10 };
  const action = { op: 'launch_app', target: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], approved: true };
  const unrelated = spawn(action.target, action.args, { stdio: 'ignore', windowsHide: true });
  try {
    await once(unrelated, 'spawn');
    await assert.rejects(desktop.setGrants(grants), { code: 'FORBIDDEN' });
    await assert.rejects(desktop.act(action, { operation_id: 'forged' }), { code: 'FORBIDDEN' });
    assert.equal((await desktop.status()).tracked_children, 0);
    await execute('desktop.grants', grants, handle => desktop.setGrants(grants, handle));
    const result = await execute('desktop.action', action, handle => desktop.act(action, handle));
    assert.equal(result.ok, true);
    assert.equal(result.assertion.pass, true);
    assert.match(result.assertion.check, /^owned_process_alive:\d+$/);
    assert.equal((await desktop.status()).tracked_children, 1);
    const panic = await execute('desktop.panic', {}, handle => desktop.panic(handle));
    assert.equal(panic.children_killed, 1);
    assert.equal(panic.outcomes[0].status, 'terminated');
    assert.equal(unrelated.exitCode, null); assert.equal(unrelated.signalCode, null);
    assert.equal((await desktop.status()).panicked, true);
    await assert.rejects(execute('desktop.action', action, handle => desktop.act(action, handle)), /panic/i);
    assert.equal((await desktop.status()).tracked_children, 0);
    const again = await execute('desktop.panic', {}, handle => desktop.panic(handle));
    assert.equal(again.children_killed, 0); assert.deepEqual(again.outcomes, []);
    assert.ok(records.some(e => e.decision === 'execution-succeeded' && e.kind === 'desktop.panic'));
    console.log(JSON.stringify({ workspace, unrelatedPid: unrelated.pid, ownedOutcomes: panic.outcomes, unrelatedSurvived: true, repeatedPanicKilled: again.children_killed }));
  } finally {
    await execute('desktop.panic', {}, handle => desktop.panic(handle));
    const ended = once(unrelated, 'close', { signal: AbortSignal.timeout(5000) }); unrelated.kill(); await ended;
    assert.ok(unrelated.exitCode !== null || unrelated.signalCode !== null);
    authority.control.close();
  }
});
