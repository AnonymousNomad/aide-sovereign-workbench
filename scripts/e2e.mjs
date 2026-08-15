import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const daemon = spawn(process.execPath, ['daemon/server.mjs'], { cwd: process.cwd(), env: { ...process.env, AIDE_WORKSPACE: process.cwd(), AIDE_DAEMON_PORT: '4879' }, stdio: 'ignore' });
try {
  let response;
  for (let i = 0; i < 20; i += 1) { try { response = await fetch('http://127.0.0.1:4879/health'); if (response.ok) break; } catch {} await delay(50); }
  assert.equal(response?.status, 200);
  for (const endpoint of ['/api/models/status', '/api/providers', '/api/community', '/api/training/status', '/api/replays', '/api/workspace/tree', '/api/blueprint', '/api/academy', '/api/plugins', '/api/plugins/presets', '/api/tasks', '/api/session', '/api/artifacts']) { const result = await fetch(`http://127.0.0.1:4879${endpoint}`); assert.equal(result.status, 200, endpoint); }
  const ready = await fetch('http://127.0.0.1:4879/api/model/ready?id=qwen-coder-1.5b-q4');
  assert.equal(ready.status, 200);
  assert.equal(typeof (await ready.json()).ready, 'boolean');
  const terminal = await fetch('http://127.0.0.1:4879/api/terminal/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ program: 'node', args: ['--version'], approved: true }) });
  assert.equal(terminal.status, 200);
  const echo = await fetch('http://127.0.0.1:4879/api/terminal/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ program: 'echo', args: ['terminal-ok'], approved: true }) });
  assert.equal(echo.status, 200);
  assert.match((await echo.json()).stdout, /terminal-ok/);
  console.log('AIDE daemon end-to-end smoke passed');
} finally { daemon.kill('SIGTERM'); }
