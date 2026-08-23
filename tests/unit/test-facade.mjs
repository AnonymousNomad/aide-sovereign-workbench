import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createFacade, loadRouteMap } from '../../scripts/facade.mjs';

const HOST = '127.0.0.1';

function listen(server) {
  return new Promise(resolve => server.listen(0, HOST, () => resolve(server.address().port)));
}

function fakeBackend(label, { wsEcho = false } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, host: req.headers.host });
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Backend': label });
    res.end(JSON.stringify({ backend: label, url: req.url }));
  });
  if (wsEcho) {
    server.on('upgrade', (req, socket) => {
      const key = req.headers['sec-websocket-key'];
      const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
      socket.write(Buffer.from([0x81, 0x05]));
      socket.write(Buffer.from('hello'));
      socket.on('data', () => {});
    });
  }
  return { server, seen };
}

function get(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port, path: requestPath, agent: false }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
  });
}

test('prefix routes hit the mapped backend on both sides', async () => {
  const ts = fakeBackend('ts');
  const legacy = fakeBackend('legacy');
  const tsPort = await listen(ts.server);
  const legacyPort = await listen(legacy.server);
  const facade = await createFacade({
    port: 0,
    routeMap: { prefixes: { '/ts-fam': 'ts', '/legacy-fam': 'legacy' }, exact: {}, upgrades: {} },
    targets: { ts: { host: HOST, port: tsPort }, legacy: { host: HOST, port: legacyPort } }
  });
  const port = facade.server.address().port;
  const r1 = await get(port, '/ts-fam/ping');
  assert.equal(r1.headers['x-backend'], 'ts');
  assert.equal(r1.body, JSON.stringify({ backend: 'ts', url: '/ts-fam/ping' }));
  const r2 = await get(port, '/legacy-fam/deep/path');
  assert.equal(r2.headers['x-backend'], 'legacy');
  const r3 = await get(port, '/ts-family-similar');
  assert.equal(r3.headers['x-backend'], 'legacy');
  await facade.close();
  for (const s of [ts.server, legacy.server]) { s.closeAllConnections?.(); s.close(); }
});

test('longest prefix wins and unknown paths fall to legacy', async () => {
  const ts = fakeBackend('ts');
  const legacy = fakeBackend('legacy');
  const tsPort = await listen(ts.server);
  const legacyPort = await listen(legacy.server);
  const facade = await createFacade({
    port: 0,
    routeMap: { prefixes: { '/api': 'ts', '/api/nested': 'legacy' }, exact: { '/api/exact-hit': 'legacy' }, upgrades: {} },
    targets: { ts: { host: HOST, port: tsPort }, legacy: { host: HOST, port: legacyPort } }
  });
  const port = facade.server.address().port;
  assert.equal((await get(port, '/api/other')).headers['x-backend'], 'ts');
  assert.equal((await get(port, '/api/nested/x')).headers['x-backend'], 'legacy');
  assert.equal((await get(port, '/api/exact-hit')).headers['x-backend'], 'legacy');
  assert.equal((await get(port, '/unknown')).headers['x-backend'], 'legacy');
  assert.equal(ts.seen.some(s => s.url === '/api/nested/x'), false);
  await facade.close();
  for (const s of [ts.server, legacy.server]) { s.closeAllConnections?.(); s.close(); }
});

test('sse streams are not buffered by the facade', async () => {
  const backend = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('event: first\n\n');
    setTimeout(() => { res.write('event: second\n\n'); res.end(); }, 400);
  });
  const backendPort = await listen(backend);
  const facade = await createFacade({
    port: 0,
    routeMap: { prefixes: { '/events': 'ts' }, exact: {}, upgrades: {} },
    targets: { ts: { host: HOST, port: backendPort }, legacy: { host: HOST, port: 1 } }
  });
  const port = facade.server.address().port;
  const firstByteAt = await new Promise((resolve, reject) => {
    const started = Date.now();
    http.get({ host: HOST, port, path: '/events/feed', agent: false }, res => {
      res.once('data', () => resolve(Date.now() - started));
      res.resume();
    }).on('error', reject);
  });
  assert.ok(firstByteAt < 300, `first byte took ${firstByteAt}ms; facade buffered the stream`);
  await facade.close();
  backend.closeAllConnections?.(); backend.close();
});

test('websocket upgrades are proxied to the mapped target', async () => {
  const ts = fakeBackend('ts', { wsEcho: true });
  const tsPort = await listen(ts.server);
  const facade = await createFacade({
    port: 0,
    routeMap: { prefixes: {}, exact: {}, upgrades: { '/ws': 'ts' } },
    targets: { ts: { host: HOST, port: tsPort }, legacy: { host: HOST, port: 1 } }
  });
  const port = facade.server.address().port;
  const ws = new WebSocket(`ws://${HOST}:${port}/ws`);
  const greeting = await new Promise((resolve, reject) => {
    ws.on('unexpected-response', (_req, res) => reject(new Error(`upgrade rejected: ${res.statusCode}`)));
    ws.on('message', data => resolve(data.toString()));
    ws.on('error', reject);
  });
  assert.equal(greeting, 'hello');
  ws.terminate();
  await facade.close();
  ts.server.closeAllConnections?.(); ts.server.close();
});

test('unreachable backend yields a typed 502 instead of hanging', async () => {
  const dead = net.createServer();
  const deadPort = await listen(dead);
  dead.close();
  const facade = await createFacade({
    port: 0,
    routeMap: { prefixes: { '/dead': 'ts' }, exact: {}, upgrades: {} },
    targets: { ts: { host: HOST, port: deadPort }, legacy: { host: HOST, port: 1 } }
  });
  const port = facade.server.address().port;
  const started = Date.now();
  const res = await get(port, '/dead/anything');
  assert.ok(Date.now() - started < 5000, 'facade hung on dead backend');
  assert.equal(res.status, 502);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.error.code, 'backend_unavailable');
  assert.equal(typeof parsed.error.message, 'string');
  await facade.close();
});

test('loadRouteMap reads an override file and rejects traversal entries', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aide-facade-'));
  try {
    const file = path.join(dir, 'routes.json');
    await writeFile(file, JSON.stringify({ prefixes: { '/a': 'ts' }, exact: {}, upgrades: { '/ws': 'legacy' } }));
    const loaded = await loadRouteMap(file);
    assert.deepEqual(loaded, { prefixes: { '/a': 'ts' }, exact: {}, upgrades: { '/ws': 'legacy' } });
    await writeFile(file, JSON.stringify({ prefixes: { '/../evil': 'ts' }, exact: {}, upgrades: {} }));
    await assert.rejects(() => loadRouteMap(file));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('close is complete and idempotent - no orphaned listeners', async () => {
  const legacy = fakeBackend('legacy');
  const legacyPort = await listen(legacy.server);
  const facade = await createFacade({
    port: 0,
    routeMap: { prefixes: {}, exact: {}, upgrades: {} },
    targets: { ts: { host: HOST, port: 1 }, legacy: { host: HOST, port: legacyPort } }
  });
  const port = facade.server.address().port;
  await new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port, path: '/anything', agent: false }, res => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', reject);
  });
  await facade.close();
  const probe = await get(port, '/again').then(v => ({ resolved: v.status }), e => ({ rejected: e.code || e.message }));
  assert.deepEqual(probe, { rejected: 'ECONNREFUSED' });
  await facade.close();
  legacy.server.closeAllConnections?.(); legacy.server.close();
});
