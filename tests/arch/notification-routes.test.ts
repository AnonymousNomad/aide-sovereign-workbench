import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-b4-notifications-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;

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

async function call<T>(method: string, urlPath: string, body?: unknown): Promise<{ status: number; json: Envelope<T> }> {
  const init: RequestInit = body === undefined
    ? { method }
    : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch(`${base}${urlPath}`, init);
  return { status: response.status, json: (await response.json()) as Envelope<T> };
}

test('notifications list starts empty with zero unread', async () => {
  const { status, json } = await call<{ notifications: unknown[]; unread: number }>('GET', '/api/notifications');
  assert.equal(status, 200);
  assert.ok(json.ok);
  assert.deepEqual(json.data?.notifications, []);
  assert.equal(json.data?.unread, 0);
});

test('read route rejects unknown fields at the strict zod edge', async () => {
  const { status, json } = await call('POST', '/api/notifications/read', { id: 'n1', sneaky: true });
  assert.equal(status, 400);
  assert.equal(json.ok, false);
  assert.equal(json.error?.code, 'BAD_REQUEST');
});

test('read on unknown id returns NOT_FOUND envelope', async () => {
  const { status, json } = await call('POST', '/api/notifications/read', { id: 'n404' });
  assert.equal(status, 404);
  assert.equal(json.error?.code, 'NOT_FOUND');
});

test('PUT /api/hooks rejects unknown hook events with BAD_REQUEST', async () => {
  const { status, json } = await call('PUT', '/api/hooks', { hooks: [{ event: 'not-an-event', command: ['git', 'status'] }] });
  assert.equal(status, 400);
  assert.equal(json.error?.code, 'BAD_REQUEST');
});

test('PUT /api/hooks rejects network commands without consent via FORBIDDEN', async () => {
  const { status, json } = await call('PUT', '/api/hooks', {
    hooks: [{ event: 'task.failed', command: ['curl', '-s', 'https://example.invalid'] }]
  });
  assert.equal(status, 403);
  assert.equal(json.error?.code, 'FORBIDDEN');
});

test('PUT /api/hooks persists a valid file and GET returns it', async () => {
  const put = await call<{ hooks: unknown[] }>('PUT', '/api/hooks', {
    hooks: [{ event: 'task.completed', command: [process.execPath, '-e', 'console.log("ok")'], show: true }]
  });
  assert.equal(put.status, 200);
  assert.ok(put.json.ok);
  const raw = await fs.readFile(path.join(workspace, '.aide', 'hooks.json'), 'utf8');
  assert.match(raw, /task\.completed/);
  const get = await call<{ hooks: Array<{ event: string }>}>('GET', '/api/hooks');
  assert.equal(get.json.data?.hooks.length, 1);
  assert.equal(get.json.data?.hooks[0]?.event, 'task.completed');
});

test('END-TO-END: failing task emits notification over WS channel with job linkage and fires consented hook', async () => {
  const marker = path.join(workspace, 'hook-marker.txt');
  const hookPut = await call('PUT', '/api/hooks', {
    hooks: [
      { event: 'task.failed', command: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fired')`] },
      { event: 'task.failed', command: ['definitely-not-a-real-binary-xyz'], show: true }
    ]
  });
  assert.ok(hookPut.json.ok);

  const run = await call<{ job_id: string }>('POST', '/api/tasks/run', { label: 'always fails' });
  assert.equal(run.status, 200);

  let jobFailed = false;
  for (let i = 0; i < 100; i++) {
    const s = await call<{ jobs?: Array<{ status?: string }> }>('GET', '/api/tasks/status');
    jobFailed = (s.json.data?.jobs ?? []).some(job => job.status === 'failed');
    if (jobFailed) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(jobFailed, 'task must reach failed state');

  for (let i = 0; i < 50 && notificationEvents.length < 1; i++) {
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(notificationEvents.length >= 1, 'expected at least one notification event');
  const failureEvent = notificationEvents.map(e => e.data as { title: string; severity: string; job_id?: string })
    .find(n => n.severity === 'error');
  assert.ok(failureEvent, 'an error notification must be published');
  assert.match(failureEvent.title, /always fails/);
  assert.ok(failureEvent.job_id, 'notification must carry job linkage');

  for (let i = 0; i < 50; i++) {
    const markerContent = await fs.readFile(marker, 'utf8').catch(() => '');
    if (markerContent === 'fired') break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(await fs.readFile(marker, 'utf8'), 'fired');

  for (let i = 0; i < 50; i++) {
    const list = await call<{ notifications: Array<{ title: string }> }>('GET', '/api/notifications');
    if ((list.json.data?.notifications ?? []).some(n => /Hook failed/.test(n.title))) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const finalList = await call<{ notifications: Array<{ title: string; source: string }> }>('GET', '/api/notifications');
  const titles = (finalList.json.data?.notifications ?? []).map(n => `${n.source}:${n.title}`);
  assert.ok(titles.some(t => t.startsWith('hook:') && t.includes('Hook failed')), `hook-failure toast expected, got ${JSON.stringify(titles)}`);

  const readAll = await call<{ unread: number }>('POST', '/api/notifications/read-all', {});
  assert.equal(readAll.status, 200);
  assert.equal(readAll.json.data?.unread, 0);
});
