import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArchServer } from '../../node/src/server.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-h1-arch-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;

before(async () => {
  await fs.writeFile(path.join(workspace, 'README.md'), '# demo\n\nhello line\n', 'utf8');
  server = new ArchServer(workspace, path.join(workspace, 'arch-h1.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const routes = await buildRoutes(workspace, 'test', {});
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

test('handoff: unconfirmed transcript tier is refused with 400 envelope', async () => {
  const res = await post('/api/handoff/export', { tier: 'transcript' });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error?.code ?? '', /VALIDATION|BAD_REQUEST/);
});

test('handoff: include_code without full tier is refused with 400 envelope', async () => {
  const res = await post('/api/handoff/export', { tier: 'brief', include_code: true });
  assert.equal(res.status, 400);
});

test('handoff: brief export -> list -> get -> import roundtrip over HTTP', async () => {
  const exportRes = await post<{ bundle_id: string; tier: string; file_path: string }>('/api/handoff/export', { tier: 'brief' });
  assert.equal(exportRes.status, 200);
  assert.ok(exportRes.body.data);
  assert.match(exportRes.body.data!.file_path, /^\.aide\/handoff\//);

  const listRes = await get<{ bundles: Array<{ id: string }> }>('/api/handoff/bundles');
  assert.equal(listRes.status, 200);
  const id = listRes.body.data!.bundles[0]!.id;

  const getRes = await get<Record<string, unknown>>(`/api/handoff/bundles/get?id=${id}`);
  assert.equal(getRes.status, 200);
  const bundle = getRes.body.data!;
  assert.equal(bundle.id, id);
  assert.equal(bundle.version, 1);

  const importRes = await post<{ context_id: string }>('/api/handoff/import', { bundle });
  assert.equal(importRes.status, 200);
  assert.match(importRes.body.data!.context_id, /^import-/);

  const relist = await get<{ bundles: Array<{ imported: boolean }> }>('/api/handoff/bundles');
  assert.equal(relist.body.data!.bundles.some(b => b.imported), true);
});

test('handoff: secret-bearing transcript refuses FORBIDDEN unless confirmed_secret_scan', async () => {
  const session = await post<{ session_id: string }>('/api/agent/start', {
    task: 'leak test with key sk-' + 'abcdefghijklmnop12345678',
    mode: 'plan'
  });
  assert.equal(session.status, 200);
  const sessionId = session.body.data!.session_id;

  const refused = await post('/api/handoff/export', { tier: 'transcript', confirmed: true, session_id: sessionId });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error?.code, 'FORBIDDEN');

  const allowed = await post<{ bundle_id: string; message_count: number }>('/api/handoff/export', {
    tier: 'transcript',
    confirmed: true,
    confirmed_secret_scan: true,
    session_id: sessionId
  });
  assert.equal(allowed.status, 200);
  assert.ok(allowed.body.data!.message_count >= 2);
});

test('handoff: contract exposes routes and service source has zero egress modules', async () => {
  const contract = JSON.parse(await fs.readFile(path.join(here, '..', '..', 'common', 'openapi.json'), 'utf8'));
  for (const p of ['/api/handoff/export', '/api/handoff/bundles/get', '/api/handoff/import']) {
    assert.ok(contract.paths[p], `missing ${p}`);
  }
  const serviceSource = await fs.readFile(
    path.join(here, '..', '..', 'node', 'src', 'services', 'handoff-service.mjs'),
    'utf8'
  );
  assert.doesNotMatch(serviceSource, /\bfetch\s*\(|https?\s*:\s*|axios|undici|node:https/);
});
