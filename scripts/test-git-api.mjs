import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const run = promisify(execFile);
const workspace = await mkdtemp(path.join(tmpdir(), 'aide-git-'));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    const port = address && typeof address === 'object' ? address.port : null;
    probe.close(error => error ? reject(error) : resolve(port));
  });
});
await run('git', ['init', '-q'], { cwd: workspace });
await run('git', ['config', 'user.name', 'AIDE Test'], { cwd: workspace });
await run('git', ['config', 'user.email', 'aide@test.invalid'], { cwd: workspace });
await writeFile(path.join(workspace, 'README.md'), 'base\n'); await run('git', ['add', '.'], { cwd: workspace }); await run('git', ['commit', '-qm', 'base'], { cwd: workspace });
await writeFile(path.join(workspace, 'README.md'), 'changed\n');
const port = await freePort(); const daemon = spawn(process.execPath, ['daemon/server.mjs'], { cwd: process.cwd(), env: { ...process.env, AIDE_WORKSPACE: workspace, AIDE_DAEMON_PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
let daemonExit = null;
let daemonError = null;
let daemonStderr = '';
daemon.stderr.on('data', chunk => { daemonStderr = `${daemonStderr}${chunk}`.slice(-4000); });
daemon.once('error', error => { daemonError = `daemon spawn error: ${error.message}`; });
daemon.once('exit', (code, signal) => { daemonExit = `daemon exited before readiness (code=${code}, signal=${signal || 'none'})`; });
try {
  let ready = false;
  for (let i = 0; i < 150; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) { ready = true; break; } } catch {}
    if (daemonError || daemonExit) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, daemonError || daemonExit || `daemon did not become ready within 15 seconds${daemonStderr ? `: ${daemonStderr.trim()}` : ''}`);
  const post = async (route, payload) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.text() };
  };
  assert.equal((await post('/api/git/stage', { paths: ['README.md'], approved: false })).status, 500);
  const staged = await post('/api/git/stage', { paths: ['README.md'], approved: true });
  assert.equal(staged.status, 200, `stage failed: ${staged.body}${daemonStderr ? `\ndaemon stderr: ${daemonStderr}` : ''}`);
  const committed = await post('/api/git/commit', { message: 'test change', approved: true });
  assert.equal(committed.status, 200, `commit failed: ${committed.body}${daemonStderr ? `\ndaemon stderr: ${daemonStderr}` : ''}`);
  console.log('git api test passed');
 } catch (error) {
   if (daemonStderr.trim()) console.error(`[git-api] daemon stderr:\n${daemonStderr.trim()}`);
   throw error;
 } finally { daemon.kill('SIGTERM'); }
