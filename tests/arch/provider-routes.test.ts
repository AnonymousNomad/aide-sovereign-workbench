import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type http from 'node:http';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes, createModelRuntime, createLspManager, createDapManager } from '../../node/src/openapi.ts';
import { ProviderService } from '../../node/src/services/providers.ts';
import { CredentialStore, type CryptService } from '../../node/src/services/credentials.ts';
import { importChatExport } from '../../node/src/services/importers/index.ts';
import { Envelope } from '../../common/errors.ts';
import { pairFixture } from './authority-fixture.ts';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

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
let owner: Awaited<ReturnType<typeof pairFixture>>;

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
    authority: server.authority,
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
  owner = await pairFixture(server, base);
});

after(async () => {
  server.events.close();
  await server.logger.flush();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

test('GET /api/providers lists the built-ins through the envelope without keys', async () => {
  const response = await owner.request('/api/providers');
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = envelope.data.data as { providers: { id: string; status: string; configured: boolean }[] };
  assert.equal(payload.providers.length, 6);
  assert.ok(payload.providers.every(provider => provider.status === 'not_connected' && provider.configured === false));
  assert.ok(!JSON.stringify(payload).match(/sk-|api[_-]?key/i), 'the list must never leak key material');
});

test('POST /api/providers/connect remains migration-waived (fail closed, key never evaluated or echoed)', async () => {
  // POST /api/providers/connect is ARCHITECTURE-DECISION in the migration
  // waiver: it has no authority policy, so a paired actor is refused 403
  // before any provider logic runs. The denial must not echo the key.
  const response = await owner.request('/api/providers/connect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'openai', key: 'sk-bad-key-xyz' })
  });
  assert.equal(response.status, 403, 'waived route stays fail-closed until its own wave');
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'FORBIDDEN');
  assert.ok(!JSON.stringify(envelope.data).includes('sk-bad-key-xyz'), 'the key must be scrubbed from the denial');
});

test('POST /api/providers/connect with an unapproved custom host is refused fail-closed', async () => {
  const response = await owner.request('/api/providers/connect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'openai', key: 'k', baseUrl: 'https://evil-relay.example/v1' })
  });
  assert.equal(response.status, 403, 'waived route stays fail-closed before any host evaluation');
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'FORBIDDEN');
});

test('POST /api/providers/connect with a valid key remains migration-waived (fail closed)', async () => {
  const response = await owner.request('/api/providers/connect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'anthropic', key: 'ant-valid' })
  });
  assert.equal(response.status, 403, 'waived route stays fail-closed until its own wave');
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'FORBIDDEN');
});

test('POST /api/providers/import authority matrix: digest binding, privacy, cap and partial truth', async () => {
  const sentinel = 'PIN-SENTINEL-9f31c2';
  const conversation = (index: number, title = `imported chat ${index}`) => ({
    id: `c${index}`,
    title,
    create_time: 1690123456 + index,
    mapping: {
      a: {
        message: { author: { role: 'user' }, content: { content_type: 'text', parts: [`hello ${index}`] } },
        parent: null,
        children: []
      }
    },
    current_node: 'a'
  });
  const exportOf = (items: unknown[]) => JSON.stringify({ conversations: items });
  const payload = exportOf([conversation(1, `imported chat 1 ${sentinel}`), conversation(2, 'imported caf\u00e9 chat'), conversation(3)]);
  const exactBody = { format: 'chatgpt', payload };

  // Transport and contract edge.
  const anonymous = await fetch(`${base}/api/providers/import`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(exactBody), signal: AbortSignal.timeout(5000)
  });
  assert.equal(anonymous.status, 403, 'anonymous rejected');
  const unapproved = await owner.request('/api/providers/import', { method: 'POST', body: JSON.stringify(exactBody) });
  assert.equal(unapproved.status, 409, 'paired without approval fails');
  for (const [label, body] of [
    ['missing format', { payload }],
    ['missing payload', { format: 'chatgpt' }],
    ['null payload', { format: 'chatgpt', payload: null }],
    ['wrong type', { format: 'chatgpt', payload: 7 }],
    ['unknown format', { format: 'gemini', payload }],
    ['extra field', { format: 'chatgpt', payload, filename: 'export.json' }]
  ] as Array<[string, unknown]>) {
    const malformed = await owner.request('/api/providers/import', { method: 'POST', body: JSON.stringify(body) });
    assert.equal(malformed.status, 400, `${label} rejected at the contract edge`);
  }
  const historyBefore = await owner.request('/api/chat/history');
  const beforeEnvelope = Envelope.safeParse(await historyBefore.json());
  assert.equal(beforeEnvelope.success, true);
  if (!beforeEnvelope.success || !beforeEnvelope.data.ok) return assert.fail('history envelope broken');
  assert.deepEqual((beforeEnvelope.data.data as { conversations: unknown[] }).conversations, [], 'store empty before any import');

  // Prepare/inspect privacy: the operation binds digest + length, never the payload.
  const prepared = await owner.request('/api/authority/prepare', {
    method: 'POST',
    body: JSON.stringify({ method: 'POST', path: '/api/providers/import', task_id: 'task:import-inspect', body: exactBody })
  });
  assert.equal(prepared.status, 200);
  const preparedText = await prepared.text();
  const preparedEnvelope = JSON.parse(preparedText) as { data: { operation_id: string; state: string; args: { body: { format: string; payloadDigest: string; payloadLength: number } } } };
  assert.equal(preparedEnvelope.data.state, 'pending');
  assert.equal(preparedEnvelope.data.args.body.format, 'chatgpt');
  assert.equal(preparedEnvelope.data.args.body.payloadDigest, sha256(payload), 'canonical sha256 of the exact UTF-8 payload');
  assert.equal(preparedEnvelope.data.args.body.payloadLength, payload.length, 'exact UTF-16 code-unit length');
  assert.ok(!preparedText.includes(sentinel), 'raw payload must not appear in the prepare serialization');
  const inspected = await owner.request(`/api/authority/operation?id=${preparedEnvelope.data.operation_id}`);
  assert.equal(inspected.status, 200);
  const inspectedText = await inspected.text();
  assert.ok(inspectedText.includes(sha256(payload)) && !inspectedText.includes(sentinel), 'inspect exposes the digest, never the raw payload');
  assert.equal((await owner.decide(preparedEnvelope.data.operation_id, 'reject')).status, 200);

  // Digest determinism and encoding vectors.
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.notEqual(sha256(payload), sha256(`${payload}\n`), 'newline changes the digest');
  assert.notEqual(sha256(JSON.stringify({ t: 'caf\u00e9' })), sha256(JSON.stringify({ t: 'cafe\u0301' })), 'Unicode form is never normalized');

  // Approved exact identity; every encoding/format change cannot reuse it.
  const importHeaders = await owner.approve('POST', '/api/providers/import', exactBody, 'task:import-exact');
  for (const [label, body] of [
    ['changed payload (+LF)', { format: 'chatgpt', payload: `${payload}\n` }],
    ['changed format', { format: 'claude', payload }],
    ['added whitespace', { format: 'chatgpt', payload: payload.replace(':', ': ') }],
    ['CRLF form', { format: 'chatgpt', payload: `${payload}\r\n` }],
    ['NFD form', { format: 'chatgpt', payload: payload.replace('caf\u00e9', 'cafe\u0301') }]
  ] as Array<[string, unknown]>) {
    const changed = await owner.request('/api/providers/import', { method: 'POST', headers: importHeaders, body: JSON.stringify(body) });
    assert.equal(changed.status, 409, `${label} cannot reuse the approval`);
  }
  const historyAfterDenials = await owner.request('/api/chat/history');
  const denialsEnvelope = Envelope.safeParse(await historyAfterDenials.json());
  assert.equal(denialsEnvelope.success, true);
  if (!denialsEnvelope.success || !denialsEnvelope.data.ok) return assert.fail('history envelope broken');
  assert.deepEqual((denialsEnvelope.data.data as { conversations: unknown[] }).conversations, [], 'changed-input attempts leave zero effect');

  const applied = await owner.request('/api/providers/import', { method: 'POST', headers: importHeaders, body: JSON.stringify(exactBody) });
  assert.equal(applied.status, 200);
  const appliedBody = (await applied.json()) as { data: { imported: number; skipped: number; warnings: string[] } };
  assert.deepEqual(appliedBody.data, { imported: 3, skipped: 0, warnings: [] });
  const replay = await owner.request('/api/providers/import', { method: 'POST', headers: importHeaders, body: JSON.stringify(exactBody) });
  assert.equal(replay.status, 409, 'consumed import approval cannot replay');

  // Malformed export: schema-valid body, consumed authority, current 504.
  const badPayload = 'not json';
  const badHeaders = await owner.approve('POST', '/api/providers/import', { format: 'chatgpt', payload: badPayload }, 'task:import-malformed');
  const bad = await owner.request('/api/providers/import', { method: 'POST', headers: badHeaders, body: JSON.stringify({ format: 'chatgpt', payload: badPayload }) });
  assert.equal(bad.status, 504, 'malformed export keeps the current failure');
  const badBody = (await bad.json()) as { error: { code: string; message: string } };
  assert.equal(badBody.error.code, 'CHILD_FAILED');
  assert.match(badBody.error.message, /not valid JSON/);
  assert.equal((await owner.request('/api/providers/import', { method: 'POST', headers: badHeaders, body: JSON.stringify({ format: 'chatgpt', payload: badPayload }) })).status, 409, 'failure after consumption stays consumed');

  // Retention + parser caps: the first 200 conversations of an export are
  // processed (rest counted as skipped) and the store keeps the last 200.
  const bigPayload = exportOf(Array.from({ length: 201 }, (_, i) => conversation(1000 + i)));
  const bigHeaders = await owner.approve('POST', '/api/providers/import', { format: 'chatgpt', payload: bigPayload }, 'task:import-cap');
  const big = await owner.request('/api/providers/import', { method: 'POST', headers: bigHeaders, body: JSON.stringify({ format: 'chatgpt', payload: bigPayload }) });
  assert.equal(big.status, 200);
  const bigBody = (await big.json()) as { data: { imported: number; skipped: number } };
  assert.deepEqual({ imported: bigBody.data.imported, skipped: bigBody.data.skipped }, { imported: 200, skipped: 0 }, 'parser processes exactly the first 200 conversations; beyond-cap entries are dropped without being counted as skipped');
  const historyAfterCap = await owner.request('/api/chat/history');
  const capEnvelope = Envelope.safeParse(await historyAfterCap.json());
  assert.equal(capEnvelope.success, true);
  if (!capEnvelope.success || !capEnvelope.data.ok) return assert.fail('history envelope broken');
  const capped = (capEnvelope.data.data as { conversations: Array<{ title: string }> }).conversations;
  assert.equal(capped.length, 200, 'store keeps the last 200 conversations');
  assert.ok(capped.some(entry => entry.title === 'imported chat 1199'), 'newest imported conversation present');
  assert.ok(!capped.some(entry => entry.title === 'imported chat 1200'), 'conversations beyond the parser cap are never imported');
  assert.ok(!capped.some(entry => entry.title === 'imported chat 3'), 'older conversations evicted by retention');

  // Partial-import truth (service seam): not transactional, no rollback.
  let saveCalls = 0;
  const failingStore = { save: async () => { saveCalls += 1; if (saveCalls === 3) throw new Error('persist failed'); return { id: `x${saveCalls}` }; } };
  await assert.rejects(
    () => importChatExport(failingStore as unknown as Parameters<typeof importChatExport>[0], 'chatgpt', exportOf([conversation(1), conversation(2), conversation(3)])),
    /persist failed/
  );
  assert.equal(saveCalls, 3, 'earlier saves completed before the third failed (no rollback)');
  let parseCalls = 0;
  const untouchedStore = { save: async () => { parseCalls += 1; return {}; } };
  await assert.rejects(
    () => importChatExport(untouchedStore as unknown as Parameters<typeof importChatExport>[0], 'chatgpt', 'not json'),
    /not valid JSON/
  );
  assert.equal(parseCalls, 0, 'parse failures never touch the store');

  // Durable authority audit: raw payload and descriptor args never persist.
  const auditText = await fs.readFile(path.join(dir, '.aide', 'cipher-state.jsonl'), 'utf8');
  assert.ok(!auditText.includes(sentinel), 'audit journal never stores the raw payload');
  assert.ok(!auditText.includes('payloadDigest'), 'audit events do not persist descriptor args');
  const authorityRows = auditText.split('\n').filter(Boolean).map(line => JSON.parse(line) as { type: string; digest?: string });
  assert.ok(authorityRows.some(row => row.type === 'authority' && typeof row.digest === 'string' && /^[0-9a-f]{64}$/.test(row.digest)), 'canonical operation digest present per the authority contract');
});

test('POST /api/providers/import rejects oversized payloads', async () => {
  const response = await owner.request('/api/providers/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format: 'chatgpt', payload: 'x'.repeat(11_000_000) })
  });
  assert.equal(response.status, 400);
});
