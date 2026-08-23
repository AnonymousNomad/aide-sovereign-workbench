import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';
import { Envelope } from '../../common/errors.ts';
import { HintResult } from '../../common/contracts/hint.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-hint-routes-'));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
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

async function fetchHint(course: string, lesson: string, after?: number) {
  const suffix = after === undefined ? '' : `&after=${after}`;
  return fetch(`${base}/api/academy/hint?course=${encodeURIComponent(course)}&lesson=${encodeURIComponent(lesson)}${suffix}`);
}

test('hint route walks the ladder level by level', async () => {
  const first = await fetchHint('python-foundations', 'variables');
  assert.equal(first.status, 200);
  const envelope = Envelope.safeParse(await first.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, true);
  if (!envelope.data.ok) return;
  const parsed = HintResult.safeParse(envelope.data.data);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  if ('exhausted' in parsed.data) return assert.fail('first hint must not be exhausted');
  assert.equal(parsed.data.level, 1);
  assert.equal(parsed.data.remaining, 2);

  const second = await fetchHint('python-foundations', 'variables', 1);
  const secondEnvelope = Envelope.safeParse(await second.json());
  if (!secondEnvelope.success || !secondEnvelope.data.ok) return assert.fail('second hint envelope broken');
  const secondParsed = HintResult.safeParse(secondEnvelope.data.data);
  if (!secondParsed.success || 'exhausted' in secondParsed.data) return assert.fail('second hint must be a real hint');
  assert.equal(secondParsed.data.level, 2);

  const third = await fetchHint('python-foundations', 'variables', 2);
  const thirdEnvelope = Envelope.safeParse(await third.json());
  if (!thirdEnvelope.success || !thirdEnvelope.data.ok) return assert.fail('third hint envelope broken');
  const thirdParsed = HintResult.safeParse(thirdEnvelope.data.data);
  if (!thirdParsed.success || 'exhausted' in thirdParsed.data) return assert.fail('third hint must be a real hint');
  assert.equal(thirdParsed.data.level, 3);
});

test('hint route reports exhaustion after the last level', async () => {
  const response = await fetchHint('python-foundations', 'variables', 3);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  if (!envelope.data.ok) return;
  const parsed = HintResult.safeParse(envelope.data.data);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.deepEqual(parsed.data, { exhausted: true, revealed: 3 });
});

test('hints never leak the lesson check payload', async () => {
  for (const [course, lessons] of [['python-foundations', ['variables', 'control-flow', 'capstone']], ['ml-ai-foundations', ['data', 'tokens', 'capstone']]] as Array<[string, string[]]>) {
    for (const lesson of lessons) {
      for (const after of [0, 1, 2]) {
        const response = await fetchHint(course, lesson, after);
        const envelope = Envelope.safeParse(await response.json());
        assert.equal(envelope.success, true, `${course}/${lesson}/${after} envelope`);
        if (!envelope.success) continue;
        if (!envelope.data.ok) continue;
        const parsed = HintResult.safeParse(envelope.data.data);
        assert.equal(parsed.success, true, `${course}/${lesson}/${after} contract`);
        if (!parsed.success) continue;
        if ('text' in parsed.data) {
          const check = JSON.parse(await fs.readFile(path.join(repoRoot, 'academy', 'courses', `${course}.json`), 'utf8')) as { lessons: Array<{ id: string; check?: string }> };
          const expected = check.lessons.find(entry => entry.id === lesson)?.check ?? '';
          if (expected.length > 0) {
            assert.ok(!parsed.data.text.includes(expected), `verbatim check leaked at ${course}/${lesson}/${after}`);
          }
        }
      }
    }
  }
});

test('unknown course or lesson returns NOT_FOUND envelope', async () => {
  const missingLesson = await fetchHint('python-foundations', 'no-such-lesson');
  assert.equal(missingLesson.status, 404);
  const missingCourse = await fetchHint('no-such-course', 'variables');
  assert.equal(missingCourse.status, 404);
  const envelope = Envelope.safeParse(await missingLesson.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, false);
  if (envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'NOT_FOUND');
});
