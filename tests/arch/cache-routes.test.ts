import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { TaskDefinition } from '../../common/contracts/tasks.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-b5-cache-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;

const TASKS_JSON = JSON.stringify({
  version: '2.0.0',
  tasks: [
    {
      label: 'b5 build',
      type: 'process',
      command: process.execPath,
      args: ['-e', "console.log('b5 built')"],
      cache: { inputs: ['src/**'], env: ['B5_ARCH_MODE'] }
    }
  ]
});

before(async () => {
  await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
  await writeFileSafe(path.join(workspace, 'src', 'app.txt'), 'v1');
  await fs.mkdir(path.join(workspace, '.vscode'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.vscode', 'tasks.json'), TASKS_JSON);

  server = new ArchServer(workspace, path.join(workspace, 'arch-b5.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const routes = await buildRoutes(workspace, 'test', {});
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

async function writeFileSafe(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, 'utf8');
}

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

type StatusJob = {
  job_id: string;
  label: string;
  status: string;
  exitCode: number | null;
  restored?: boolean;
};

async function post<T>(pathName: string, payload: unknown): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${base}${pathName}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function get<T>(pathName: string): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${base}${pathName}`);
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function waitForTerminal(rootJobId: string): Promise<StatusJob> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { body } = await get<{ jobs: StatusJob[] }>('/api/tasks/status');
    const job = body.data?.jobs.find(candidate => candidate.job_id === rootJobId);
    if (job && job.status !== 'running') return job as StatusJob;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('job never reached terminal state');
}

test('b5 arch: second run restores with honest flag and stats/clear routes hold shape', async () => {
  const first = await post<{ job_id: string }>('/api/tasks/run', { label: 'b5 build' });
  assert.equal(first.status, 200);
  const firstJob = await waitForTerminal(first.body.data!.job_id);
  assert.equal(firstJob.restored ?? false, false);

  const missStats = await get<{ misses: number; hits: number; totalBytes: number; entries: unknown[] }>('/api/tasks/cache/stats');
  assert.equal(missStats.status, 200);
  assert.ok((missStats.body.data?.misses ?? 0) >= 1);

  const second = await post<{ job_id: string }>('/api/tasks/run', { label: 'b5 build' });
  const secondJob = await waitForTerminal(second.body.data!.job_id);
  assert.equal(secondJob.restored, true, 'second identical run must be restored');

  const hitStats = await get<{ hits: number; entries: Array<{ label: string; sizeBytes: number }> }>('/api/tasks/cache/stats');
  assert.ok((hitStats.body.data?.hits ?? 0) >= 1);
  assert.ok((hitStats.body.data?.entries.length ?? 0) >= 1);

  const cleared = await post<{ cleared: number }>('/api/tasks/cache/clear', {});
  assert.equal(cleared.status, 200);
  const emptyStats = await get<{ entries: unknown[] }>('/api/tasks/cache/stats');
  assert.equal(emptyStats.body.data?.entries.length, 0);
});

test('b5 arch: contract rejects malformed cache declarations', () => {
  const emptyInputs = TaskDefinition.safeParse({
    label: 'x',
    type: 'process',
    command: 'node',
    cache: { inputs: [] }
  });
  assert.equal(emptyInputs.success, false);
  const badInputsType = TaskDefinition.safeParse({
    label: 'x',
    type: 'process',
    command: 'node',
    cache: { inputs: [42] }
  });
  assert.equal(badInputsType.success, false);
  const unknownField = TaskDefinition.safeParse({
    label: 'x',
    type: 'process',
    command: 'node',
    cache: { inputs: ['src/**'], ttlSeconds: 10 }
  });
  assert.equal(unknownField.success, false);
  const validCache = TaskDefinition.safeParse({
    label: 'x',
    type: 'process',
    command: 'node',
    cache: { inputs: ['src/**'], env: ['NODE_ENV'] }
  });
  assert.equal(validCache.success, true);
});
