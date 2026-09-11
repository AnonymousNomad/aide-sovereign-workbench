import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { WebSocket as NodeWebSocket } from 'ws';
import { api, ApiError } from '../../browser/src/services/api.ts';
import { connectEvents } from '../../browser/src/services/ws.ts';
import viteConfig from '../../browser/vite.config.ts';
import { ArchServer } from '../../node/src/server.ts';
import { ok, fail } from '../../common/errors.ts';
import { healthFixtures } from '../fixtures/index.ts';

const HOST = '127.0.0.1';
const ENVELOPE_HEADER = { 'X-AIDE-API-Format': 'envelope-v1' };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type BackendName = 'ts' | 'legacy';
type RouteMap = {
  prefixes: Record<string, BackendName>;
  exact: Record<string, BackendName>;
  upgrades: Record<string, BackendName>;
};
type FacadeHandle = { server: http.Server; close(): Promise<void> };
type FacadeModule = {
  createFacade(options: {
    port: number;
    routeMap: RouteMap;
    targets: Record<BackendName, { host: string; port: number }>;
  }): Promise<FacadeHandle>;
  loadRouteMap(file: string): Promise<RouteMap>;
};
const facadeModuleSpecifier: string = '../../scripts/facade.mjs';
const { createFacade, loadRouteMap } = (await import(facadeModuleSpecifier)) as FacadeModule;

function listen(server: http.Server): Promise<number> {
  return new Promise(resolve => server.listen(0, HOST, () => resolve((server.address() as net.AddressInfo).port)));
}

async function closeServer(server: http.Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

async function withRelativeFetch<T>(base: string, run: () => Promise<T>): Promise<T> {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const resolved = typeof input === 'string' && input.startsWith('/') ? base + input : input;
    return nativeFetch(resolved, init);
  }) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = nativeFetch; }
}

test('real typed browser client receives success, backend error, malformed response and facade error through the facade', async () => {
  let mode: 'success' | 'error' | 'malformed' = 'success';
  const seen: Array<{ url: string; format: string | undefined }> = [];
  const backend = http.createServer((req, res) => {
    seen.push({ url: req.url ?? '', format: req.headers['x-aide-api-format'] as string | undefined });
    res.writeHead(mode === 'error' ? 409 : 200, { 'content-type': 'application/json' });
    if (mode === 'success') res.end(JSON.stringify(ok(healthFixtures.healthy)));
    else if (mode === 'error') res.end(JSON.stringify(fail('NOT_READY', 'warming')));
    else res.end(JSON.stringify(healthFixtures.healthy));
  });
  const backendPort = await listen(backend);
  const facade = await createFacade({ port: 0, routeMap: { prefixes: { '/api/health': 'ts' }, exact: {}, upgrades: {} }, targets: { ts: { host: HOST, port: backendPort }, legacy: { host: HOST, port: 1 } } });
  const facadePort = (facade.server.address() as net.AddressInfo).port;
  const base = `http://${HOST}:${facadePort}`;
  try {
    await withRelativeFetch(base, async () => {
      assert.equal((await api.health()).version, 'test');
      mode = 'error';
      await assert.rejects(api.health(), (error: unknown) => error instanceof ApiError && error.code === 'NOT_READY' && error.message === 'warming');
      mode = 'malformed';
      await assert.rejects(api.health(), (error: unknown) => error instanceof ApiError && error.code === 'BAD_RESPONSE');
    });
    assert.ok(seen.length >= 3);
    assert.ok(seen.every(entry => entry.format === undefined), 'facade-only format header must be stripped upstream');
    await closeServer(backend);
    await withRelativeFetch(base, async () => {
      await assert.rejects(api.health(), (error: unknown) => error instanceof ApiError && error.code === 'CHILD_FAILED');
    });
  } finally {
    await facade.close();
    if (backend.listening) await closeServer(backend);
  }
});

test('legacy bare and typed envelope representations are explicit, with deterministic invalid-format behavior', async () => {
  const backend = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok(healthFixtures.healthy)));
  });
  const backendPort = await listen(backend);
  const facade = await createFacade({ port: 0, routeMap: { prefixes: { '/api/health': 'ts' }, exact: {}, upgrades: {} }, targets: { ts: { host: HOST, port: backendPort }, legacy: { host: HOST, port: 1 } } });
  const port = (facade.server.address() as net.AddressInfo).port;
  try {
    const bare = await fetch(`http://${HOST}:${port}/api/health`);
    assert.deepEqual(await bare.json(), healthFixtures.healthy);
    const typed = await fetch(`http://${HOST}:${port}/api/health`, { headers: ENVELOPE_HEADER });
    assert.deepEqual(await typed.json(), ok(healthFixtures.healthy));
    const invalid = await fetch(`http://${HOST}:${port}/api/health`, { headers: { 'X-AIDE-API-Format': 'guess-for-me' } });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), fail('BAD_REQUEST', 'unsupported X-AIDE-API-Format: guess-for-me'));
  } finally { await facade.close(); await closeServer(backend); }
});

test('shared browser stream transport stays incremental, reports stream errors and aborts upstream', async () => {
  let mode: 'normal' | 'event-error' | 'http-error' | 'hold' = 'normal';
  let upstreamClosedResolve: (() => void) | undefined;
  const upstreamClosed = new Promise<void>(resolve => { upstreamClosedResolve = resolve; });
  const backend = http.createServer((_req, res) => {
    if (mode === 'http-error') {
      res.writeHead(504, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fail('CHILD_FAILED', 'model process failed')));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    if (mode === 'event-error') { res.end('data: {"error":"generation failed"}\n\n'); return; }
    res.write('data: {"delta":"first"}\n\n');
    if (mode === 'normal') setTimeout(() => res.end('data: {"done":true,"modelId":"model-1","usedApprox":1,"dropped":0,"truncatedSystem":false}\n\n'), 150);
    else res.on('close', () => upstreamClosedResolve?.());
  });
  const backendPort = await listen(backend);
  const facade = await createFacade({ port: 0, routeMap: { prefixes: { '/api/chat': 'ts' }, exact: {}, upgrades: {} }, targets: { ts: { host: HOST, port: backendPort }, legacy: { host: HOST, port: 1 } } });
  const base = `http://${HOST}:${(facade.server.address() as net.AddressInfo).port}`;
  try {
    await withRelativeFetch(base, async () => {
      const started = Date.now();
      let response = await api.chatStream('model-1', [{ role: 'user', content: 'hi' }]);
      const reader = response.body!.getReader();
      const first = await reader.read();
      assert.ok(Date.now() - started < 300, 'first stream event was buffered');
      assert.match(new TextDecoder().decode(first.value), /"delta":"first"/);
      let tail = '';
      while (true) { const next = await reader.read(); if (next.done) break; tail += new TextDecoder().decode(next.value); }
      assert.match(tail, /"done":true/);

      mode = 'event-error';
      response = await api.chatStream('model-1', [{ role: 'user', content: 'hi' }]);
      assert.match(await response.text(), /"error":"generation failed"/);

      mode = 'http-error';
      await assert.rejects(api.chatStream('model-1', [{ role: 'user', content: 'hi' }]), (error: unknown) => error instanceof ApiError && error.code === 'CHILD_FAILED');

      mode = 'hold';
      const controller = new AbortController();
      response = await api.chatStream('model-1', [{ role: 'user', content: 'hi' }], controller.signal);
      const heldReader = response.body!.getReader();
      await heldReader.read();
      controller.abort();
      await assert.rejects(heldReader.read(), (error: unknown) => error instanceof Error && error.name === 'AbortError');
      await Promise.race([upstreamClosed, delay(2000).then(() => { throw new Error('facade did not abort upstream stream'); })]);
    });
  } finally { await facade.close(); await closeServer(backend); }
});

test('browser WebSocket client receives canonical EventHub data through facade and reconnects', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-browser-facade-ws-'));
  const arch = new ArchServer(workspace, path.join(workspace, 'arch.log'));
  const archServer = await arch.listen(0);
  const archPort = (archServer.address() as net.AddressInfo).port;
  let facade = await createFacade({ port: 0, routeMap: { prefixes: {}, exact: {}, upgrades: { '/ws': 'ts' } }, targets: { ts: { host: HOST, port: archPort }, legacy: { host: HOST, port: 1 } } });
  const facadePort = (facade.server.address() as net.AddressInfo).port;
  const previousWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = NodeWebSocket as unknown as typeof WebSocket;
  const statuses: boolean[] = [];
  const received: unknown[] = [];
  const bus = connectEvents(`ws://${HOST}:${facadePort}/ws`, { onStatus: value => statuses.push(value) });
  bus.subscribe('log', data => received.push(data));
  try {
    for (let i = 0; i < 100 && !bus.connected(); i++) await delay(20);
    assert.equal(bus.connected(), true);
    for (let i = 0; i < 100 && received.length === 0; i++) {
      const publication = arch.events.publish('log', { level: 'info', message: 'through-facade' });
      assert.equal(publication.accepted, true);
      await delay(20);
    }
    assert.ok(received.some(item => (item as { message?: string })?.message === 'through-facade'));

    await facade.close();
    for (let i = 0; i < 100 && bus.connected(); i++) await delay(20);
    facade = await createFacade({ port: facadePort, routeMap: { prefixes: {}, exact: {}, upgrades: { '/ws': 'ts' } }, targets: { ts: { host: HOST, port: archPort }, legacy: { host: HOST, port: 1 } } });
    for (let i = 0; i < 250 && !bus.connected(); i++) await delay(20);
    assert.equal(bus.connected(), true, 'browser event client did not reconnect through restarted facade');
    assert.ok(statuses.includes(false) && statuses.filter(Boolean).length >= 2);
  } finally {
    bus.dispose();
    globalThis.WebSocket = previousWebSocket;
    await facade.close();
    arch.events.close();
    archServer.closeAllConnections?.();
    await new Promise<void>(resolve => archServer.close(() => resolve()));
    await arch.logger.flush();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('browser-required route ownership and Vite HTTP/WebSocket proxies point to canonical facade', async () => {
  const map = await loadRouteMap(path.resolve('common/facade-route-map.json'));
  assert.equal(map.prefixes['/api/chat'], 'ts');
  assert.equal(map.prefixes['/api/workbenches'], 'ts');
  assert.equal(map.upgrades['/ws'], 'ts');
  const config = viteConfig as { server?: { proxy?: Record<string, { target?: string }> }; preview?: { proxy?: Record<string, { target?: string }> } };
  assert.equal(config.server?.proxy?.['/api']?.target, 'http://127.0.0.1:4777');
  assert.equal(config.server?.proxy?.['/ws']?.target, 'ws://127.0.0.1:4777');
  assert.equal(config.preview?.proxy?.['/api']?.target, 'http://127.0.0.1:4777');
  assert.equal(config.preview?.proxy?.['/ws']?.target, 'ws://127.0.0.1:4777');
});
