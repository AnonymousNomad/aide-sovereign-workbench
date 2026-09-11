import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ArchServer, type RouteContext } from '../../node/src/server.ts';
import { DapManager } from '../../node/src/services/dap.ts';
import { routeForDapRawRequest } from '../../node/src/routes/dap.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-dap-routes-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;

before(async () => {
  const manager = new DapManager({
    workspace,
    adapters: [{ id: 'nonexistent', name: 'Missing adapter', command: path.join(workspace, 'no-such-adapter.exe'), args: [], languages: ['python'] }]
  });
  server = new ArchServer(workspace, path.join(os.tmpdir(), 'aide-dap-routes.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const routes = await buildRoutes(workspace, 'test', { dapManager: manager, events: server.events });
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
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

test('dap status lists the adapter under the envelope through the arch server', async () => {
  const { status, body } = await get<{ adapters: Array<{ id: string; status: string }> }>('/api/dap/status');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  const entry = body.data?.adapters.find(adapter => adapter.id === 'nonexistent');
  assert.equal(entry?.status, 'not_found');
});

test('dap state?id reports an inactive adapter without launching it', async () => {
  const { status, body } = await get<{ id: string; active: boolean }>('/api/dap/state?id=nonexistent');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.data, { id: 'nonexistent', active: false });
});

test('dap state rejects a missing id query param', async () => {
  const { body } = await get('/api/dap/state');
  assert.equal(body.ok, false);
});

test('dap request on a non-running adapter returns CHILD_FAILED (504), not a raw 500', async () => {
  const { status, body } = await post<{ result: unknown }>('/api/dap/request', { id: 'nonexistent', command: 'evaluate', args: { expression: '1+1' } });
  assert.equal(status, 504);
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'CHILD_FAILED');
});

test('dap start rejects the legacy id key as strict BAD_REQUEST', async () => {
  const { status, body } = await post('/api/dap/start', { id: 'nonexistent' });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'BAD_REQUEST');
});

test('dap start with the canonical adapterId key routes and fails as CHILD_FAILED (504)', async () => {
  const { status, body } = await post<{ adapterId: string; status: string }>('/api/dap/start', { adapterId: 'nonexistent' });
  assert.equal(status, 504);
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'CHILD_FAILED');
});

test('dap raw request passthrough maps the legacy call to the manager request and wraps the result', async () => {
  const rawResponse = { seq: 1, type: 'response', request_seq: 0, success: true, command: 'evaluate', body: { result: '2' } };
  const stub = {
    request: async (_id: string, _command: string, _args: unknown) => rawResponse
  };
  const route = routeForDapRawRequest(stub as unknown as DapManager);
  const result = await route.handler({ query: {}, body: { id: 'x', command: 'evaluate', args: { expression: '1+1' } } } as unknown as RouteContext);
  assert.deepEqual(result, { result: rawResponse });
});