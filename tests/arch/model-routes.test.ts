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

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');

let dir: string;
let server: ArchServer;
let httpServer: http.Server;
let base: string;

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
});

after(async () => {
  server.events.close();
  await server.logger.flush();
  httpServer.closeAllConnections();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

test('GET /api/models/status lists the bundled models through the envelope', async t => {
  if (!existsSync(path.join(REPO_ROOT, 'models', 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf'))) {
    t.skip('bundled GGUF artifacts are not present in this checkout (models/*.gguf are not committed)');
    return;
  }
  const response = await fetch(`${base}/api/models/status`);
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

test('POST /api/models/start rejects an unknown model with CHILD_FAILED', async () => {
  const response = await fetch(`${base}/api/models/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'does-not-exist' })
  });
  assert.equal(response.status, 504);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'CHILD_FAILED');
});

test('POST /api/models/ingest rejects a non-gguf path', async () => {
  const response = await fetch(`${base}/api/models/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: path.join(dir, 'notes.txt') })
  });
  assert.equal(response.status, 504);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'CHILD_FAILED');
  assert.ok(envelope.data.error.message.includes('.gguf'));
});

// The manifest assigns fixed ports; if a foreign server already occupies a
// model's endpoint (e.g. an operator-run llama-server), the runtime's
// adoption bridge will legitimately adopt it instead of returning
// NOT_READY. Skip rather than false-alarm when the port is taken.
async function manifestPortOccupied(id: string): Promise<boolean> {
  try {
    const status = await fetch(`${base}/api/models/status`);
    if (!status.ok) return false;
    const body = await status.json() as { data?: { models?: Array<{ id: string; endpoint?: string }> } };
    const entry = body?.data?.models?.find(m => m.id === id);
    if (!entry?.endpoint) return false;
    const probe = await fetch(entry.endpoint.replace('/v1', '') + '/models', { signal: AbortSignal.timeout(1500) });
    return probe.ok;
  } catch {
    return false;
  }
}

test('POST /api/chat on an unstarted model returns NOT_READY', async t => {
  if (await manifestPortOccupied('qwen-coder-1.5b-q4')) {
    t.skip('a foreign server occupies the manifest endpoint (adoption bridge would adopt it); not-ready path not testable here');
    return;
  }
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ modelId: 'qwen-coder-1.5b-q4', messages: [{ role: 'user', content: 'hi' }] })
  });
  assert.equal(response.status, 409);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'NOT_READY');
});

test('POST /api/chat/stream on an unstarted model emits a validated error event', async t => {
  if (await manifestPortOccupied('qwen-coder-1.5b-q4')) {
    t.skip('a foreign server occupies the manifest endpoint (adoption bridge would adopt it); not-ready path not testable here');
    return;
  }
  const response = await fetch(`${base}/api/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ modelId: 'qwen-coder-1.5b-q4', messages: [{ role: 'user', content: 'hello' }] })
  });
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('content-type')?.includes('text/event-stream'));
  const text = await response.text();
  assert.ok(text.startsWith('data: '), 'must be an SSE data stream');
  const payload = JSON.parse(text.slice(6).split('\n')[0] ?? '{}') as { error?: string };
  assert.ok(payload.error !== undefined, 'stream must report the not-ready error as an SSE event');
});