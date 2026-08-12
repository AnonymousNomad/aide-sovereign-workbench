import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const run = promisify(execFile);
const workspace = await mkdtemp(path.join(tmpdir(), 'aide-git-'));
await run('git', ['init', '-q'], { cwd: workspace });
await run('git', ['config', 'user.name', 'AIDE Test'], { cwd: workspace });
await run('git', ['config', 'user.email', 'aide@test.invalid'], { cwd: workspace });
await writeFile(path.join(workspace, 'README.md'), 'base\n'); await run('git', ['add', '.'], { cwd: workspace }); await run('git', ['commit', '-qm', 'base'], { cwd: workspace });
await writeFile(path.join(workspace, 'README.md'), 'changed\n');
const port = '4891'; const daemon = spawn(process.execPath, ['daemon/server.mjs'], { cwd: process.cwd(), env: { ...process.env, AIDE_WORKSPACE: workspace, AIDE_DAEMON_PORT: port }, stdio: 'ignore' });
try {
  for (let i = 0; i < 30; i += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/git/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: ['README.md'], approved: false }) })).status, 500);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/git/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: ['README.md'], approved: true }) })).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/git/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'test change', approved: true }) })).status, 200);
  console.log('git api test passed');
} finally { daemon.kill('SIGTERM'); }
