import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';
import { Envelope } from '../../common/errors.ts';
import { HealthResponse } from '../../common/contracts/health.ts';
import { WorkspaceListResponse } from '../../common/contracts/workspace.ts';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let server: ArchServer;
let httpServer: http.Server;
let base: string;

before(async () => {
  server = new ArchServer(workspace, path.join(workspace, '.aide', 'logs', 'arch-test.log'));
  const routes = await buildRoutes(workspace, 'test');
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  httpServer.closeAllConnections();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
});

test('GET /api/health returns a valid envelope with a healthy payload', async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  if (!envelope.data.ok) return;
  const payload = HealthResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(payload.data.workspace, workspace);
  assert.ok(payload.data.freeMemoryMB > 0);
});

test('GET /api/workspace returns entries including package.json', async () => {
  const response = await fetch(`${base}/api/workspace`);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  if (!envelope.data.ok) return;
  const payload = WorkspaceListResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.ok(payload.data.entries.some(entry => entry.name === 'package.json' && entry.kind === 'file'));
});

test('unknown route returns a NOT_FOUND envelope', async () => {
  const response = await fetch(`${base}/api/nope`);
  assert.equal(response.status, 404);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, false);
  if (envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'NOT_FOUND');
});

test('POST to a GET route returns NOT_FOUND (method mismatch)', async () => {
  const response = await fetch(`${base}/api/health`, { method: 'POST' });
  assert.equal(response.status, 404);
});

test('workspace list contract rejects an entry kind that is not file/directory', async () => {
  const parsed = WorkspaceListResponse.safeParse({
    workspace: 'x',
    entries: [{ name: 'y', kind: 'link' }]
  });
  assert.equal(parsed.success, false);
});