import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import type { TaskEventT } from '../../common/contracts/tasks.ts';
import { pairFixture } from './authority-fixture.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-b1-tasks-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let owner: Awaited<ReturnType<typeof pairFixture>>;

const TASKS_JSON = JSON.stringify({
  version: '2.0.0',
  tasks: [
    { label: 'build demo', type: 'process', command: process.execPath, args: ['-e', "console.log('built ok')"], group: 'build' },
    { label: 'fail demo', type: 'process', command: process.execPath, args: ['-e', "console.error('boom'); process.exit(3)"], group: 'test' }
  ]
});

const events: Array<{ channel: string; data: TaskEventT }> = [];
const pendingDecisions = new Set<Promise<void>>();
const decisionErrors: unknown[] = [];

// The task service prepares each child command as its own exact operation and
// waits for an operator decision. The fixture answers those pending operations
// as the paired operator; no operation is approved before it is proposed.
function approvePendingOperation(event: TaskEventT): void {
  if (event.event !== 'authority' || event.authority_state.state !== 'pending') return;
  const id = event.authority_state.operation_id;
  if (!id) return;
  const decision = (async () => {
    const response = await owner.decide(id, 'approve');
    assert.equal(response.status, 200);
    const envelope = (await response.json()) as { ok: boolean };
    assert.equal(envelope.ok, true);
  })();
  pendingDecisions.add(decision);
  void decision.catch(error => decisionErrors.push(error)).finally(() => pendingDecisions.delete(decision));
}

async function drainDecisions(): Promise<void> {
  for (const decision of [...pendingDecisions]) await decision.catch(() => {});
  if (decisionErrors.length > 0) throw new AggregateError(decisionErrors, 'pending operator decisions failed');
}

before(async () => {
  await fs.mkdir(path.join(workspace, '.vscode'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.vscode', 'tasks.json'), TASKS_JSON);
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'demo', scripts: { hello: "node -e \"console.log('npm script ran')\"" } })
  );

  server = new ArchServer(workspace, path.join(workspace, 'arch-test.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const routes = await buildRoutes(workspace, 'test', {
    authority: server.authority,
    events: {
      publish: (channel: string, data: unknown) => {
        if (channel !== 'tasks') return;
        const event = data as TaskEventT;
        events.push({ channel, data: event });
        approvePendingOperation(event);
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
  owner = await pairFixture(server, base);
});

after(async () => {
  await drainDecisions();
  server.events.close();
  await server.logger.flush();
  httpServer.closeAllConnections?.();
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

async function post<T>(pathName: string, payload: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Envelope<T> }> {
  const response = await owner.request(pathName, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000)
  });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function get<T>(pathName: string): Promise<{ status: number; body: Envelope<T> }> {
  const response = await owner.request(pathName, { signal: AbortSignal.timeout(30000) });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function runTask<T>(label: string, taskId: string): Promise<{ status: number; body: Envelope<T> }> {
  const headers = await owner.approve('POST', '/api/tasks/run', { label }, taskId);
  return post<T>('/api/tasks/run', { label }, headers);
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

test('task list merges tasks.json entries with detected npm scripts', async () => {
  const { status, body } = await get<{ fileFound: boolean; filePath: string | null; detectedFrom: string | null; tasks: Array<{ label: string; source: string; groupKind?: string; groupIsDefault?: boolean; args?: string[] }> }>('/api/tasks');
  assert.equal(status, 200);
  const data = body.data!;
  assert.equal(data.fileFound, true);
  assert.equal(data.filePath, '.vscode/tasks.json');
  assert.equal(data.detectedFrom, 'package.json');

  const configured = data.tasks.find(task => task.label === 'build demo');
  assert.ok(configured, 'configured task listed');
  assert.equal(configured.source, 'tasks.json');
  assert.equal(configured.groupKind, 'build');

  const detected = data.tasks.find(task => task.label === 'npm: hello');
  assert.ok(detected, 'npm script detected');
  assert.equal(detected.source, 'detected');
  assert.deepEqual(detected.args, ['run', 'hello']);
});

test('run executes a configured task and streams output plus exit over the event bus', async () => {
  const run = await runTask<{ job_id: string }>('build demo', 'task-run-build-demo');
  assert.equal(run.status, 200);
  const jobId = run.body.data!.job_id;

  const exit = await waitForEvent(event => event.event === 'exit' && event.job_id === jobId, 'exit of build demo');
  if (exit.event !== 'exit') throw new Error('expected exit event');
  assert.equal(exit.exitCode, 0);

  const lines = events
    .map(event => event.data)
    .filter((event): event is Extract<TaskEventT, { event: 'output'; job_id: string; label: string; stream: 'stdout' | 'stderr'; line: string }> => event.event === 'output' && event.job_id === jobId)
    .map(event => event.line);
  assert.ok(lines.some(line => line?.includes('built ok')), `stdout captured, got: ${lines.join(' | ')}`);

  const status = await get<{ jobs: Array<{ job_id: string; label: string; status: string; exitCode: number | null }> }>('/api/tasks/status');
  const job = status.body.data!.jobs.find(entry => entry.job_id === jobId);
  assert.ok(job, 'job recorded in status');
  assert.equal(job.status, 'exited');
  assert.equal(job.exitCode, 0);
});

test('non-zero exit is reported as failed with the exit code preserved', async () => {
  const run = await runTask<{ job_id: string }>('fail demo', 'task-run-fail-demo');
  assert.equal(run.status, 200);
  const exit = await waitForEvent(event => event.event === 'exit' && event.job_id === run.body.data!.job_id, 'exit of fail demo');
  if (exit.event !== 'exit') throw new Error('expected exit event');
  assert.equal(exit.exitCode, 3);
});

test('detected npm scripts are runnable through the same contract', async () => {
  const run = await runTask<{ job_id: string }>('npm: hello', 'task-run-npm-hello');
  assert.equal(run.status, 200);
  const jobId = run.body.data!.job_id;
  const exit = await waitForEvent(event => event.event === 'exit' && event.job_id === jobId, 'exit of npm: hello');
  if (exit.event !== 'exit') throw new Error('expected exit event');
  assert.equal(exit.exitCode, 0);
});

test('unknown labels are denied and duplicate runs map to CONFLICT', async () => {
  // Canonical pairing first, then the mutation. The route-owned descriptor for
  // a brand-new label cannot resolve; the service's typed NOT_FOUND maps to
  // 404 at the operation boundary and no job runs.
  const unknown = await post('/api/tasks/run', { label: 'does-not-exist' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.ok, false);
  assert.equal(unknown.body.error?.code, 'NOT_FOUND');
  assert.match(unknown.body.error?.message ?? '', /unknown task/);

  const longTaskFile = JSON.stringify({
    version: '2.0.0',
    tasks: [{ label: 'sleeper', type: 'process', command: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'] }]
  });
  await fs.writeFile(path.join(workspace, '.vscode', 'tasks.json'), longTaskFile);

  const first = await runTask<{ job_id: string }>('sleeper', 'task-run-sleeper-first');
  assert.equal(first.status, 200);
  const duplicate = await runTask('sleeper', 'task-run-sleeper-duplicate');
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error?.code, 'CONFLICT');

  const stopHeaders = await owner.approve('POST', '/api/tasks/stop', { job_id: first.body.data!.job_id }, 'task-stop-sleeper');
  const stop = await post<{ jobs: Array<{ job_id: string; status: string }> }>('/api/tasks/stop', { job_id: first.body.data!.job_id }, stopHeaders);
  assert.equal(stop.status, 200);
  const stopped = stop.body.data!.jobs.find(job => job.job_id === first.body.data!.job_id);
  assert.equal(stopped?.status, 'stopped');

  const stopAgainHeaders = await owner.approve('POST', '/api/tasks/stop', { job_id: first.body.data!.job_id }, 'task-stop-sleeper-again');
  const stopAgain = await post('/api/tasks/stop', { job_id: first.body.data!.job_id }, stopAgainHeaders);
  assert.equal(stopAgain.status, 400);
});

test('malformed tasks files surface as BAD_REQUEST with strict-schema messages', async () => {
  await fs.writeFile(path.join(workspace, '.vscode', 'tasks.json'), '{"version":"2.0.0","tasks":[{"label":"x"}]}');
  const broken = await get('/api/tasks');
  assert.equal(broken.status, 400);
  assert.equal(broken.body.error?.code, 'BAD_REQUEST');
  assert.match(broken.body.error?.message ?? '', /strict schema|must be/);

  await fs.rm(path.join(workspace, '.vscode', 'tasks.json'), { force: true });
  const recovered = await get<{ fileFound: boolean; tasks: Array<{ source: string }> }>('/api/tasks');
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.data!.fileFound, false);
  assert.ok(recovered.body.data!.tasks.every(task => task.source === 'detected'));
});
