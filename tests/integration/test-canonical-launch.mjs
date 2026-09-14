import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOST = '127.0.0.1';

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
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${url}: ${last}`);
}

function waitForExit(child, timeoutMs = 15000) {
  if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return Promise.race([
    new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`process ${child.pid} did not exit`)), timeoutMs))
  ]);
}

function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return Promise.resolve();
  if (process.platform !== 'win32') {
    child.kill('SIGTERM');
    return waitForExit(child).then(() => undefined);
  }
  return new Promise(resolve => {
    execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
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

function launch(workspace, ports, frontend = 'typed') {
  return spawn(process.execPath, ['scripts/start.mjs', `--frontend=${frontend}`], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      AIDE_WORKSPACE: workspace,
      AIDE_UI_PORT: String(ports.ui),
      AIDE_FACADE_PORT: String(ports.facade),
      AIDE_ARCH_PORT: String(ports.arch),
      AIDE_LEGACY_PORT: String(ports.legacy),
      AIDE_CLOSED_LOOP: 'false',
      AIDE_START_TIMEOUT_MS: '10000'
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

test('real canonical start launches typed UI and facade while preserving SPA assets', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-launch-integration-'));
  const ports = { ui: await freePort(), facade: await freePort(), arch: await freePort(), legacy: await freePort() };
  const child = launch(workspace, ports);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const index = await waitFor(`http://${HOST}:${ports.ui}/`);
    const html = await index.text();
    assert.match(html, /<div id="app"><\/div>/);
    assert.match(html, /type="module"/);
    assert.doesNotMatch(html, /app\.js/);

    const deepLink = await fetch(`http://${HOST}:${ports.ui}/workspace/deep/link`);
    assert.equal(deepLink.status, 200);
    assert.equal(await deepLink.text(), html);

    const assetPath = html.match(/src="([^"]+\.js)"/)?.[1];
    assert.ok(assetPath, 'typed build must reference a JavaScript asset');
    const asset = await fetch(new URL(assetPath, `http://${HOST}:${ports.ui}/`));
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /javascript/);

    const health = await waitFor(`http://${HOST}:${ports.facade}/api/health`);
    assert.equal(health.status, 200);
    for (let i = 0; i < 100 && !stdout.includes('frontend=typed'); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.match(stdout, /frontend=typed/);
    assert.equal(stderr, '');
  } finally {
    await killTree(child);
    await waitForExit(child).catch(() => {});
    for (const port of Object.values(ports)) assert.equal(await portClosed(port), true, `test-owned port ${port} remained open`);
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('real development launch serves the same typed Vite frontend through the facade', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-dev-launch-integration-'));
  const ports = { ui: await freePort(), facade: await freePort(), arch: await freePort(), legacy: await freePort() };
  const child = launch(workspace, ports, 'vite');
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const index = await waitFor(`http://${HOST}:${ports.ui}/`);
    const html = await index.text();
    assert.match(html, /<div id="app"><\/div>/);
    const sourceEntry = html.match(/<script type="module" src="([^"]*src\/main\.ts)"><\/script>/)?.[1];
    assert.ok(sourceEntry, 'Vite index must load the typed src/main.ts entry');
    assert.equal(new URL(sourceEntry, `http://${HOST}:${ports.ui}/`).pathname, '/src/main.ts');
    const health = await waitFor(`http://${HOST}:${ports.facade}/api/health`);
    assert.equal(health.status, 200);
    for (let i = 0; i < 100 && !stdout.includes('frontend=vite'); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.match(stdout, /frontend=vite/);
    assert.equal(stderr, '');
  } finally {
    await killTree(child);
    await waitForExit(child).catch(() => {});
    for (const port of Object.values(ports)) assert.equal(await portClosed(port), true, `test-owned port ${port} remained open`);
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('canonical start exits nonzero and cleans up when a required backend cannot start', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-launch-failure-'));
  const blocker = http.createServer((_request, response) => response.writeHead(503).end('occupied'));
  const arch = await listen(blocker);
  const ports = { ui: await freePort(), facade: await freePort(), arch, legacy: await freePort() };
  const child = launch(workspace, ports);
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const result = await waitForExit(child, 15000);
    assert.notEqual(result.code, 0);
    assert.match(stderr, /TypeScript backend exited before readiness|did not become ready/);
    assert.equal(await portClosed(ports.ui), true);
    assert.equal(await portClosed(ports.facade), true);
    assert.equal(await portClosed(ports.legacy), true);
  } finally {
    await killTree(child);
    await new Promise(resolve => blocker.close(resolve));
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
