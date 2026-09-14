import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { pairFixture } from './authority-fixture.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-b4-notifications-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let owner: Awaited<ReturnType<typeof pairFixture>>;

const notificationEvents: Array<{ channel: string; data: unknown }> = [];

const FAILING_TASK = {
  version: '2.0.0',
  tasks: [
    {
      label: 'always fails',
      type: 'process',
      command: process.execPath,
      args: ['-e', 'process.exit(2)']
    }
  ]
};

before(async () => {
  await fs.mkdir(path.join(workspace, '.vscode'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.vscode', 'tasks.json'), JSON.stringify(FAILING_TASK));

  server = new ArchServer(workspace, path.join(workspace, 'arch-test.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const routes = await buildRoutes(workspace, 'test', {
    authority: server.authority,
    events: {
      publish: (channel: string, data: unknown) => {
        if (channel === 'notifications') notificationEvents.push({ channel, data });
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

async function read<T>(urlPath: string): Promise<{ status: number; json: Envelope<T> }> {
  const response = await owner.request(urlPath);
  return { status: response.status, json: (await response.json()) as Envelope<T> };
}

async function mutate<T>(method: string, urlPath: string, body: unknown): Promise<{ status: number; json: Envelope<T> }> {
  const headers = await owner.approve(method, urlPath, body, `task:${method}:${urlPath}`);
  const response = await owner.request(urlPath, { method, headers, body: JSON.stringify(body) });
  return { status: response.status, json: (await response.json()) as Envelope<T> };
}

async function propose(method: string, urlPath: string, body: unknown): Promise<{ status: number; json: Envelope<unknown> }> {
  const response = await owner.request('/api/authority/prepare', {
    method: 'POST',
    body: JSON.stringify({ method, path: urlPath, body, task_id: `task:${method}:${urlPath}` })
  });
  return { status: response.status, json: (await response.json()) as Envelope<unknown> };
}

async function pollJobStatus(until: (jobs: Array<{ status?: string; authority_state?: { phase?: string; state?: string; operation_id?: string | null } }>) => boolean, timeoutMs = 10000): Promise<Array<{ status?: string; authority_state?: { phase?: string; state?: string; operation_id?: string | null } }>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { json } = await read<{ jobs: Array<{ status?: string; authority_state?: { phase?: string; state?: string; operation_id?: string | null } }> }>('/api/tasks/status');
    const jobs = json.data?.jobs ?? [];
    if (until(jobs)) return jobs;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('task status timeout');
}

async function waitForNotification(predicate: (n: { source?: string; title?: string; body?: string; job_id?: string; severity?: string }) => boolean, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { json } = await read<{ notifications: Array<{ source?: string; title?: string; body?: string; job_id?: string; severity?: string }> }>('/api/notifications');
    const found = (json.data?.notifications ?? []).find(predicate);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('notification not found');
}

test('notifications list starts empty with zero unread', async () => {
  const { status, json } = await read<{ notifications: unknown[]; unread: number }>('/api/notifications');
  assert.equal(status, 200);
  assert.ok(json.ok);
  assert.deepEqual(json.data?.notifications, []);
  assert.equal(json.data?.unread, 0);
});

test('notification reads require a paired actor and mutation routes require exact approval', async () => {
  const anonymous = await fetch(`${base}/api/notifications`);
  assert.equal(anonymous.status, 403);
  const noApproval = await owner.request('/api/notifications/read', { method: 'POST', body: JSON.stringify({ id: 'n1' }) });
  assert.equal(noApproval.status, 409);
  assert.equal(((await noApproval.json()) as Envelope<unknown>).error?.code, 'NOT_READY');
});

test('read route rejects unknown fields at the strict zod edge', async () => {
  const response = await owner.request('/api/notifications/read', { method: 'POST', body: JSON.stringify({ id: 'n1', sneaky: true }) });
  assert.equal(response.status, 400);
  const body = (await response.json()) as Envelope<unknown>;
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, 'BAD_REQUEST');
});

test('read on unknown id returns NOT_FOUND envelope', async () => {
  const { status, json } = await mutate<unknown>('POST', '/api/notifications/read', { id: 'n404' });
  assert.equal(status, 404);
  assert.equal(json.error?.code, 'NOT_FOUND');
});

test('PUT /api/hooks rejects unknown hook events with BAD_REQUEST', async () => {
  const { status, json } = await propose('PUT', '/api/hooks', { hooks: [{ event: 'not-an-event', command: ['git', 'status'] }] });
  assert.equal(status, 400);
  assert.equal(json.error?.code, 'BAD_REQUEST');
});

test('PUT /api/hooks rejects network commands without consent via FORBIDDEN', async () => {
  const { status, json } = await propose('PUT', '/api/hooks', {
    hooks: [{ event: 'task.failed', command: ['curl', '-s', 'https://example.invalid'] }]
  });
  assert.equal(status, 403);
  assert.equal(json.error?.code, 'FORBIDDEN');
});

test('PUT /api/hooks requires approval, binds exact content, and rejects replay or changed content', async () => {
  const hooks = { hooks: [{ event: 'task.completed', command: [process.execPath, '-e', 'console.log("ok")'], show: true }] };
  const noApproval = await owner.request('/api/hooks', { method: 'PUT', body: JSON.stringify(hooks) });
  assert.equal(noApproval.status, 409);

  const headers = await owner.approve('PUT', '/api/hooks', hooks, 'task:hooks');
  const put = await owner.request('/api/hooks', { method: 'PUT', headers, body: JSON.stringify(hooks) });
  assert.equal(put.status, 200);
  assert.ok(((await put.json()) as Envelope<{ hooks: unknown[] }>).ok);
  const raw = await fs.readFile(path.join(workspace, '.aide', 'hooks.json'), 'utf8');
  assert.match(raw, /task\.completed/);

  const replay = await owner.request('/api/hooks', { method: 'PUT', headers, body: JSON.stringify(hooks) });
  assert.equal(replay.status, 409);

  const changed = { hooks: [{ event: 'task.completed', command: [process.execPath, '-e', 'console.log("different")'], show: true }] };
  const changedHeaders = await owner.approve('PUT', '/api/hooks', hooks, 'task:hooks-changed');
  const changedPut = await owner.request('/api/hooks', { method: 'PUT', headers: changedHeaders, body: JSON.stringify(changed) });
  assert.equal(changedPut.status, 409);
  assert.equal(((await changedPut.json()) as Envelope<unknown>).error?.code, 'CONFLICT');
});

test('END-TO-END: failing task emits notification, hooks need exact execution authority, unread clears through approval', async () => {
  const marker = path.join(workspace, 'hook-marker.txt');
  const hooksPut = await mutate('PUT', '/api/hooks', {
    hooks: [
      { event: 'task.failed', command: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fired')`] },
      { event: 'task.failed', command: ['definitely-not-a-real-binary-xyz'], show: true }
    ]
  });
  assert.ok(hooksPut.json.ok);

  const runHeaders = await owner.approve('POST', '/api/tasks/run', { label: 'always fails' }, 'task:run');
  const run = await owner.request('/api/tasks/run', { method: 'POST', headers: runHeaders, body: JSON.stringify({ label: 'always fails' }) });
  assert.equal(run.status, 200);
  const jobId = ((await run.json()) as Envelope<{ job_id: string }>).data?.job_id;
  assert.ok(jobId);

  const pendingCommand = await pollJobStatus(jobs => jobs.some(job => job.status === 'running' && job.authority_state?.phase === 'command' && job.authority_state?.state === 'pending'));
  const commandOpId = pendingCommand.find(job => job.status === 'running' && job.authority_state?.phase === 'command' && job.authority_state?.state === 'pending')?.authority_state?.operation_id;
  assert.ok(commandOpId);
  assert.equal((await owner.decide(commandOpId, 'approve')).status, 200);

  await pollJobStatus(jobs => jobs.some(job => job.status === 'failed'));

  const taskNotice = await waitForNotification(n => n.source === 'task' && n.job_id === jobId);
  assert.equal(taskNotice.severity, 'error');
  assert.match(taskNotice.title ?? '', /always fails/);
  assert.ok(notificationEvents.some(event => {
    const data = event.data as { title?: string; severity?: string; job_id?: string };
    return data.severity === 'error' && data.job_id === jobId;
  }), 'task failure must be published as a notification event');

  const pendingHook = await waitForNotification(n => n.source === 'hook' && !!n.body && n.body.includes('pending'));
  const hookOpId = pendingHook.body?.match(/operation_id=([a-f0-9-]+)/)?.[1];
  assert.ok(hookOpId, 'hook execution must wait for a fresh operation');

  let markerContent = await fs.readFile(marker, 'utf8').catch(() => '');
  assert.equal(markerContent, '', 'hook must not run before approval');

  assert.equal((await owner.decide(hookOpId, 'approve')).status, 200);

  for (let i = 0; i < 50; i++) {
    markerContent = await fs.readFile(marker, 'utf8').catch(() => '');
    if (markerContent === 'fired') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(markerContent, 'fired');

  const hookFailure = await waitForNotification(n => /Hook failed/.test(n.title ?? ''));
  assert.equal(hookFailure.source, 'hook');

  const readAll = await mutate<{ unread: number }>('POST', '/api/notifications/read-all', {});
  assert.equal(readAll.status, 200);
  assert.equal(readAll.json.data?.unread, 0);
});
