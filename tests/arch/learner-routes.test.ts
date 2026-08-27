import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';
import { Envelope } from '../../common/errors.ts';
import { LearnerSnapshotResponse, LearnerAttemptResponse, LearnerReviewsResponse } from '../../common/contracts/learner.ts';
import { LearnerState } from '../../academy/learner-state.mjs';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-learner-routes-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;

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
  server.events.close();
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

test('GET /api/learner/state starts empty under the envelope', async () => {
  const response = await fetch(`${base}/api/learner/state`);
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, true);
  if (!envelope.data.ok) return;
  const payload = LearnerSnapshotResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(payload.data.schema_version, 1);
  assert.deepEqual(payload.data.skills, {});
});

test('POST /api/learner/attempt records a mastery update', async () => {
  const response = await fetch(`${base}/api/learner/attempt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skill_id: 'python:loops', passed: true, misconception_tags: [] })
  });
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  if (!envelope.data.ok) return;
  const payload = LearnerAttemptResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(payload.data.skillId, 'python:loops');
  assert.equal(payload.data.attempts, 1);
  assert.ok(payload.data.mastery > 0.5);

  const state = await fetch(`${base}/api/learner/state`);
  const stateEnvelope = Envelope.safeParse(await state.json());
  if (!stateEnvelope.success || !stateEnvelope.data.ok) return assert.fail('state envelope broken after attempt');
  const snapshot = LearnerSnapshotResponse.safeParse(stateEnvelope.data.data);
  assert.equal(snapshot.success, true);
  if (!snapshot.success) return;
  assert.equal(snapshot.data.skills['python:loops']?.attempts, 1);
  assert.equal(snapshot.data.attempts.length, 1);
});

test('POST /api/learner/attempt rejects invalid bodies with BAD_REQUEST', async () => {
  const response = await fetch(`${base}/api/learner/attempt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skill_id: 'x', passed: 'yes' })
  });
  assert.equal(response.status, 400);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, false);
  if (envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'BAD_REQUEST');
});

test('GET /api/learner/reviews is empty immediately after a pass', async () => {
  const response = await fetch(`${base}/api/learner/reviews`);
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  if (!envelope.data.ok) return;
  const payload = LearnerReviewsResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.deepEqual(payload.data.reviews, []);
});

test('dueReviews surfaces backdated skills at the class level', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-learner-due-'));
  try {
    const state = new LearnerState({ statePath: path.join(dir, 'learner-state.json') });
    await state.load();
    await state.recordAttempt('python:string-format', { passed: false, at: new Date(Date.now() - 3 * 86400000).toISOString() });
    const due = state.dueReviews();
    assert.ok(due.some(entry => entry.skillId === 'python:string-format'), 'failed attempt from 3 days ago must be due');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
