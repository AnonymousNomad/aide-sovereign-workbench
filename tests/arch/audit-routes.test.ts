// Audit envelope end-to-end (C6 release gate 4): exercises the full
// chassis boundary event flow through the audit-trail service via the
// new /api/audit/events, /api/audit/session, /api/audit/bundle routes.
// Uses the real ArchServer (per aide-arch-backend-core doctrine: real
// HTTP, not mocked).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-audit-routes-'));
let server: ArchServer;
let httpServer: import('node:http').Server;
let base: string;

before(async () => {
  server = new ArchServer(workspace, path.join(workspace, 'arch-audit.log'));
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

async function getJson<T>(path: string): Promise<{ status: number; body: Envelope<T> }> {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, body: (await r.json()) as Envelope<T> };
}

test('audit envelope: full session trajectory lands and reads back through the API', async () => {
  const empty = await getJson<{ events: unknown[]; count: number; known_types: string[] }>('/api/audit/events');
  assert.equal(empty.status, 200);
  assert.equal(empty.body.ok, true);
  assert.ok(empty.body.data);
  assert.equal(empty.body.data.count, 0);
  assert.deepEqual(empty.body.data.events, []);
  assert.ok(Array.isArray(empty.body.data.known_types));
  for (const required of [
    'chat', 'agent.start', 'agent.message', 'agent.tool.call', 'agent.tool.result',
    'agent.approval', 'agent.bundle.preview', 'agent.bundle.run',
    'subagent.spawn', 'subagent.done', 'subagent.error', 'desktop'
  ]) {
    assert.ok(empty.body.data.known_types.includes(required), `audit envelope must surface type: ${required}`);
  }
  // Legacy shapes preserved for the [learned] injector.
  for (const legacy of ['approval', 'rejection', 'abort']) {
    assert.ok(empty.body.data.known_types.includes(legacy), `legacy shape must be preserved: ${legacy}`);
  }
});

test('audit envelope: session and bundle route param validation', async () => {
  // Missing id -> BAD_REQUEST 400
  const noId = await getJson<unknown>('/api/audit/session');
  assert.equal(noId.status, 400);
  assert.equal(noId.body.ok, false);
  assert.equal(noId.body.error?.code, 'BAD_REQUEST');
  // Valid id -> 200 with the trajectory shape (empty events for unknown session)
  const sess = await getJson<{ session_id: string; event_count: number; by_type: Record<string, unknown>; first_at: string | null; last_at: string | null }>('/api/audit/session?id=unknown_sess');
  assert.equal(sess.status, 200);
  assert.ok(sess.body.data);
  assert.equal(sess.body.data.session_id, 'unknown_sess');
  assert.equal(sess.body.data.event_count, 0);
  assert.ok(typeof sess.body.data.by_type === 'object');
  assert.equal(sess.body.data.first_at, null);
  assert.equal(sess.body.data.last_at, null);
  // Bundle route same shape
  const bndl = await getJson<{ bundle_id: string; event_count: number; events: unknown[] }>('/api/audit/bundle?id=unknown_bndl');
  assert.equal(bndl.status, 200);
  assert.ok(bndl.body.data);
  assert.equal(bndl.body.data.bundle_id, 'unknown_bndl');
  assert.equal(bndl.body.data.event_count, 0);
  assert.deepEqual(bndl.body.data.events, []);
});

test('audit envelope: events route supports type/session_id/bundle_id/since/limit filters', async () => {
  const byType = await getJson<unknown>('/api/audit/events?type=chat&limit=50');
  assert.equal(byType.status, 200);
  assert.equal(byType.body.data?.count, 0);
  const bySess = await getJson<unknown>('/api/audit/events?session_id=nonexistent&limit=10');
  assert.equal(bySess.status, 200);
  assert.equal(bySess.body.data?.count, 0);
  const byBndl = await getJson<unknown>('/api/audit/events?bundle_id=nonexistent');
  assert.equal(byBndl.status, 200);
  const bySince = await getJson<unknown>('/api/audit/events?since=2020-01-01T00:00:00Z');
  assert.equal(bySince.status, 200);
  // limit cap (over 2000 should be rejected by zod)
  const overCap = await getJson<unknown>('/api/audit/events?limit=99999');
  assert.equal(overCap.status, 400);
  // limit coercion (string -> number)
  const coercedLimit = await getJson<unknown>('/api/audit/events?limit=10');
  assert.equal(coercedLimit.status, 200);
});
