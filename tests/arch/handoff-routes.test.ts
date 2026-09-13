// tests/arch/handoff-routes.test.ts
// Wave 3J: Handoff export/import are approved exact operations.
//   export -> capability.write binding the normalized export request
//             {tier, confirmed, confirmed_secret_scan, include_code,
//              session_id, up_to_message_index}
//   import -> capability.write binding the complete normalized bundle
// Central reads (list/get) stay paired reads without approval, and the accepted
// storage-containment layer remains authoritative over any approval.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArchServer } from '../../node/src/server.ts';
import { pairFixture } from './authority-fixture.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-h1-arch-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let owner: Awaited<ReturnType<typeof pairFixture>>;

const handoffDir = () => path.join(workspace, '.aide', 'handoff');
const importedDir = () => path.join(handoffDir(), 'imported');

function validBundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    id: 'bundle-1',
    created_at: new Date().toISOString(),
    generator: 'test',
    tier: 'brief',
    brief: { task: 'imported task', decisions: [], open_questions: [], constraints: [] },
    distillation: 'auto',
    ...overrides
  };
}

async function listBundleFiles(): Promise<string[]> {
  return (await fs.readdir(handoffDir()).catch(() => [])).filter(name => name.endsWith('.json')).sort();
}

async function walkAide(): Promise<string[]> {
  return (await fs.readdir(path.join(workspace, '.aide'), { recursive: true }).catch(() => []))
    .map(entry => String(entry).replace(/\\/g, '/'))
    .sort();
}

before(async () => {
  await fs.writeFile(path.join(workspace, 'README.md'), '# demo\n\nhello line\n', 'utf8');
  server = new ArchServer(workspace, path.join(workspace, 'arch-h1.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const routes = await buildRoutes(workspace, 'test', { authority: server.authority, events: server.events });
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
  owner = await pairFixture(server, base);
});

after(async () => {
  server.events.close();
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

async function post<T>(pathName: string, payload: unknown, headers?: Record<string, string>): Promise<{ status: number; body: Envelope<T> }> {
  const response = await owner.request(pathName, {
    method: 'POST',
    ...(headers ? { headers } : {}),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function get<T>(pathName: string): Promise<{ status: number; body: Envelope<T> }> {
  const response = await owner.request(pathName, { signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function anonymousPost(pathName: string, payload: unknown): Promise<Response> {
  return fetch(`${base}${pathName}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000)
  });
}

test('export authority: anonymous, unapproved, malformed, changed fields and replay all fail closed', async () => {
  const body = { tier: 'brief' };
  assert.equal((await anonymousPost('/api/handoff/export', body)).status, 403, 'anonymous rejected');
  assert.equal((await post('/api/handoff/export', body)).status, 409, 'unapproved denied');
  assert.equal((await post('/api/handoff/export', { tier: 'bogus' })).status, 400, 'unknown tier rejected');
  assert.equal((await post('/api/handoff/export', { tier: 'transcript' })).status, 400, 'tier beyond brief requires confirmed');
  assert.equal((await post('/api/handoff/export', { tier: 'brief', include_code: true })).status, 400, 'include_code requires full tier');

  const before = await listBundleFiles();
  const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
    [{ tier: 'brief' }, { tier: 'full', confirmed: true }],
    [{ tier: 'brief', confirmed: true }, { tier: 'brief', confirmed: false }],
    [{ tier: 'brief' }, { tier: 'brief', confirmed_secret_scan: true }],
    [{ tier: 'full', confirmed: true }, { tier: 'full', confirmed: true, include_code: true }],
    [{ tier: 'brief' }, { tier: 'brief', session_id: 'session-other' }],
    [{ tier: 'brief' }, { tier: 'brief', up_to_message_index: 0 }]
  ];
  for (const [approvedBody, changedBody] of cases) {
    const headers = await owner.approve('POST', '/api/handoff/export', approvedBody, `task:h1-changed-${Object.keys(changedBody).join('-')}`);
    const changed = await post('/api/handoff/export', changedBody, headers);
    assert.equal(changed.status, 409, `changed input rejected (${JSON.stringify(changedBody)})`);
  }
  assert.deepEqual(await listBundleFiles(), before, 'no bundle may be written by rejected changed inputs');

  const headers = await owner.approve('POST', '/api/handoff/export', body, 'task:h1-export');
  const applied = await post<{ bundle_id: string; tier: string; file_path: string }>('/api/handoff/export', body, headers);
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.data?.tier, 'brief');
  assert.match(applied.body.data!.file_path, /^\.aide\/handoff\//);
  const replay = await post('/api/handoff/export', body, headers);
  assert.equal(replay.status, 409, 'consumed export approval cannot replay');
});

test('import authority: anonymous, unapproved, malformed, unsupported version, changed bundle and replay', async () => {
  const bundle = validBundle();
  assert.equal((await anonymousPost('/api/handoff/import', { bundle })).status, 403, 'anonymous rejected');
  assert.equal((await post('/api/handoff/import', { bundle })).status, 409, 'unapproved denied');
  assert.equal((await post('/api/handoff/import', { bundle: { nope: true } })).status, 400, 'malformed bundle rejected');
  assert.equal((await post('/api/handoff/import', { bundle: validBundle({ version: 2 }) })).status, 400, 'unsupported version rejected');

  const before = await listBundleFiles();
  const headers = await owner.approve('POST', '/api/handoff/import', { bundle }, 'task:h1-import');
  const changed = await post('/api/handoff/import', { bundle: validBundle({ brief: { task: 'mutated', decisions: [], open_questions: [], constraints: [] } }) }, headers);
  assert.equal(changed.status, 409, 'one-field change cannot reuse the approval');
  assert.deepEqual(await listBundleFiles(), before, 'no bundle written by a changed import');

  const applied = await post<{ context_id: string; message_count: number }>('/api/handoff/import', { bundle }, headers);
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.match(applied.body.data!.context_id, /^import-/);
  const replay = await post('/api/handoff/import', { bundle }, headers);
  assert.equal(replay.status, 409, 'consumed import approval cannot replay');
});

test('central reads stay paired reads: list and get need no approval', async () => {
  const list = await get<{ bundles: Array<{ id: string; imported: boolean }> }>('/api/handoff/bundles');
  assert.equal(list.status, 200);
  assert.ok((list.body.data?.bundles.length ?? 0) >= 1);
  const id = list.body.data!.bundles.find(bundle => bundle.imported === false)!.id;
  const bundle = await get<{ id: string; version: number }>(`/api/handoff/bundles/get?id=${id}`);
  assert.equal(bundle.status, 200);
  assert.equal(bundle.body.data?.id, id);
  assert.equal(bundle.body.data?.version, 1);
  assert.equal(list.body.data!.bundles.some(entry => entry.imported === true), true, 'imported bundle is listed');
});

test('secret-bearing transcript is still scanned under an approved export', async () => {
  const startBody = { task: 'leak test with key sk-' + 'abcdefghijklmnop12345678', mode: 'plan' };
  const startHeaders = await owner.approve('POST', '/api/agent/start', startBody, 'task:h1-agent');
  const started = await owner.request('/api/agent/start', {
    method: 'POST', headers: startHeaders, body: JSON.stringify(startBody), signal: AbortSignal.timeout(15000)
  });
  assert.equal(started.status, 200);
  const sessionId = ((await started.json()) as Envelope<{ session_id: string }>).data!.session_id;

  const refuseBody = { tier: 'transcript', confirmed: true, session_id: sessionId };
  const refuseHeaders = await owner.approve('POST', '/api/handoff/export', refuseBody, 'task:h1-secret-refuse');
  const refused = await post('/api/handoff/export', refuseBody, refuseHeaders);
  assert.equal(refused.status, 403, 'domain secret-scan policy rejects despite approval');
  assert.equal(refused.body.error?.code, 'FORBIDDEN');

  const allowBody = { tier: 'transcript', confirmed: true, confirmed_secret_scan: true, session_id: sessionId };
  const allowHeaders = await owner.approve('POST', '/api/handoff/export', allowBody, 'task:h1-secret-allow');
  const allowed = await post<{ bundle_id: string; message_count: number }>('/api/handoff/export', allowBody, allowHeaders);
  assert.equal(allowed.status, 200, 'acknowledgement elects to publish the scanned content');
  assert.ok((allowed.body.data?.message_count ?? 0) >= 2, 'the capture still produced the transcript');
});

test('containment stays authoritative over approved operations', async () => {
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'handoff-route-outside-'));
  const realDir = path.join(workspace, '.aide', 'handoff-real');
  const rootDir = handoffDir();
  const importedReal = path.join(rootDir, 'imported-real');
  try {
    // Export: approve while the root is safe, then swap in a junction before execution.
    const exportBody = { tier: 'brief' };
    const exportHeaders = await owner.approve('POST', '/api/handoff/export', exportBody, 'task:h1-contained-export');
    await fs.rename(rootDir, realDir);
    await fs.symlink(outsideDir, rootDir, 'junction');
    try {
      const blocked = await post('/api/handoff/export', exportBody, exportHeaders);
      assert.equal(blocked.status, 400, 'approved export fails closed on the junctioned root');
      assert.deepEqual(await fs.readdir(outsideDir), [], 'no outside write');
    } finally {
      await fs.rm(rootDir, { force: true });
      await fs.rename(realDir, rootDir);
    }

    // Import: approve while the subroot is safe, then swap in a junction.
    const bundle = validBundle({ id: 'contained-import' });
    const importHeaders = await owner.approve('POST', '/api/handoff/import', { bundle }, 'task:h1-contained-import');
    await fs.rename(importedDir(), importedReal);
    await fs.symlink(outsideDir, importedDir(), 'junction');
    try {
      const blocked = await post('/api/handoff/import', { bundle }, importHeaders);
      assert.equal(blocked.status, 400, 'approved import fails closed on the junctioned subroot');
      assert.deepEqual(await fs.readdir(outsideDir), [], 'no outside write');
    } finally {
      await fs.rm(importedDir(), { force: true });
      await fs.rename(importedReal, importedDir());
    }
  } finally {
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

test('import remains inert: no adoption into memory, context, sessions, or authority state', async () => {
  const before = await walkAide();
  const bundle = validBundle({ id: 'inert-import' });
  const headers = await owner.approve('POST', '/api/handoff/import', { bundle }, 'task:h1-inert');
  const applied = await post<{ context_id: string }>('/api/handoff/import', { bundle }, headers);
  assert.equal(applied.status, 200);
  const contextId = applied.body.data!.context_id;

  const after = await walkAide();
  const added = after.filter(entry => !before.includes(entry));
  assert.deepEqual(added, [`handoff/imported/${contextId}.json`], 'the only new artifact is the imported bundle itself');

  const sessions = await get<{ sessions?: Array<{ session_id: string }> }>('/api/agent/sessions');
  if (sessions.status === 200) {
    assert.equal((sessions.body.data?.sessions ?? []).some(session => session.session_id === contextId), false, 'imported context is not a session');
  }
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
