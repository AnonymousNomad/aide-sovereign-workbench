import assert from 'node:assert/strict';
import { launchSupervisedStack } from '../tests/helpers/supervised-stack.mjs';

// End-to-end surface check of the canonical stack: the facade is the only
// operator entry point, every transport caller is paired, and terminal
// executions run as explicitly approved exact operations.
const stack = await launchSupervisedStack({ workspace: process.cwd() });
try {
  // /api/blueprint was dropped from the canonical surface (no TS route, no
  // legacy operation policy, no UI consumer); the remaining list is the
  // operator-reachable surface.
  for (const endpoint of ['/api/models/status', '/api/providers', '/api/community', '/api/training/status', '/api/replays', '/api/workspace/tree', '/api/academy', '/api/plugins', '/api/plugins/presets', '/api/tasks', '/api/session', '/api/artifacts']) {
    const legacyOwned = endpoint === '/api/training/status';
    // The first models/status call may run the cached engine/python probe; on
    // slow local disks that can exceed the default budget without failing.
    const signal = endpoint === '/api/models/status' ? AbortSignal.timeout(120000) : undefined;
    const result = await stack.json('facade', 'GET', endpoint, { envelope: !legacyOwned, signal });
    assert.equal(result.status, 200, `${endpoint} -> ${result.status} ${JSON.stringify(result.body).slice(0, 160)}`);
  }

  const ready = await stack.json('facade', 'GET', '/api/model/ready?id=qwen-coder-1.5b-q4');
  assert.equal(ready.status, 200);
  assert.equal(typeof ready.body.data.ready, 'boolean');

  const version = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/terminal/run', body: { program: 'node', args: ['--version'], approved: true } });
  assert.equal(version.status, 200, JSON.stringify(version.body).slice(0, 200));
  const echo = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/terminal/run', body: { program: 'echo', args: ['terminal-ok'], approved: true } });
  assert.equal(echo.status, 200, JSON.stringify(echo.body).slice(0, 200));
  assert.match(echo.body.data.stdout, /terminal-ok/);
  console.log('AIDE daemon end-to-end smoke passed');
} finally {
  await stack.close();
}
