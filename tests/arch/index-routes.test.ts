import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { ArchServer } from '../../node/src/server.ts';
import { IndexStreamEvent } from '../../common/contracts/index.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-a2-arch-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;

function fakeEmbed(texts: string[]): Promise<number[][]> {
  const dim = 8;
  return Promise.resolve(texts.map(text => {
    const vec = new Array<number>(dim).fill(0);
    for (const word of text.toLowerCase().split(/[^a-z0-9_$]+/).filter(Boolean)) {
      let h = 0;
      for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      vec[h % dim] = (vec[h % dim] ?? 0) + 1;
    }
    return vec;
  })) as Promise<number[][]>;
}

before(async () => {
  await fs.writeFile(path.join(workspace, 'billing.ts'), 'export function refundPayment(order) {\n  return gateway.refund(order);\n}\n', 'utf8');
  await fs.writeFile(path.join(workspace, 'config.ts'), 'export function parseConfig(file) {\n  return JSON.parse(file);\n}\n', 'utf8');
  server = new ArchServer(workspace, path.join(os.tmpdir(), 'aide-a2-arch.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const routes = await buildRoutes(workspace, 'test', { indexEmbedFn: fakeEmbed, events: server.events });
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  httpServer.closeAllConnections();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
});

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

async function post<T>(pathName: string, payload: unknown): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${base}${pathName}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function get<T>(pathName: string): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${base}${pathName}`);
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function waitForReady(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const { body } = await get<{ state: string }>('/api/index/status');
    if (body.data?.state === 'ready') return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('index did not reach ready in time');
}

test('reindex over HTTP reaches ready and status contract holds', async () => {
  const badBody = await post('/api/index/reindex', { force: 'yes' });
  assert.equal(badBody.status, 400);
  assert.equal(badBody.body.ok, false);

  const start = await post<{ session_id: string }>('/api/index/reindex', {});
  assert.equal(start.status, 200);
  assert.ok(start.body.ok);
  assert.ok(start.body.data && typeof start.body.data.session_id === 'string');

  await waitForReady();

  const status = await get<{ state: string; chunks: number; files_total: number; branch: string | null; last_error: string | null; updated_at: string }>('/api/index/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.data?.state, 'ready');
  assert.equal(status.body.data?.chunks, 2);
  assert.equal(typeof status.body.data?.updated_at, 'string');
});

test('hybrid search returns provenance-ranked results with degraded=false', async () => {
  const missingQuery = await get('/api/index/search?limit=5');
  assert.equal(missingQuery.status, 400);

  const tooHighLimit = await get('/api/index/search?query=refund&limit=99');
  assert.equal(tooHighLimit.status, 400);

  const hit = await get<{ results: Array<{ path: string; line: number; header: string; rrf_score: number; sparse_rank: number | null; dense_rank: number | null }>; degraded: boolean }>('/api/index/search?query=refundPayment&limit=5');
  assert.equal(hit.status, 200);
  assert.equal(hit.body.ok, true);
  assert.equal(hit.body.data?.degraded, false);
  const results = hit.body.data?.results ?? [];
  assert.ok(results.length >= 1);
  assert.equal(results[0]?.path, 'billing.ts');
  assert.equal(typeof results[0]?.rrf_score, 'number');
  assert.ok(results[0]?.sparse_rank !== null || results[0]?.dense_rank !== null);

  const noHit = await get<{ results: unknown[]; degraded: boolean }>('/api/index/search?query=zzzqqqxxx');
  assert.equal(noHit.status, 200);
  assert.ok(Array.isArray(noHit.body.data?.results));
});

test('ws index channel delivers progress/ready events', async () => {
  const socket = await new Promise<WebSocket>((resolve, reject) => {
    const wsUrl = base.replace('http://', 'ws://') + '/ws';
    const sock = new WebSocket(wsUrl);
    sock.on('open', () => {
      sock.send(JSON.stringify({ type: 'subscribe', channels: ['index'] }));
      resolve(sock);
    });
    sock.on('error', reject);
  });
  const collected: Record<string, unknown>[] = [];
  socket.on('message', raw => collected.push(JSON.parse(String(raw)) as Record<string, unknown>));

  await post('/api/index/reindex', { force: true });
  for (let i = 0; i < 200; i++) {
    const { body } = await get<{ state: string }>('/api/index/status');
    if (body.data?.state === 'ready') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await new Promise(resolve => setTimeout(resolve, 300));
  socket.close();

  const indexEvents = collected.filter(event => event.channel === 'index');
  assert.ok(indexEvents.length >= 1);
  for (const event of indexEvents) {
    IndexStreamEvent.parse(event.data);
    void event;
  }
  assert.ok(indexEvents.some(event => (event.data as { type?: string }).type === 'ready'));
});
