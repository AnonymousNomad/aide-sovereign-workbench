import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import type http from 'node:http';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes, createModelRuntime, createLspManager, createDapManager } from '../../node/src/openapi.ts';
import { ProviderService } from '../../node/src/services/providers.ts';
import { CredentialStore, type CryptService } from '../../node/src/services/credentials.ts';
import { Envelope } from '../../common/errors.ts';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
import { fileURLToPath } from 'node:url';

class FakeCrypt implements CryptService {
  readonly kind = 'fake';
  async available(): Promise<boolean> {
    return true;
  }
  async protect(plaintext: string): Promise<string> {
    return `enc:${Buffer.from(plaintext, 'utf8').toString('base64')}`;
  }
  async unprotect(blobB64: string): Promise<string> {
    if (!blobB64.startsWith('enc:')) throw new Error('bad blob');
    return Buffer.from(blobB64.slice(4), 'base64').toString('utf8');
  }
}

let dir: string;
let server: ArchServer;
let httpServer: http.Server;
let base: string;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-provider-routes-'));
  server = new ArchServer(dir, path.join(dir, '.aide', 'arch-provider-routes.log'));
  const lsp = createLspManager(REPO_ROOT, dir, { events: server.events, logger: server.logger });
  const dap = await createDapManager(REPO_ROOT, dir, { events: server.events, logger: server.logger });
  const modelRuntime = await createModelRuntime(REPO_ROOT, dir, { events: server.events, logger: server.logger });
  const providerService = new ProviderService(dir, {
    credentials: new CredentialStore(dir, new FakeCrypt()),
    fetchFn: (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (headers.get('authorization') === 'Bearer sk-valid') return new Response(null, { status: 200 });
      if (headers.get('x-api-key') === 'ant-valid') return new Response(null, { status: 200 });
      return new Response(null, { status: 401 });
    }) as typeof fetch
  });
  const routes = await buildRoutes(dir, 'test', {
    events: server.events,
    logger: server.logger,
    lspManager: lsp,
    dapManager: dap,
    modelRuntime,
    providerService
  });
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.events.close();
  await server.logger.flush();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

test('GET /api/providers lists the built-ins through the envelope without keys', async () => {
  const response = await fetch(`${base}/api/providers`);
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = envelope.data.data as { providers: { id: string; status: string }[] };
  assert.equal(payload.providers.length, 6);
  assert.ok(payload.providers.every(provider => provider.status === 'not_connected'));
  assert.ok(!JSON.stringify(payload).match(/sk-|api[_-]?key/i), 'the list must never leak key material');
});

test('POST /api/providers/connect returns invalid_key for a rejected key and never echoes it', async () => {
  const response = await fetch(`${base}/api/providers/connect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'openai', key: 'sk-bad-key-xyz' })
  });
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = envelope.data.data as { status: string; message: string };
  assert.equal(payload.status, 'invalid_key');
  assert.ok(!JSON.stringify(payload).includes('sk-bad-key-xyz'), 'the key must be scrubbed from the response');
});

test('POST /api/providers/connect with an unapproved custom host is forbidden', async () => {
  const response = await fetch(`${base}/api/providers/connect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'openai', key: 'k', baseUrl: 'https://evil-relay.example/v1' })
  });
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'FORBIDDEN');
  assert.ok(envelope.data.error.message.includes('evil-relay.example'));
});

test('POST /api/providers/connect with a valid key returns connected', async () => {
  const response = await fetch(`${base}/api/providers/connect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'anthropic', key: 'ant-valid' })
  });
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = envelope.data.data as { status: string };
  assert.equal(payload.status, 'connected');
});

test('POST /api/providers/import stores imported chats through the envelope', async () => {
  const exportPayload = JSON.stringify({
    conversations: [
      {
        id: 'c1',
        title: 'imported chat',
        create_time: 1690123456,
        mapping: {
          a: {
            message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['hello'] } },
            parent: null,
            children: []
          }
        },
        current_node: 'a'
      }
    ]
  });
  const response = await fetch(`${base}/api/providers/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format: 'chatgpt', payload: exportPayload })
  });
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = envelope.data.data as { imported: number; skipped: number };
  assert.equal(payload.imported, 1);
  assert.equal(payload.skipped, 0);
  const history = await fetch(`${base}/api/chat/history`);
  const historyEnvelope = Envelope.safeParse(await history.json());
  assert.equal(historyEnvelope.success, true);
  if (!historyEnvelope.success || !historyEnvelope.data.ok) return;
  const conversations = (historyEnvelope.data.data as { conversations: { title: string; messages: unknown[] }[] }).conversations;
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0]!.title, 'imported chat');
  assert.equal(conversations[0]!.messages.length, 1);
});

test('POST /api/providers/import rejects oversized payloads', async () => {
  const response = await fetch(`${base}/api/providers/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format: 'chatgpt', payload: 'x'.repeat(11_000_000) })
  });
  assert.equal(response.status, 400);
});