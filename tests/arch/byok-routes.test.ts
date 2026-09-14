import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { pairFixture } from './authority-fixture.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-h2-arch-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let owner: Awaited<ReturnType<typeof pairFixture>>;

before(async () => {
  server = new ArchServer(workspace, path.join(workspace, 'arch-h2.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const store = new Map<string, string>();
  const routes = await buildRoutes(workspace, 'test', {
    authority: server.authority,
    events: server.events,
    byokSecretStore: {
      setKey: (id, key) => { store.set(id, ['enc:', key].join('')); },
      getKey: id => (store.has(id) ? String(store.get(id)).slice(4) : null),
      deleteKey: id => store.delete(id),
      listProviderIds: () => [...store.keys()],
    },
  });
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
  owner = await pairFixture(server, base);
});

after(async () => {
  server.events.close();
  await server.logger.flush();
  httpServer.closeAllConnections?.();
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

async function call<T>(method: string, pathName: string, payload?: unknown): Promise<{ status: number; body: Envelope<T> }> {
  const response = await owner.request(pathName, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(30000)
  });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

test('byok: status starts empty local-default with consent off; contract shape holds', async () => {
  const res = await call<{ providers: unknown[]; routing: Record<string, string>; consent_enabled: boolean }>('GET', '/api/byok/status');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data!.providers, []);
  assert.equal(res.body.data!.consent_enabled, false);
  assert.equal(res.body.data!.routing.plan, 'local');
});

test('byok: provider set + key put are migration-waived and fail closed; no provider or key state is created', async () => {
  // Migration-waived surface: the routes carry no authority policy, so even a
  // paired actor is refused at the capability edge (403 FORBIDDEN) before the
  // handler, and nothing is persisted. The original "never echoes key material"
  // intent is asserted on both the denial and the status read.
  const setRes = await call('PUT', '/api/byok/providers/set', { provider: { id: 'prov1', name: 'GW', base_url: 'https://gw.example.com/v1', api_type: 'chat-completions', model_id: 'm-1', tool_calling: false } });
  assert.equal(setRes.status, 403);
  assert.equal(setRes.body.ok, false);
  assert.equal(setRes.body.error?.code, 'FORBIDDEN');
  assert.match(setRes.body.error?.message ?? '', /capability has no authority policy/);

  const keyRes = await call<{ stored: true }>('PUT', '/api/byok/key', { provider_id: 'prov1', api_key: 'sk-' + 'abcdefghijklmnop1234' });
  assert.equal(keyRes.status, 403);
  assert.equal(keyRes.body.error?.code, 'FORBIDDEN');
  assert.match(keyRes.body.error?.message ?? '', /capability has no authority policy/);
  assert.doesNotMatch(JSON.stringify(keyRes.body), /abcdefghijklmnop/);

  const statusRes = await call<{ providers: Array<Record<string, unknown>> }>('GET', '/api/byok/status');
  assert.equal(statusRes.status, 200);
  assert.deepEqual(statusRes.body.data!.providers, [], 'denied writes must leave zero provider state');
  assert.doesNotMatch(JSON.stringify(statusRes.body), /abcdefghijklmnop/);

  const badKey = await call('PUT', '/api/byok/key', { provider_id: 'ghost', api_key: 'x' });
  assert.equal(badKey.status, 403);
  assert.equal(badKey.body.error?.code, 'FORBIDDEN');
});

test('byok: routing + consent + test mutations are migration-waived and fail closed; consent stays off', async () => {
  const routeRes = await call('PUT', '/api/byok/routing', { routing: { plan: 'local', act: { provider_id: 'prov1', model_id: 'm-1' }, utility: 'local' } });
  assert.equal(routeRes.status, 403);
  assert.equal(routeRes.body.error?.code, 'FORBIDDEN');
  assert.match(routeRes.body.error?.message ?? '', /capability has no authority policy/);

  const consentRes = await call('PUT', '/api/byok/consent', { enabled: false });
  assert.equal(consentRes.status, 403);
  assert.equal(consentRes.body.error?.code, 'FORBIDDEN');
  assert.match(consentRes.body.error?.message ?? '', /capability has no authority policy/);

  const testRes = await call('POST', '/api/byok/test', { provider_id: 'prov1' });
  assert.equal(testRes.status, 403);
  assert.equal(testRes.body.error?.code, 'FORBIDDEN');
  assert.match(testRes.body.error?.message ?? '', /capability has no authority policy/);

  const status = await call<{ routing: Record<string, string>; consent_enabled: boolean }>('GET', '/api/byok/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.data!.consent_enabled, false, 'no denied mutation may flip consent');
  assert.equal(status.body.data!.routing.plan, 'local', 'no denied mutation may alter routing');
});
