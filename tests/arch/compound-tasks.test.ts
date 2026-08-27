import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import type { TaskEventT, TaskJobT } from '../../common/contracts/tasks.ts';
import { TaskDefinition } from '../../common/contracts/tasks.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-b3-compound-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;

const TASKS_JSON = JSON.stringify({
  version: '2.0.0',
  tasks: [
    { label: 'b3 compile', type: 'process', command: process.execPath, args: ['-e', "console.log('compiled')"] },
    { label: 'b3 fail', type: 'process', command: process.execPath, args: ['-e', 'process.exit(4)'] },
    {
      label: 'b3 seq root',
      type: 'process',
      command: process.execPath,
      args: ['-e', "console.log('root done')"],
      dependsOn: ['b3 compile']
    }
  ]
});

const events: Array<{ channel: string; data: TaskEventT }> = [];

before(async () => {
  await fs.mkdir(path.join(workspace, '.vscode'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.vscode', 'tasks.json'), TASKS_JSON);

  server = new ArchServer(workspace, path.join(workspace, 'arch-b3.log'));
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

async function waitForTerminal(rootJobId: string): Promise<TaskJobT[]> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { body } = await get<{ jobs: TaskJobT[] }>('/api/tasks/status');
    const root = body.data?.jobs.find(job => job.job_id === rootJobId);
    if (root && root.status !== 'running') return body.data?.jobs ?? [];
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('compound run never reached terminal state');
}

test('b3 arch: compound sequential run groups child jobs under parent and emits single root exit notification feed', async () => {
  const startedBefore = events.length;
  const run = await post<{ job_id: string }>('/api/tasks/run', { label: 'b3 seq root' });
  assert.equal(run.status, 200);
  assert.ok(run.body.data?.job_id);
  const rootJobId = run.body.data!.job_id;

  const jobs = await waitForTerminal(rootJobId);
  const root = jobs.find(job => job.job_id === rootJobId);
  assert.ok(root);
  assert.equal(root.status, 'exited');
  assert.equal(root.exitCode, 0);

  const children = jobs.filter(job => job.parent_job_id === rootJobId);
  assert.ok(children.length >= 1, 'child jobs carry parent_job_id');
  const compileChild = children.find(child => child.label === 'b3 compile');
  assert.ok(compileChild, 'dependency job present in grouped list');
  assert.equal(compileChild.name_path, 'b3 seq root > b3 compile');

  const window = events.slice(startedBefore).map(entry => entry.data);
  type ExitEvent = Extract<TaskEventT, { event: 'exit' }>;
  const isExit = (event: TaskEventT): event is ExitEvent => event.event === 'exit';
  const exitEvents = window.filter(isExit).filter(event => event.job_id === rootJobId);
  assert.equal(exitEvents.length, 1, 'exactly one coordinator exit event');
  const childExits = window.filter(isExit).filter(
    event => event.parent_job_id !== undefined && event.parent_job_id !== null
  );
  assert.ok(childExits.length >= 1, 'child exits carry parent linkage');
  assert.equal(exitEvents[0]?.parent_job_id ?? null, null);
  assert.equal(exitEvents[0]?.name_path ?? null, 'b3 seq root');
});

test('b3 arch: contract rejects dependsOn entries that are not string or task object', () => {
  const badNumber = TaskDefinition.safeParse({
    label: 'x',
    type: 'process',
    command: 'node',
    dependsOn: 42
  });
  assert.equal(badNumber.success, false);
  const badMixedArray = TaskDefinition.safeParse({
    label: 'x',
    type: 'process',
    command: 'node',
    dependsOn: ['ok-label', 7]
  });
  assert.equal(badMixedArray.success, false);
  const goodInline = TaskDefinition.safeParse({
    label: 'root',
    type: 'process',
    command: 'node',
    dependsOn: [{ label: 'inl', type: 'process', command: 'node' }]
  });
  assert.equal(goodInline.success, true);
});
