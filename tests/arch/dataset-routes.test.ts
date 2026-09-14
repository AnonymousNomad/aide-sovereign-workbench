import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';
import { pairFixture } from './authority-fixture.ts';
import { Envelope } from '../../common/errors.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-dataset-routes-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let owner: Awaited<ReturnType<typeof pairFixture>>;
let datasetId = '';

const datasetsDir = () => path.join(workspace, '.aide', 'datasets');
const indexRaw = () => fs.readFile(path.join(datasetsDir(), 'index.json'), 'utf8').catch(() => '');
const dirSnapshot = async () => {
  const names = await fs.readdir(datasetsDir()).catch(() => []);
  const out: Record<string, string> = {};
  for (const name of names.sort()) out[name] = await fs.readFile(path.join(datasetsDir(), name), 'utf8').catch(() => '');
  return out;
};

before(async () => {
  server = new ArchServer(workspace, path.join(workspace, 'arch-test.log'));
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

async function mutate(urlPath: string, payload: unknown, taskId: string) {
  const headers = await owner.approve('POST', urlPath, payload, taskId);
  const response = await owner.request(urlPath, { method: 'POST', headers, body: JSON.stringify(payload) });
  return { status: response.status, envelope: (await response.json()) as EnvelopeT };
}

async function read(urlPath: string) {
  const response = await owner.request(urlPath);
  return { status: response.status, envelope: (await response.json()) as EnvelopeT };
}

type EnvelopeT = { ok?: boolean; data?: unknown; error?: { code: string; message: string } };
const dataOf = (envelope: EnvelopeT): unknown => {
  const parsed = Envelope.safeParse(envelope);
  assert.ok(parsed.success && parsed.data.ok, 'envelope must be ok');
  return parsed.data.data;
};

test('dataset lifecycle over the envelope: create, append with gates, read (delete remains frozen)', async () => {
  const created = await mutate('/api/training/datasets', { name: 'SFT Pairs' }, 'task:ds-create');
  assert.equal(created.status, 200);
  datasetId = (dataOf(created.envelope) as { id: string }).id;
  assert.match(datasetId, /^sft-pairs-[0-9a-f]{6}$/);

  const appended = await mutate('/api/training/datasets/append', {
    id: datasetId,
    samples: [
      { text: 'A supervised fine-tuning sample with enough content to pass the gate.' },
      { input: 'question one?', output: 'answer one' },
      { text: 'tiny' },
      { text: 'A supervised fine-tuning sample with enough content to pass the gate.' }
    ]
  }, 'task:ds-append');
  assert.deepEqual(dataOf(appended.envelope), { accepted: 2, rejected_dupes: 1, rejected_invalid: 1, errors: ['#2: sample too short (<10 chars)'] });

  const listed = await read('/api/training/datasets');
  const metas = (dataOf(listed.envelope) as { datasets: Array<{ id: string; count: number }> }).datasets;
  assert.equal(metas.find(entry => entry.id === datasetId)?.count, 2);

  const page = await read(`/api/training/datasets/read?id=${encodeURIComponent(datasetId)}&offset=1&limit=5`);
  const readPage = dataOf(page.envelope) as { total: number; offset: number; samples: Array<Record<string, unknown>> };
  assert.equal(readPage.total, 2);
  assert.equal(readPage.offset, 1);
  assert.equal(readPage.samples.length, 1);

  // POST /api/training/datasets/delete is a D-wave destructive route and stays
  // frozen: paired callers fail closed until its own enrollment wave.
  const removed = await owner.request('/api/training/datasets/delete', { method: 'POST', body: JSON.stringify({ id: datasetId }) });
  assert.equal(removed.status, 403);
});

test('contract violations are rejected with BAD_REQUEST before reaching the store', async () => {
  const badCreate = await owner.request('/api/training/datasets', { method: 'POST', body: JSON.stringify({ name: 'x' }) });
  assert.equal(badCreate.status, 400);
  const badAppend = await owner.request('/api/training/datasets/append', { method: 'POST', body: JSON.stringify({ id: 'whatever', samples: [{ wrong: 1 }] }) });
  assert.equal(badAppend.status, 400);
  const emptyAppend = await owner.request('/api/training/datasets/append', { method: 'POST', body: JSON.stringify({ id: 'whatever', samples: [] }) });
  assert.equal(emptyAppend.status, 400);
});

test('unknown dataset reads and appends return NOT_FOUND envelopes', async () => {
  const missingRead = await read('/api/training/datasets/read?id=nope');
  assert.equal(missingRead.status, 404);
  const missingAppend = await mutate('/api/training/datasets/append', { id: 'nope', samples: [{ text: 'long enough content here' }] }, 'task:ds-missing');
  assert.equal(missingAppend.status, 404);
});

test('dataset authority: exact name/batch binding, zero mutation without approval, no path escape', async () => {
  const anonymous = await fetch(`${base}/api/training/datasets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Anonymous Attempt' })
  });
  assert.equal(anonymous.status, 403, 'anonymous actor rejected');

  const before = await dirSnapshot();
  const blocked = await owner.request('/api/training/datasets', { method: 'POST', body: JSON.stringify({ name: 'No Approval' }) });
  assert.equal(blocked.status, 409, 'paired actor without approval fails');
  assert.deepEqual(await dirSnapshot(), before, 'no mutation without approval');

  // Traversal-shaped names never reach the store and never create paths.
  const traversal = await owner.request('/api/authority/prepare', {
    method: 'POST',
    body: JSON.stringify({ method: 'POST', path: '/api/training/datasets', body: { name: '../escape' }, task_id: 'task:ds-traverse' })
  });
  assert.equal(traversal.status, 400, 'invalid dataset name fails before authorization');

  // Changed name cannot reuse an approval; the exact approved name executes.
  const original = { name: 'Bound Name' };
  const changed = { name: 'Changed Name' };
  const headers = await owner.approve('POST', '/api/training/datasets', original, 'task:ds-bound');
  const changedAttempt = await owner.request('/api/training/datasets', { method: 'POST', headers, body: JSON.stringify(changed) });
  assert.equal(changedAttempt.status, 409, 'changed name cannot reuse approval');
  const applied = await owner.request('/api/training/datasets', { method: 'POST', headers, body: JSON.stringify(original) });
  assert.equal(applied.status, 200, 'exact approved name executes');
  const boundId = (dataOf((await applied.json()) as EnvelopeT) as { id: string }).id;
  const replay = await owner.request('/api/training/datasets', { method: 'POST', headers, body: JSON.stringify(original) });
  assert.equal(replay.status, 409, 'consumed approval cannot replay');

  // Dataset names are trimmed before approval, and the handler writes the
  // same normalized name.
  const trimmed = await mutate('/api/training/datasets', { name: '  Trimmed Name  ' }, 'task:ds-trim');
  assert.equal(trimmed.status, 200);
  assert.equal((dataOf(trimmed.envelope) as { name: string }).name, 'Trimmed Name');

  // Append: dataset A approval cannot append to dataset B; changed batch cannot
  // reuse approval; replay fails; state stays durable and authority-free.
  const batchA = { text: 'the approved batch content for dataset A' };
  const batchB = { text: 'a different batch content for dataset B' };
  const appendHeaders = await owner.approve('POST', '/api/training/datasets/append', { id: datasetId, samples: [batchA] }, 'task:ds-append-bound');
  const wrongTarget = await owner.request('/api/training/datasets/append', { method: 'POST', headers: appendHeaders, body: JSON.stringify({ id: boundId, samples: [batchA] }) });
  assert.equal(wrongTarget.status, 409, 'dataset A approval cannot append to dataset B');
  const changedBatch = await owner.request('/api/training/datasets/append', { method: 'POST', headers: appendHeaders, body: JSON.stringify({ id: datasetId, samples: [batchB] }) });
  assert.equal(changedBatch.status, 409, 'changed batch cannot reuse approval');
  const appliedAppend = await owner.request('/api/training/datasets/append', { method: 'POST', headers: appendHeaders, body: JSON.stringify({ id: datasetId, samples: [batchA] }) });
  assert.equal(appliedAppend.status, 200, 'exact approved batch executes');
  const appendReplay = await owner.request('/api/training/datasets/append', { method: 'POST', headers: appendHeaders, body: JSON.stringify({ id: datasetId, samples: [batchA] }) });
  assert.equal(appendReplay.status, 409, 'consumed append approval cannot replay');

  // Durable persistence on disk; no authority material serialized.
  const index = await indexRaw();
  assert.match(index, new RegExp(datasetId));
  const token = owner.headers.Authorization.slice(7);
  assert.ok(!index.includes(token), 'dataset index must not serialize bearer material');
  assert.ok(!index.includes(owner.actorId), 'dataset index must not serialize actor identity');
  assert.ok(!index.includes(headers['X-AIDE-Operation']), 'dataset index must not serialize operation ids');
  const jsonl = await fs.readFile(path.join(datasetsDir(), `${datasetId}.jsonl`), 'utf8');
  assert.ok(!jsonl.includes(token) && !jsonl.includes(owner.actorId), 'dataset content must not serialize authority material');
});
