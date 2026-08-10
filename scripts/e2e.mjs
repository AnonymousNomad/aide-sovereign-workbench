import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const daemon = spawn(process.execPath, ['daemon/server.mjs'], { cwd: process.cwd(), env: { ...process.env, AIDE_WORKSPACE: process.cwd(), AIDE_DAEMON_PORT: '4879' }, stdio: 'ignore' });
try {
  let response;
  for (let i = 0; i < 20; i += 1) { try { response = await fetch('http://127.0.0.1:4879/health'); if (response.ok) break; } catch {} await delay(50); }
  assert.equal(response?.status, 200);
  for (const endpoint of ['/api/models/status', '/api/community', '/api/training/status', '/api/replays']) { const result = await fetch(`http://127.0.0.1:4879${endpoint}`); assert.equal(result.status, 200, endpoint); }
  console.log('AIDE daemon end-to-end smoke passed');
} finally { daemon.kill('SIGTERM'); }
