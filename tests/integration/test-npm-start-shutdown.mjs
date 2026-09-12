import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';

const HOST = '127.0.0.1';
const ROOT = process.cwd();

function listen(server) {
  return new Promise(resolve => server.listen(0, HOST, () => resolve(server.address().port)));
}

async function freePort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${url}: ${last}`);
}

async function portClosed(port) {
  return await new Promise(resolve => {
    const socket = net.connect(port, HOST);
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(true));
  });
}

function listRelevantProcesses() {
  return new Promise(resolve => {
    execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], (err, stdout) => {
      if (err) return resolve([]);
      const lines = stdout.split('\n').filter(Boolean);
      const nodes = [];
      for (const line of lines) {
        const parts = line.split('","').map(s => s.replace(/^"|"$/g, ''));
        const [name, pid] = parts;
        if (name && /node|npm/.test(name.toLowerCase())) nodes.push({ name, pid });
      }
      resolve(nodes);
    });
  });
}

function waitForExit(child, timeoutMs = 20000) {
  if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return Promise.race([
    new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`process ${child.pid} did not exit within ${timeoutMs}ms`)), timeoutMs))
  ]);
}

async function waitForCondition(label, predicate, timeoutMs = 20000, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result.ok) return result.value;
    last = result.reason;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${label} did not become true within ${timeoutMs}ms: ${last}`);
}

async function buildFrontend() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'browser/vite.config.ts'], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', error => reject(error));
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`frontend build failed: ${output.slice(-500)}`));
    });
  });
}

async function runScenario(terminateWrapper) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-npm-start-shutdown-'));
  const ports = {
    ui: await freePort(),
    facade: await freePort(),
    arch: await freePort(),
    legacy: await freePort()
  };
  const env = {
    ...process.env,
    AIDE_WORKSPACE: workspace,
    AIDE_UI_PORT: String(ports.ui),
    AIDE_FACADE_PORT: String(ports.facade),
    AIDE_ARCH_PORT: String(ports.arch),
    AIDE_LEGACY_PORT: String(ports.legacy),
    AIDE_START_TIMEOUT_MS: '30000'
  };

  // Pre-build so the test focuses on wrapper lifecycle, not build time.
  await buildFrontend();

  const before = await listRelevantProcesses();
  const wrapper = spawn(process.env.ComSpec || 'cmd.exe', ['/c', 'npm start'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  wrapper.stdout.on('data', () => {});
  wrapper.stderr.on('data', () => {});

  try {
    await waitFor(`http://${HOST}:${ports.ui}/`, 60000);
    await waitFor(`http://${HOST}:${ports.facade}/api/health`, 60000);

    const running = await listRelevantProcesses();
    const owned = running.filter(p => !before.some(b => b.pid === p.pid));
    assert.ok(owned.length >= 4, `expected at least 4 owned node processes, got ${owned.length}: ${JSON.stringify(owned)}`);

    // Terminate ONLY the wrapper PID. The OS must not recursively kill descendants.
    await terminateWrapper(wrapper);

    // Wait for the wrapper itself to exit.
    await waitForExit(wrapper);

    // Wait for all test-owned node/npm descendants to exit on their own.
    const survivors = await waitForCondition('owned node/npm processes to terminate', async () => {
      const after = await listRelevantProcesses();
      const remaining = after.filter(p => !before.some(b => b.pid === p.pid));
      return remaining.length === 0 ? { ok: true, value: remaining } : { ok: false, reason: `${remaining.length} remain: ${JSON.stringify(remaining)}` };
    });
    assert.deepEqual(survivors, [], `orphaned node/npm processes remain`);

    // Wait for all test-owned ports to close.
    for (const [label, port] of Object.entries(ports)) {
      const closed = await waitForCondition(`port ${port} (${label}) to close`, async () => {
        const isClosed = await portClosed(port);
        return isClosed ? { ok: true, value: true } : { ok: false, reason: 'still open' };
      }, 20000, 300);
      assert.equal(closed, true, `test-owned port ${port} (${label}) remained open`);
    }
  } finally {
    await new Promise(resolve => {
      execFile('taskkill.exe', ['/PID', String(wrapper.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    });
    await waitForExit(wrapper).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

test('OS force-kills only the npm wrapper; start.mjs cleans up the owned stack', async () => {
  await runScenario(wrapper => new Promise(resolve => {
    // /F forces termination; the absence of /T means the OS kills only the
    // wrapper PID. start.mjs must detect the loss of its owning ancestor and
    // shut down frontend, facade, TS backend, and legacy backend itself.
    execFile('taskkill.exe', ['/PID', String(wrapper.pid), '/F'], { windowsHide: true }, () => resolve());
  }));
});


