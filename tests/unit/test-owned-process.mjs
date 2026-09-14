import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createDesktopControl } from '../../node/src/services/desktop-control.mjs';
import { createExecutionAuthority } from '../../node/src/services/execution-authority.mjs';

test('panic never treats an allowlisted image as an owned process', async () => {
  const workspace = await fs.mkdtemp(path.join(process.platform === 'win32' ? 'E:/pip_temp/opencode' : os.tmpdir(), 'phase2a-panic-'));
  const authority = createExecutionAuthority({ workspace, record: async () => ({ persisted: true }) });
  const origin = 'http://fixture.local';
  const session = await authority.pair(authority.control.createPairing(origin), origin);
  const owner = authority.authenticate(session.token, origin);
  const desktop = createDesktopControl({ workspace, authority });
  async function approved(kind, body, execute) {
    const input = { workspace, taskId: 'panic-regression', kind, args: { body } };
    const op = await authority.prepare(owner, input);
    await authority.decide(owner, op.operation_id, 'approve');
    return authority.execute(owner, op.operation_id, input, (_descriptor, execution) => execute(execution));
  }
  const grants = { enabled: true, grants: { apps: ['fixture-unrelated.exe'], roots: [workspace], window_titles: [] }, ttl_minutes: 10 };
  await approved('desktop.grants', grants, execution => desktop.setGrants(grants, execution));
  const captured = [];
  const original = childProcess.execFile;
  childProcess.execFile = function (file, args, options, callback) {
    captured.push({ file, args });
    // Captured executor only. Never launch taskkill against an actual process.
    queueMicrotask(() => callback(null, '', ''));
    return { pid: undefined };
  };
  syncBuiltinESMExports();
  try {
    const result = await approved('desktop.panic', {}, execution => desktop.panic(execution));
    console.log(JSON.stringify({ workspace, captured, result, realProcessesTerminated: 0 }));
    assert.deepEqual({ commands: captured, killed: result.children_killed }, { commands: [], killed: 0 },
      'panic attempted termination without any owned child');
  } finally {
    childProcess.execFile = original;
    syncBuiltinESMExports();
  }
});
