import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import type { TaskEventT } from '../../common/contracts/tasks.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-b2-problems-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;

const TSC_LINE = "src/index.ts(10,5): error TS2304: Cannot find name 'foo'.";
const TASKS_JSON = JSON.stringify({
  version: '2.0.0',
  tasks: [
    {
      label: 'typecheck demo',
      type: 'process',
      command: process.execPath,
      args: ['-e', `console.error(${JSON.stringify(TSC_LINE)})`],
      problemMatcher: '$tsc'
    },
    {
      label: 'bad matcher',
      type: 'process',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      problemMatcher: '$does-not-exist'
    }
  ]
});

const events: Array<{ channel: string; data: TaskEventT }> = [];

before(async () => {
  await fs.mkdir(path.join(workspace, '.vscode'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.vscode', 'tasks.json'), TASKS_JSON);

  server = new ArchServer(workspace, path.join(workspace, 'arch-test.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const routes = await buildRoutes(workspace, 'test', {
    events: {
      publish: (channel: string, data: unknown) => {
        if (channel === 'tasks') events.push({ channel, data: data as TaskEventT });
      },
      attach: () => {},
      close: () => {},
      clientCount: () => 0
    } as never
  });
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

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

async function post<T>(pathName: string, payload: unknown): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${base}${pathName}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function get<T>(pathName: string): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${base}${pathName}`);
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

function waitForEvent(predicate: (event: TaskEventT) => boolean, label: string): Promise<TaskEventT> {
  const existing = events.map(event => event.data).find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = events.map(event => event.data).find(predicate);
      if (found) {
        clearInterval(timer);
        resolve(found);
      } else if (Date.now() - started > 30000) {
        clearInterval(timer);
        reject(new Error(`timed out waiting for ${label}; saw ${JSON.stringify(events.map(event => event.data))}`));
      }
    }, 50);
  });
}

test('GET /api/tasks/matchers lists built-in matchers plus workspace extensions', async () => {
  const { status, body } = await get<{ matchers: Array<{ name: string; owner: string }> }>('/api/tasks/matchers');
  assert.equal(status, 200);
  const names = body.data!.matchers.map(matcher => matcher.name);
  for (const expected of ['tsc', 'eslint-stylish', 'eslint-compact', 'msbuild', 'cargo-rustc', 'node-trace']) {
    assert.ok(names.includes(expected), `missing built-in ${expected}`);
  }

  await fs.writeFile(
    path.join(workspace, '.aide', 'matchers.json'),
    JSON.stringify({ custom: { name: 'custom', owner: 'me', pattern: { regexp: '^x:(\\d+):(.*)$', line: 1, message: 2 } } })
  );
  const again = await get<{ matchers: Array<{ name: string; owner: string }> }>('/api/tasks/matchers');
  assert.ok(again.body.data!.matchers.some(matcher => matcher.name === 'custom'));
});

test('POST /api/problems/parse round-trips tsc output through contract validation', async () => {
  const { status, body } = await post<{ problems: Array<{ file: string; line: number; column: number; severity: string; message: string; code: string | null }>; dropped: number }>(
    '/api/problems/parse',
    { matcher: '$tsc', text: TSC_LINE }
  );
  assert.equal(status, 200);
  assert.equal(body.data!.dropped, 0);
  assert.deepEqual(body.data!.problems, [
    { file: 'src/index.ts', line: 10, column: 5, severity: 'error', message: "Cannot find name 'foo'.", code: 'TS2304' }
  ]);
});

test('unknown matcher name maps to BAD_REQUEST envelope, not 500', async () => {
  const { status, body } = await post('/api/problems/parse', { matcher: '$nope', text: 'anything' });
  assert.equal(status, 400);
  assert.equal(body.error?.code, 'BAD_REQUEST');
  assert.match(body.error?.message ?? '', /unknown problem matcher/);
});

test('invalid inline matcher bodies are rejected at the strict contract edge', async () => {
  const missingOwner = await post('/api/problems/parse', { matcher: { name: 'x' }, text: '' });
  assert.equal(missingOwner.status, 400);

  const badPatternIndex = await post('/api/problems/parse', {
    matcher: { name: 'x', owner: 'y', pattern: { regexp: 'a', line: 0 } },
    text: ''
  });
  assert.equal(badPatternIndex.status, 400);

  const extraField = await post('/api/problems/parse', { matcher: '$tsc', text: '', sneaky: true });
  assert.equal(extraField.status, 400);
});

test('paths escaping the workspace are dropped by the route with a dropped count', async () => {
  const { status, body } = await post<{ problems: unknown[]; dropped: number }>('/api/problems/parse', {
    matcher: { name: 'esc', owner: 'e', pattern: { regexp: '^(.+?):(\\d+)$', file: 1, line: 2 } },
    text: '../../outside.ts:7'
  });
  assert.equal(status, 200);
  assert.deepEqual(body.data!.problems, []);
  assert.equal(body.data!.dropped, 1);
});

test('POST /api/problems/parse accepts matcher arrays and merges results without duplicates', async () => {
  const line = "src/index.ts(10,5): error TS2304: Cannot find name 'foo'.";
  const { status, body } = await post<{ problems: Array<{ code: string | null }>; dropped: number }>('/api/problems/parse', {
    matcher: ['$tsc', '$tsc'],
    text: line
  });
  assert.equal(status, 200);
  assert.equal(body.data!.dropped, 0);
  assert.equal(body.data!.problems.length, 1);
});

test('running a task with $tsc emits resolved diagnostics over the tasks event channel', async () => {
  const run = await post<{ job_id: string }>('/api/tasks/run', { label: 'typecheck demo' });
  assert.equal(run.status, 200);
  const jobId = run.body.data!.job_id;

  const exit = await waitForEvent(event => event.event === 'exit' && event.job_id === jobId, 'exit of typecheck demo');
  if (exit.event !== 'exit') throw new Error('expected exit event');

  const problemsEvent = await waitForEvent(
    event => event.event === 'problems' && event.job_id === jobId,
    'problems of typecheck demo'
  );
  if (problemsEvent.event !== 'problems') throw new Error('expected problems event');
  assert.deepEqual(problemsEvent.problems, [
    { file: 'src/index.ts', line: 10, column: 5, severity: 'error', message: "Cannot find name 'foo'.", code: 'TS2304' }
  ]);
});

test('tasks referencing an unknown matcher fail fast with BAD_REQUEST before spawn', async () => {
  const run = await post('/api/tasks/run', { label: 'bad matcher' });
  assert.equal(run.status, 400);
  assert.equal(run.body.error?.code, 'BAD_REQUEST');
  assert.match(run.body.error?.message ?? '', /unknown problem matcher/);
});
