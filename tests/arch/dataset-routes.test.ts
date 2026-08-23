import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';
import { Envelope } from '../../common/errors.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-dataset-routes-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let datasetId = '';

before(async () => {
  server = new ArchServer(workspace, path.join(workspace, 'arch-test.log'));
  const routes = await buildRoutes(workspace, 'test');
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
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

async function post(pathName: string, payload: unknown) {
  return fetch(`${base}${pathName}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
}

test('dataset lifecycle over the envelope: create, append with gates, read, delete', async () => {
  const created = await post('/api/training/datasets', { name: 'SFT Pairs' });
  assert.equal(created.status, 200);
  const createdEnvelope = Envelope.safeParse(await created.json());
  assert.equal(createdEnvelope.success, true);
  if (!createdEnvelope.success || !createdEnvelope.data.ok) return assert.fail('create envelope broken');
  datasetId = (createdEnvelope.data.data as { id: string }).id;
  assert.match(datasetId, /^sft-pairs-[0-9a-f]{6}$/);

  const appended = await post('/api/training/datasets/append', {
    id: datasetId,
    samples: [
      { text: 'A supervised fine-tuning sample with enough content to pass the gate.' },
      { input: 'question one?', output: 'answer one' },
      { text: 'tiny' },
      { text: 'A supervised fine-tuning sample with enough content to pass the gate.' }
    ]
  });
  const appendedEnvelope = Envelope.safeParse(await appended.json());
  if (!appendedEnvelope.success || !appendedEnvelope.data.ok) return assert.fail('append envelope broken');
  assert.deepEqual(appendedEnvelope.data.data, { accepted: 2, rejected_dupes: 1, rejected_invalid: 1, errors: ['#2: sample too short (<10 chars)'] });

  const listed = await fetch(`${base}/api/training/datasets`);
  const listEnvelope = Envelope.safeParse(await listed.json());
  if (!listEnvelope.success || !listEnvelope.data.ok) return assert.fail('list envelope broken');
  const metas = (listEnvelope.data.data as { datasets: Array<{ id: string; count: number }> }).datasets;
  assert.equal(metas.find(entry => entry.id === datasetId)?.count, 2);

  const page = await fetch(`${base}/api/training/datasets/read?id=${encodeURIComponent(datasetId)}&offset=1&limit=5`);
  const pageEnvelope = Envelope.safeParse(await page.json());
  if (!pageEnvelope.success || !pageEnvelope.data.ok) return assert.fail('read envelope broken');
  const read = pageEnvelope.data.data as { total: number; offset: number; samples: Array<Record<string, unknown>> };
  assert.equal(read.total, 2);
  assert.equal(read.offset, 1);
  assert.equal(read.samples.length, 1);

  const removed = await post('/api/training/datasets/delete', { id: datasetId });
  const removedEnvelope = Envelope.safeParse(await removed.json());
  if (!removedEnvelope.success || !removedEnvelope.data.ok) return assert.fail('delete envelope broken');
  assert.deepEqual(removedEnvelope.data.data, { deleted: true });
});

test('contract violations are rejected with BAD_REQUEST before reaching the store', async () => {
  const badCreate = await post('/api/training/datasets', { name: 'x' });
  assert.equal(badCreate.status, 400);
  const badAppend = await post('/api/training/datasets/append', { id: 'whatever', samples: [{ wrong: 1 }] });
  assert.equal(badAppend.status, 400);
  const emptyAppend = await post('/api/training/datasets/append', { id: 'whatever', samples: [] });
  assert.equal(emptyAppend.status, 400);
});

test('unknown dataset reads and appends return NOT_FOUND envelopes', async () => {
  const missingRead = await fetch(`${base}/api/training/datasets/read?id=nope`);
  assert.equal(missingRead.status, 404);
  const missingAppend = await post('/api/training/datasets/append', { id: 'nope', samples: [{ text: 'long enough content here' }] });
  assert.equal(missingAppend.status, 404);
});
