import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';
import { Envelope } from '../../common/errors.ts';
import { ExerciseNextResponse, ExerciseAttemptResponse } from '../../common/contracts/exercise.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-exercise-routes-'));
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

async function attempt(id: string, answer: string) {
  return fetch(`${base}/api/academy/exercises/attempt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, answer })
  });
}

test('next returns a public exercise without the answer', async () => {
  const response = await fetch(`${base}/api/academy/exercises/next`);
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, true);
  if (!envelope.data.ok) return;
  const parsed = ExerciseNextResponse.safeParse(envelope.data.data);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  if ('empty' in parsed.data) return assert.fail('bank should not be empty');
  assert.match(parsed.data.exercise.id, /^py-/);
  assert.ok(!('answer' in parsed.data.exercise), 'answer must never be exposed');
});

test('wrong submission is verified by real execution and reveals the answer once', async () => {
  const response = await attempt('py-list-slice', '[1, 2, 3]');
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  if (!envelope.data.ok) return;
  const parsed = ExerciseAttemptResponse.safeParse(envelope.data.data);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.passed, false);
  assert.equal(parsed.data.revealed?.answer, '[2, 3]');
  assert.ok((parsed.data.revealed?.explanation ?? '').length > 10);
});

test('correct submission passes with no reveal and feeds learner state', async () => {
  const first = await attempt('py-string-repeat', 'ababab');
  const envelope = Envelope.safeParse(await first.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return assert.fail('attempt envelope broken');
  const parsed = ExerciseAttemptResponse.safeParse(envelope.data.data);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.deepEqual(parsed.data, { passed: true, revealed: null });

  const state = await fetch(`${base}/api/learner/state`);
  const stateEnvelope = Envelope.safeParse(await state.json());
  if (!stateEnvelope.success || !stateEnvelope.data.ok) return assert.fail('state envelope broken');
  const snapshot = stateEnvelope.data.data as { skills: Record<string, { attempts: number }> };
  assert.ok((snapshot.skills['python:string-format']?.attempts ?? 0) >= 1, 'attempt must feed learner mastery');
});

test('unknown exercise id returns NOT_FOUND envelope', async () => {
  const response = await attempt('no-such-exercise', 'x');
  assert.equal(response.status, 404);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, false);
  if (envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'NOT_FOUND');
});
