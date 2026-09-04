import assert from 'node:assert/strict';
import net from 'node:net';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stagedRoot = path.join(root, 'desktop', 'resources');
const node = path.join(stagedRoot, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
const launcher = path.join(stagedRoot, 'stack-launcher.mjs');
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-desktop-staged-'));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = address && typeof address === 'object' ? address.port : null;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function killTree(pid) {
  if (!pid) return Promise.resolve();
  if (process.platform !== 'win32') {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    return Promise.resolve();
  }
  return new Promise(resolve => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

const ports = {
  arch: await freePort(),
  legacy: await freePort(),
  facade: await freePort()
};
const modelDir = path.join(workspace, 'models');
await fs.mkdir(modelDir, { recursive: true });
const child = spawn(node, [launcher], {
  cwd: stagedRoot,
  env: {
    ...process.env,
    AIDE_WORKSPACE: workspace,
    AIDE_MODEL_DIR: modelDir,
    AIDE_LLAMA_SERVER: path.join(stagedRoot, 'runtime', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'),
    AIDE_ARCH_PORT: String(ports.arch),
    AIDE_LEGACY_PORT: String(ports.legacy),
    AIDE_DAEMON_PORT: String(ports.legacy),
    AIDE_FACADE_PORT: String(ports.facade)
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
});
let stdout = '';
let stderr = '';
child.stdout.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-8000); });
child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-8000); });

const get = async pathname => {
  const response = await fetch(`http://127.0.0.1:${ports.facade}${pathname}`);
  return { status: response.status, body: await response.text() };
};

async function readChildLogs() {
  const directory = path.join(workspace, '.aide', 'logs');
  const names = await fs.readdir(directory).catch(() => []);
  const logs = [];
  for (const name of names.filter(file => file.startsWith('desktop-') && file.endsWith('.log'))) {
    const content = await fs.readFile(path.join(directory, name), 'utf8').catch(() => '');
    if (content) logs.push(`${name}:\n${content.slice(-4000)}`);
  }
  return logs.join('\n');
}

let passed = false;
try {
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const health = await get('/api/health');
      const legacy = await get('/api/tasks');
      if (health.status === 200 && legacy.status === 200) {
        ready = true;
        break;
      }
    } catch { /* backends are still starting */ }
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, `staged stack did not become ready${stderr ? `\nstderr:\n${stderr}` : ''}`);
  const health = await get('/api/health');
  const models = await get('/api/models/status');
  const legacy = await get('/api/tasks');
  assert.equal(health.status, 200, health.body);
  assert.equal(models.status, 200, models.body);
  assert.equal(legacy.status, 200, legacy.body);
  assert.match(models.body, /models/);
  passed = true;
  console.log(`desktop staged stack smoke passed (ts=${ports.arch}, legacy=${ports.legacy}, facade=${ports.facade})`);
} finally {
  const exitCodeBeforeCleanup = child.exitCode;
  await killTree(child.pid);
  await new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    setTimeout(resolve, 5000);
  });
  const exitCode = child.exitCode;
  const childLogs = await readChildLogs();
  await fs.rm(workspace, { recursive: true, force: true });
  if (!passed && exitCodeBeforeCleanup !== null && exitCodeBeforeCleanup !== 0) {
    throw new Error(`staged stack exited with code ${exitCode}${stdout ? `\nstdout:\n${stdout}` : ''}${stderr ? `\nstderr:\n${stderr}` : ''}${childLogs ? `\nchild logs:\n${childLogs}` : ''}`);
  }
}
