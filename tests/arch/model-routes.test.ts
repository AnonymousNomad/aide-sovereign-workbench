import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type http from 'node:http';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes, createModelRuntime, createLspManager, createDapManager } from '../../node/src/openapi.ts';
import { Envelope } from '../../common/errors.ts';
import { pairFixture } from './authority-fixture.ts';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');

let dir: string;
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let owner: Awaited<ReturnType<typeof pairFixture>>;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-model-routes-'));
  server = new ArchServer(dir, path.join(dir, '.aide', 'arch-model-routes.log'));
  const lsp = createLspManager(REPO_ROOT, dir, { events: server.events, logger: server.logger });
  const dap = await createDapManager(REPO_ROOT, dir, { events: server.events, logger: server.logger });
  const modelRuntime = await createModelRuntime(REPO_ROOT, dir, { events: server.events, logger: server.logger });
  const routes = await buildRoutes(dir, 'test', { events: server.events, logger: server.logger, lspManager: lsp, dapManager: dap, modelRuntime });
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
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

test('GET /api/models/status lists the bundled models through the envelope', async t => {
  if (!existsSync(path.join(REPO_ROOT, 'models', 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf'))) {
    t.skip('bundled GGUF artifacts are not present in this checkout (models/*.gguf are not committed)');
    return;
  }
  // status() may run the python engine probe on first read; keep the request
  // bound above that probe window.
  const response = await owner.request('/api/models/status', { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = envelope.data.data as { runtime: boolean; models: { id: string; endpoint: string; artifact_available: boolean }[] };
  assert.equal(typeof payload.runtime, 'boolean');
  assert.ok(payload.models.length >= 3);
  const qwen = payload.models.find(entry => entry.id === 'qwen-coder-1.5b-q4');
  assert.ok(qwen, 'bundled qwen 1.5B must be listed');
  assert.equal(qwen.artifact_available, true);
  assert.ok(qwen.endpoint.startsWith('http://127.0.0.1:'));
});

test('POST /api/models/start rejects an unknown model with CHILD_FAILED for approved callers', async () => {
  const body = { id: 'does-not-exist' };
  const anonymous = await fetch(`${base}/api/models/start`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000)
  });
  assert.equal(anonymous.status, 403, 'anonymous actor rejected');
  const noApproval = await owner.request('/api/models/start', { method: 'POST', body: JSON.stringify(body) });
  assert.equal(noApproval.status, 409, 'unapproved start denied');
  const headers = await owner.approve('POST', '/api/models/start', body, 'task:model-start-unknown');
  const response = await owner.request('/api/models/start', { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal(response.status, 504);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'CHILD_FAILED');
});

test('POST /api/models/ingest rejects a non-gguf path', async t => {
  t.skip('POST /api/models/ingest remains migration-waived (ARCHITECTURE-DECISION); re-enable the validation assertions when it enrolls');
});

test('POST /api/chat on an unstarted model returns NOT_READY', async t => {
  t.skip('POST /api/chat remains migration-waived (ARCHITECTURE-DECISION); re-enable the not-ready assertion (and the endpoint-occupancy guard) when it enrolls');
});

test('POST /api/chat/stream on an unstarted model emits a validated error event', async t => {
  t.skip('POST /api/chat/stream remains migration-waived (ARCHITECTURE-DECISION); re-enable the SSE error-event assertion when it enrolls');
});