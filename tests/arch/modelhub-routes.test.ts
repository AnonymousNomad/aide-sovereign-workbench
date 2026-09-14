// tests/arch/modelhub-routes.test.ts
// Wave 3G: ModelHub download/cancel are approved exact operations.
//   download -> capability.external binding {repo_id, filename, quant_label};
//               egress host pinned by the service; the accepted containment
//               layer independently rejects unsafe filesystem effects.
//   cancel   -> capability.execute binding {job_id}; targets only the
//               service-owned job map entry (no PID/URL/path ever supplied).
// Deterministic fake fetch only; no live Hugging Face download. The models
// import route remains migration-waived and is asserted as such.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { createHubService } from '../../node/src/services/modelhub.mjs';
import { routesForModelHub } from '../../node/src/routes/modelhub.ts';
import { routesForAuthority } from '../../node/src/routes/authority.ts';
import { pairFixture } from './authority-fixture.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-m-arch-'));
const modelsDir = path.join(workspace, 'models');
const PAYLOAD = Buffer.from('M-ARCH-PAYLOAD-BYTES');
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let owner: Awaited<ReturnType<typeof pairFixture>>;
let hub: ReturnType<typeof createHubService>;

const fetchedUrls: string[] = [];
let releaseSlow: (() => void) | null = null;
let slowMode = false;
let searchFailureStatus = 0;
const SEARCH_JSON = JSON.stringify([
  { id: 'org/model-1', downloads: 5, likes: 2, tags: ['gguf', 'text-generation'] },
  { id: 'org/model-2', downloads: 1, likes: 0, tags: [] }
]);

const fakeFetch = (async (input: unknown) => {
  const target = String(input);
  fetchedUrls.push(target);
  if (target.includes('/api/models?')) {
    if (searchFailureStatus !== 0) {
      const status = searchFailureStatus;
      searchFailureStatus = 0;
      return new Response('upstream failure', { status });
    }
    return new Response(SEARCH_JSON, { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (slowMode) {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    releaseSlow = release;
    return new Response(new ReadableStream({
      async start(controller) {
        controller.enqueue(PAYLOAD.subarray(0, 4));
        await gate;
        try {
          controller.enqueue(PAYLOAD.subarray(4));
          controller.close();
        } catch { /* stream already cancelled */ }
      }
    }), { status: 200, headers: { 'content-length': String(PAYLOAD.length) } });
  }
  return new Response(PAYLOAD, {
    status: 200,
    headers: { 'content-length': String(PAYLOAD.length), etag: '"arch"' }
  });
}) as typeof fetch;

before(async () => {
  await fs.mkdir(modelsDir, { recursive: true });
  server = new ArchServer(workspace, path.join(workspace, 'arch-m.log'));
  hub = createHubService({ workspace, modelsDir, fetchImpl: fakeFetch, onEvent: () => {} });
  for (const route of routesForAuthority()) server.route(route);
  for (const route of routesForModelHub(hub)) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
  owner = await pairFixture(server, base);
});

after(async () => {
  hub.close();
  httpServer.closeAllConnections();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  server.authority.control.close();
  server.events.close();
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

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 8000, label = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function waitForJob(jobId: string, status: string, timeoutMs = 10000): Promise<ReturnType<typeof hub.listDownloads>[number]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = hub.listDownloads().find(candidate => candidate.job_id === jobId);
    if (job && job.status === status) return job;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`job ${jobId} did not reach ${status}`);
}

// The job status flips to done before the manifest is published (existing
// ordering); the done event is the authoritative completion signal.
async function waitForDoneEvent(jobId: string, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hub.listEvents().some(event => event.event === 'done' && event.job_id === jobId)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`done event for ${jobId} not observed`);
}

async function searchJournal(): Promise<Array<{ action: string; url: string }>> {
  const raw = await fs.readFile(path.join(workspace, '.aide', 'egress', 'journal.jsonl'), 'utf8').catch(() => '');
  return raw.split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as { action: string; url: string })
    .filter(entry => entry.action === 'modelhub.search');
}

test('download: approved exact operation is the only way to start an egress job', async () => {
  const body = { repo_id: 'org/repo', filename: 'arch-model.gguf', quant_label: 'Q4_K_M' };

  assert.equal((await anonymousPost('/api/modelhub/download', body)).status, 403, 'anonymous rejected');
  assert.equal((await post('/api/modelhub/download', body)).status, 409, 'unapproved denied');
  assert.equal((await post('/api/modelhub/download', { repo_id: 'no-slash', filename: 'x.gguf' })).status, 400, 'malformed repo rejected');
  assert.equal((await post('/api/modelhub/download', { repo_id: 'org/repo', filename: '../evil.bin' })).status, 400, 'traversal rejected');
  assert.equal((await post('/api/modelhub/download', { ...body, url: 'https://evil.example/x' })).status, 400, 'no caller URL field exists');
  assert.equal(fetchedUrls.length, 0, 'no egress before approval');

  const headers = await owner.approve('POST', '/api/modelhub/download', body, 'task:hub-download');
  assert.equal((await post('/api/modelhub/download', { ...body, repo_id: 'other/repo' }, headers)).status, 409, 'changed repo_id rejected');
  assert.equal((await post('/api/modelhub/download', { ...body, filename: 'other.gguf' }, headers)).status, 409, 'changed filename rejected');
  assert.equal((await post('/api/modelhub/download', { ...body, quant_label: 'Q8_0' }, headers)).status, 409, 'changed quant_label rejected');
  assert.equal(fetchedUrls.length, 0, 'changed inputs reject before any egress');

  const urlsBefore = fetchedUrls.length;
  const started = await post<{ job_id: string }>('/api/modelhub/download', body, headers);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const jobId = started.body.data!.job_id;
  assert.ok(jobId);
  await waitForJob(jobId, 'done');
  await waitForDoneEvent(jobId);
  assert.equal(fetchedUrls.length, urlsBefore + 1);
  assert.equal(fetchedUrls[urlsBefore], 'https://huggingface.co/org/repo/resolve/main/arch-model.gguf');
  assert.equal((await fs.readFile(path.join(modelsDir, 'arch-model.gguf'))).equals(PAYLOAD), true);
  const manifest = JSON.parse(await fs.readFile(path.join(modelsDir, 'arch-model.gguf.manifest.json'), 'utf8'));
  assert.equal(manifest.repo_id, 'org/repo');
  assert.equal(manifest.quant_label, 'Q4_K_M');

  assert.equal((await post('/api/modelhub/download', body, headers)).status, 409, 'consumed download approval cannot replay');
  assert.equal(fetchedUrls.length, urlsBefore + 1, 'replay performs no second egress');
});

test('download: hostile-looking repo id cannot redirect the egress host', async () => {
  const body = { repo_id: 'evil.com/x', filename: 'hostile.gguf', quant_label: null };
  const headers = await owner.approve('POST', '/api/modelhub/download', body, 'task:hub-hostile');
  const started = await post<{ job_id: string }>('/api/modelhub/download', body, headers);
  assert.equal(started.status, 200);
  await waitForJob(started.body.data!.job_id, 'done');
  const url = fetchedUrls[fetchedUrls.length - 1]!;
  assert.ok(url.startsWith('https://huggingface.co/'), `host must stay pinned: ${url}`);
  assert.ok(url.includes('/evil.com/x/resolve/main/'), url);
});

test('download: authority approval never overrides containment (nested junction fails closed)', async () => {
  const outside = path.join(workspace, 'outside-target');
  await fs.mkdir(outside, { recursive: true });
  await fs.symlink(outside, path.join(modelsDir, 'sub'), 'junction');
  const body = { repo_id: 'org/repo', filename: 'sub/evil.gguf', quant_label: null };
  const headers = await owner.approve('POST', '/api/modelhub/download', body, 'task:hub-contained');
  const started = await post<{ job_id: string }>('/api/modelhub/download', body, headers);
  assert.equal(started.status, 200, 'authority approves the exact operation');
  const job = await waitForJob(started.body.data!.job_id, 'error');
  assert.match(job.error ?? '', /containment/i);
  assert.deepEqual(await fs.readdir(outside), [], 'nothing may be written outside the models root');
});

test('cancel: approved exact operation targets only the owned job', async () => {
  const unknownBody = { job_id: 'does-not-exist' };
  assert.equal((await anonymousPost('/api/modelhub/downloads/cancel', unknownBody)).status, 403, 'anonymous rejected');
  assert.equal((await post('/api/modelhub/downloads/cancel', unknownBody)).status, 409, 'unapproved denied');
  const unknownHeaders = await owner.approve('POST', '/api/modelhub/downloads/cancel', unknownBody, 'task:hub-cancel-unknown');
  const unknown = await post<{ cancelled: boolean }>('/api/modelhub/downloads/cancel', unknownBody, unknownHeaders);
  assert.equal(unknown.status, 200, JSON.stringify(unknown.body));
  assert.equal(unknown.body.data?.cancelled, false, 'unknown job preserves the false contract');
  assert.equal((await post('/api/modelhub/downloads/cancel', unknownBody, unknownHeaders)).status, 409, 'replay rejected');

  const doneJob = hub.listDownloads().find(job => job.status === 'done');
  assert.ok(doneJob, 'a completed download exists from the earlier tests');
  const doneBody = { job_id: doneJob.job_id };
  const doneHeaders = await owner.approve('POST', '/api/modelhub/downloads/cancel', doneBody, 'task:hub-cancel-done');
  const done = await post<{ cancelled: boolean }>('/api/modelhub/downloads/cancel', doneBody, doneHeaders);
  assert.equal(done.body.data?.cancelled, false, 'completed job preserves the false contract');

  slowMode = true;
  const activeBody = { repo_id: 'org/repo', filename: 'slow-cancel.gguf', quant_label: null };
  const activeHeaders = await owner.approve('POST', '/api/modelhub/download', activeBody, 'task:hub-download-slow');
  const activeStarted = await post<{ job_id: string }>('/api/modelhub/download', activeBody, activeHeaders);
  assert.equal(activeStarted.status, 200);
  const activeJobId = activeStarted.body.data!.job_id;
  await waitFor(async () => {
    try { await fs.access(path.join(modelsDir, 'slow-cancel.gguf.part')); return true; } catch { return false; }
  }, 8000, 'slow partial file');

  const cancelHeaders = await owner.approve('POST', '/api/modelhub/downloads/cancel', { job_id: activeJobId }, 'task:hub-cancel-active');
  assert.equal((await post('/api/modelhub/downloads/cancel', { job_id: 'other-job-id' }, cancelHeaders)).status, 409, 'changed job id rejected');
  const cancelled = await post<{ cancelled: boolean }>('/api/modelhub/downloads/cancel', { job_id: activeJobId }, cancelHeaders);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data?.cancelled, true);
  releaseSlow?.();
  releaseSlow = null;
  slowMode = false;
  await waitForJob(activeJobId, 'cancelled');
  await assert.rejects(() => fs.access(path.join(modelsDir, 'slow-cancel.gguf.part')));
  await assert.rejects(() => fs.access(path.join(modelsDir, 'slow-cancel.gguf')));

  const againHeaders = await owner.approve('POST', '/api/modelhub/downloads/cancel', { job_id: activeJobId }, 'task:hub-cancel-again');
  const again = await post<{ cancelled: boolean }>('/api/modelhub/downloads/cancel', { job_id: activeJobId }, againHeaders);
  assert.equal(again.body.data?.cancelled, false, 'already-cancelled job preserves the false contract');
});

test('search: read enrollment binds the exact query, egress journal and pinned host', async () => {
  // Malformed strict contract preserved (pre-authority 400s, no network).
  assert.equal((await get('/api/modelhub/search')).status, 400);
  assert.equal((await get('/api/modelhub/search?q=')).status, 400);
  assert.equal((await get('/api/modelhub/search?q=tiny&sort=stars')).status, 400);
  assert.equal((await get('/api/modelhub/search?q=tiny&limit=0')).status, 400);
  assert.equal((await get('/api/modelhub/search?q=tiny&limit=51')).status, 400);
  assert.equal((await get(`/api/modelhub/search?q=${'x'.repeat(201)}`)).status, 400);
  const anonymous = await fetch(`${base}/api/modelhub/search?q=anon`, { signal: AbortSignal.timeout(5000) });
  assert.equal(anonymous.status, 403, 'anonymous rejected');
  const fetchesBefore = fetchedUrls.length;
  const journalBefore = (await searchJournal()).length;

  // Control-plane identity: exact q/sort/limit, server workspace, read kind.
  const handle = server.authority.authenticate(owner.headers.Authorization.slice(7), 'http://fixture.local');
  const searchInput = (q: string, sort: string | null, limit: number | null) => ({
    workspace: path.resolve(workspace), taskId: 'task:search-digest', kind: 'capability.read',
    args: { body: { q, sort, limit } }
  });
  const prepared = await server.authority.prepare(handle, searchInput('gemma tiny', 'likes', 7));
  assert.equal(prepared.kind, 'capability.read');
  assert.equal(prepared.workspace, path.resolve(workspace));
  assert.deepEqual(prepared.args, { body: { q: 'gemma tiny', sort: 'likes', limit: 7 } });
  const omitted = await server.authority.prepare(handle, searchInput('gemma tiny', null, null));
  assert.deepEqual(omitted.args, { body: { q: 'gemma tiny', sort: null, limit: null } });
  const explicit = await server.authority.prepare(handle, searchInput('gemma tiny', 'downloads', 20));
  assert.notEqual(omitted.digest, explicit.digest, 'omitted != explicit default in the authority identity');

  // Changed-input attacks at the authority boundary: CONFLICT, no egress.
  for (const changed of [searchInput('changed q', 'likes', 7), searchInput('gemma tiny', 'modified', 7), searchInput('gemma tiny', 'likes', 8)]) {
    await assert.rejects(() => server.authority.execute(handle, prepared.operation_id, changed, async () => 'never'), /changed after approval/);
  }
  assert.equal(fetchedUrls.length, fetchesBefore, 'changed inputs produced zero fetch');
  assert.equal((await searchJournal()).length, journalBefore, 'changed inputs produced zero journal effect');

  // Approved exact read (paired actor; capability.read is the accepted policy):
  // pinned endpoint, mapped bounded response, one egress journal entry.
  const applied = await get(`/api/modelhub/search?q=${encodeURIComponent('gemma tiny')}&sort=likes&limit=7`);
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.deepEqual(applied.body.data, {
    models: [
      { repo_id: 'org/model-1', downloads: 5, likes: 2, tags: ['gguf', 'text-generation'] },
      { repo_id: 'org/model-2', downloads: 1, likes: 0, tags: [] }
    ]
  });
  assert.equal(fetchedUrls.length, fetchesBefore + 1, 'exactly one pinned fetch');
  const called = new URL(fetchedUrls[fetchesBefore]!);
  assert.equal(called.origin, 'https://huggingface.co');
  assert.equal(called.pathname, '/api/models');
  assert.equal(called.searchParams.get('search'), 'gemma tiny');
  assert.equal(called.searchParams.get('filter'), 'gguf');
  assert.equal(called.searchParams.get('sort'), 'likes');
  assert.equal(called.searchParams.get('direction'), '-1');
  assert.equal(called.searchParams.get('limit'), '7');
  const after = await searchJournal();
  assert.equal(after.length, journalBefore + 1, 'approved search writes exactly one egress journal entry');
  assert.equal(after[after.length - 1]!.url, fetchedUrls[fetchesBefore]);

  // URL-injection payload stays fully encoded; host/filter/direction pinned.
  const inject = 'x&filter=evil&direction=1#frag';
  const injected = await get(`/api/modelhub/search?q=${encodeURIComponent(inject)}`);
  assert.equal(injected.status, 200);
  const injectedUrl = new URL(fetchedUrls[fetchedUrls.length - 1]!);
  assert.equal(injectedUrl.origin, 'https://huggingface.co');
  assert.equal(injectedUrl.searchParams.get('search'), inject);
  assert.equal(injectedUrl.searchParams.get('filter'), 'gguf');
  assert.equal(injectedUrl.searchParams.get('direction'), '-1');

  // Server-owned defaults preserved when optionals are omitted.
  assert.equal((await get('/api/modelhub/search?q=defaults')).status, 200);
  const defaultUrl = new URL(fetchedUrls[fetchedUrls.length - 1]!);
  assert.equal(defaultUrl.searchParams.get('sort'), 'downloads');
  assert.equal(defaultUrl.searchParams.get('limit'), '20');

  // Read-class dispatch never honors caller operation ids: the exact current
  // request is auto-prepared and executed (no caller substitution surface).
  const foreign = await owner.request('/api/modelhub/search?q=foreign-id', {
    headers: { 'X-AIDE-Operation': '00000000-0000-4000-8000-000000000000' }, signal: AbortSignal.timeout(15000)
  });
  assert.equal(foreign.status, 200, 'foreign operation id has no authority effect for reads');
  assert.equal((await foreign.json() as { ok: boolean }).ok, true);

  // Upstream failure preserves the current mapping (UPSTREAM -> BAD_RESPONSE)
  // and the egress journal stays truthful (the attempt is recorded first).
  searchFailureStatus = 503;
  const journalBeforeFailure = (await searchJournal()).length;
  const failure = await get('/api/modelhub/search?q=upstream-down');
  assert.equal(failure.status, 500, JSON.stringify(failure.body));
  assert.equal(failure.body.error?.code, 'BAD_RESPONSE');
  assert.equal((await searchJournal()).length, journalBeforeFailure + 1, 'attempt journaled before the failing fetch');
});

test('downloads list holds shape for the authorized actor', async () => {
  const list = await get<{ jobs: Array<{ job_id: string; status: string; bytes_done: number; bytes_total: number | null; error: string | null }> }>('/api/modelhub/downloads');
  assert.equal(list.status, 200);
  assert.equal(list.body.ok, true);
  assert.ok((list.body.data?.jobs.length ?? 0) >= 1);
  for (const job of list.body.data!.jobs) {
    assert.equal(typeof job.job_id, 'string');
    assert.equal(typeof job.status, 'string');
    assert.equal(typeof job.bytes_done, 'number');
  }
});

test('models import remains migration-waived (fail closed)', async () => {
  const response = await post('/api/models/import', { path: path.join(workspace, 'outside.gguf') });
  assert.equal(response.status, 403, 'waived route stays fail-closed until its own wave');
});
