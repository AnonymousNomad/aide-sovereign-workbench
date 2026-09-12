import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Server } from 'node:http';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';
import { pairFixture } from './authority-fixture.ts';
import { createExecutionAuthority, AuthorityError, type ExecutionHandle } from '../../node/src/services/execution-authority.mjs';
import { NotificationService, type NotificationEntry } from '../../node/src/services/notification-service.mjs';
import { HookExecutor } from '../../node/src/services/hook-executor.mjs';

async function waitForFile(file: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await fs.readFile(file, 'utf8');
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  throw new Error(`file did not appear: ${file}`);
}

async function subscribeWs(port: number, token: string, channels: string[]): Promise<import('ws').WebSocket> {
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: 'http://fixture.local' } });
  await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'authenticate', token }));
  await new Promise<void>((resolve, reject) => {
    const handler = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as { type?: string };
      if (msg.type === 'authenticated') { ws.off('message', handler); resolve(); }
    };
    ws.on('message', handler);
    setTimeout(() => reject(new Error('websocket auth timeout')), 2000);
  });
  ws.send(JSON.stringify({ type: 'subscribe', channels }));
  await new Promise(r => setTimeout(r, 150));
  return ws;
}

async function watchNotifications(port: number, token: string) {
  const ws = await subscribeWs(port, token, ['notifications']);
  const received: NotificationEntry[] = [];
  ws.on('message', raw => {
    const payload = JSON.parse(raw.toString()) as { channel: string; data: NotificationEntry };
    if (payload.channel === 'notifications') received.push(payload.data);
  });
  await new Promise(r => setTimeout(r, 150));
  async function wait(predicate: (n: NotificationEntry) => boolean, timeoutMs = 5000): Promise<NotificationEntry> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = received.find(predicate);
      if (found) return found;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('notification not found');
  }
  return { received, wait, close: () => ws.close() };
}

type TaskChannelEvent = { event: string; job_id?: string; authority_state?: { phase?: string; state?: string; operation_id?: string | null } };

async function watchTasks(port: number, token: string) {
  const ws = await subscribeWs(port, token, ['tasks']);
  const received: TaskChannelEvent[] = [];
  ws.on('message', raw => {
    const payload = JSON.parse(raw.toString()) as { channel: string; data: TaskChannelEvent };
    if (payload.channel === 'tasks') received.push(payload.data);
  });
  await new Promise(r => setTimeout(r, 150));
  async function wait(predicate: (e: TaskChannelEvent) => boolean, timeoutMs = 5000): Promise<TaskChannelEvent> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = received.find(predicate);
      if (found) return found;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('task event not found');
  }
  return { received, wait, close: () => ws.close() };
}

async function pollTaskStatus(owner: Awaited<ReturnType<typeof pairFixture>>, until: (data: { jobs: Array<{ status: string }> }) => boolean): Promise<void> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const res = await owner.request('/api/tasks/status');
    const envelope = await res.json() as { ok: boolean; data: { jobs: Array<{ status: string }> } };
    if (until(envelope.data)) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('task status timeout');
}

async function getPort(server: Server): Promise<number> {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

async function waitForHookEntry(
  notifications: NotificationService,
  predicate: (n: NotificationEntry) => boolean,
  timeoutMs = 5000
): Promise<NotificationEntry> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = notifications.list().notifications.find(predicate);
    if (found) return found;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('hook notification not found');
}

function opIdFrom(entry: NotificationEntry): string {
  const match = entry.body?.match(/operation_id=([a-f0-9-]+)/);
  assert.ok(match, 'notification must carry operation_id');
  return match[1]!;
}

async function directAuthority(workspace: string, overrides: { operationTtlMs?: number } = {}) {
  const authority = createExecutionAuthority({ workspace, record: async () => ({ persisted: true }), ...overrides });
  const pairing = authority.control.createPairing('test');
  const session = await authority.pair(pairing, 'test');
  const owner = authority.authenticate(session.token, 'test');
  return { authority, owner };
}

function markerHook(marker: string, event = 'task.completed') {
  return { hooks: [{ event, command: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fired')`] }] };
}

test('deferred hook execution: task event produces pending operation, approval executes hook once', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-hook-executor-'));
  await fs.mkdir(path.join(workspace, '.aide'), { recursive: true });
  const marker = path.join(workspace, 'hook-marker.txt');

  await fs.writeFile(path.join(workspace, '.aide', 'tasks.json'), JSON.stringify({
    version: '2.0.0',
    tasks: [{ label: 'probe', type: 'process', command: process.execPath, args: ['-e', 'console.log("task-ran")'] }]
  }));
  await fs.writeFile(path.join(workspace, '.aide', 'hooks.json'), JSON.stringify({
    hooks: [{ event: 'task.completed', command: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fired')`] }]
  }));

  const arch = new ArchServer(workspace, path.join(workspace, 'arch.log'));
  const routes = await buildRoutes(workspace, '0.0.0-test', { events: arch.events, authority: arch.authority });
  for (const route of routes) arch.route(route);
  const server = await arch.listen(0);

  try {
    const base = `http://127.0.0.1:${await getPort(server)}`;
    const owner = await pairFixture(arch, base);

    const port = await getPort(server);
    const token = owner.headers.Authorization.slice(7);
    const notifications = await watchNotifications(port, token);
    const tasks = await watchTasks(port, token);

    try {
      const startTime = Date.now();
      const headers = await owner.approve('POST', '/api/tasks/run', { label: 'probe' }, 'task:probe');
      const runRes = await owner.request('/api/tasks/run', { method: 'POST', headers, body: JSON.stringify({ label: 'probe' }) });
      assert.equal(runRes.status, 200);

      const commandAuth = await tasks.wait(e => e.event === 'authority' && e.authority_state?.phase === 'command' && e.authority_state?.state === 'pending');
      const commandOpId = commandAuth.authority_state?.operation_id;
      assert.ok(commandOpId, 'command operation id must be present');
      assert.equal((await owner.decide(commandOpId, 'approve')).status, 200);

      await pollTaskStatus(owner, data => data.jobs.every(j => j.status !== 'running'));
      assert.ok(Date.now() - startTime < 5000, 'task must complete independently of hook approval');

      const pending = await notifications.wait(n => n.source === 'hook' && !!n.body && n.body.includes('pending'));
      const opIdMatch = pending.body?.match(/operation_id=([a-f0-9-]+)/);
      assert.ok(opIdMatch, 'pending notification must contain operation_id');
      const opId = opIdMatch[1]!;

      const inspectRes = await owner.request(`/api/authority/operation?id=${opId}`);
      assert.equal(inspectRes.status, 200);
      const inspect = await inspectRes.json() as { ok: boolean; data: { state: string; kind: string } };
      assert.equal(inspect.data.state, 'pending');
      assert.equal(inspect.data.kind, 'capability.execute');

      const succeededPromise = notifications.wait(n => n.source === 'hook' && !!n.body && n.body.includes('succeeded'));

      const decisionRes = await owner.decide(opId, 'approve');
      assert.equal(decisionRes.status, 200);

      const content = await waitForFile(marker);
      assert.equal(content, 'fired');

      const inspect2Res = await owner.request(`/api/authority/operation?id=${opId}`);
      const inspect2 = await inspect2Res.json() as { ok: boolean; data: { state: string } };
      assert.equal(inspect2.data.state, 'succeeded');

      const succeeded = await succeededPromise;
      assert.ok(succeeded.body?.includes(opId));
    } finally {
      notifications.close();
      tasks.close();
    }
  } finally {
    server.close();
    arch.authority.control.close();
  }
});

test('rejected hook operation produces zero side effects', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-hook-reject-'));
  await fs.mkdir(path.join(workspace, '.aide'), { recursive: true });
  const marker = path.join(workspace, 'hook-marker.txt');

  await fs.writeFile(path.join(workspace, '.aide', 'tasks.json'), JSON.stringify({
    version: '2.0.0',
    tasks: [{ label: 'probe', type: 'process', command: process.execPath, args: ['-e', 'console.log("task-ran")'] }]
  }));
  await fs.writeFile(path.join(workspace, '.aide', 'hooks.json'), JSON.stringify({
    hooks: [{ event: 'task.completed', command: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fired')`] }]
  }));

  const arch = new ArchServer(workspace, path.join(workspace, 'arch.log'));
  const routes = await buildRoutes(workspace, '0.0.0-test', { events: arch.events, authority: arch.authority });
  for (const route of routes) arch.route(route);
  const server = await arch.listen(0);

  try {
    const base = `http://127.0.0.1:${await getPort(server)}`;
    const owner = await pairFixture(arch, base);

    const port = await getPort(server);
    const token = owner.headers.Authorization.slice(7);
    const notifications = await watchNotifications(port, token);
    const tasks = await watchTasks(port, token);

    try {
      const headers = await owner.approve('POST', '/api/tasks/run', { label: 'probe' }, 'task:probe');
      const runRes = await owner.request('/api/tasks/run', { method: 'POST', headers, body: JSON.stringify({ label: 'probe' }) });
      assert.equal(runRes.status, 200);

      const commandAuth = await tasks.wait(e => e.event === 'authority' && e.authority_state?.phase === 'command' && e.authority_state?.state === 'pending');
      const commandOpId = commandAuth.authority_state?.operation_id;
      assert.ok(commandOpId, 'command operation id must be present');
      assert.equal((await owner.decide(commandOpId, 'approve')).status, 200);

      await pollTaskStatus(owner, data => data.jobs.every(j => j.status !== 'running'));

      const pending = await notifications.wait(n => n.source === 'hook' && !!n.body && n.body.includes('pending'));
      const opId = pending.body?.match(/operation_id=([a-f0-9-]+)/)?.[1]!;

      const deniedPromise = notifications.wait(n => n.source === 'hook' && !!n.body && (n.body.includes('denied') || n.body.includes('rejected')));

      const decisionRes = await owner.decide(opId, 'reject');
      assert.equal(decisionRes.status, 200);

      await new Promise(r => setTimeout(r, 300));
      await assert.rejects(() => fs.stat(marker), { code: 'ENOENT' });

      const denied = await deniedPromise;
      assert.ok(denied.body?.includes(opId));
    } finally {
      notifications.close();
      tasks.close();
    }
  } finally {
    server.close();
    arch.authority.control.close();
  }
});

test('HookExecutor direct: no owner, no hooks, changed config fail closed', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-hook-direct-'));
  const marker = path.join(workspace, 'marker-direct.txt');
  const marker2 = path.join(workspace, 'marker-direct2.txt');

  const audit: Array<{ kind?: string }> = [];
  const authority = createExecutionAuthority({
    workspace,
    record: async event => { audit.push(event as { kind?: string }); return { persisted: true }; }
  });
  const notifications = new NotificationService({ workspace, authority });
  notifications.setHooks({ hooks: [{ event: 'task.failed', command: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fired')`] }] });
  const hookExecutor = new HookExecutor({ authority, notifications });

  // No owner: hook does not run, no authority operation prepared.
  hookExecutor.onTaskEvent({ event: 'exit', job_id: 'j1', label: 'demo', exitCode: 1, signal: null });
  await new Promise(r => setTimeout(r, 200));
  await assert.rejects(() => fs.stat(marker), { code: 'ENOENT' });
  assert.equal(audit.filter(e => e.kind === 'capability.execute').length, 0);

  const pairing = authority.control.createPairing('test');
  const session = await authority.pair(pairing, 'test');
  const owner = authority.authenticate(session.token, 'test');

  // No hooks for event: no operation prepared.
  hookExecutor.onTaskEvent({ event: 'exit', job_id: 'j2', label: 'demo', exitCode: 0, signal: null }, { owner });
  await new Promise(r => setTimeout(r, 200));
  assert.equal(audit.filter(e => e.kind === 'capability.execute').length, 0);

  // Real hook event: prepare pending operation.
  hookExecutor.onTaskEvent({ event: 'exit', job_id: 'j3', label: 'demo', exitCode: 1, signal: null }, { owner });
  let pendingNotification: NotificationEntry | undefined;
  for (let i = 0; i < 50; i++) {
    pendingNotification = notifications.list().notifications.find(n => n.source === 'hook' && !!n.body && n.body.includes('pending'));
    if (pendingNotification) break;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.ok(pendingNotification, 'pending hook notification must exist');
  const opId = pendingNotification.body?.match(/operation_id=([a-f0-9-]+)/)?.[1];
  assert.ok(opId);

  // Change hook configuration after prepare; the approved operation must not execute the new command.
  notifications.setHooks({ hooks: [{ event: 'task.failed', command: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker2)}, 'changed')`] }] });
  await authority.decide(owner, opId, 'approve');
  await new Promise(r => setTimeout(r, 500));

  // Original marker must not be written because hook changed after prepare (digest mismatch).
  await assert.rejects(() => fs.stat(marker), { code: 'ENOENT' });
  // Changed marker must not be written because it was not the approved operation.
  await assert.rejects(() => fs.stat(marker2), { code: 'ENOENT' });
  assert.equal(hookExecutor.pendingCount(), 0);

  authority.control.close();
});

test('TaskService delegated service actor cannot authorize hooks', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-hook-service-actor-'));
  const marker = path.join(workspace, 'marker-sa.txt');

  const authority = createExecutionAuthority({
    workspace,
    record: async () => ({ persisted: true })
  });
  const pairing = authority.control.createPairing('test');
  const session = await authority.pair(pairing, 'test');
  const owner = authority.authenticate(session.token, 'test');
  const serviceActor = authority.control.delegate(owner, 'service', ['tasks.command', 'cache.mutate']);

  const notifications = new NotificationService({ workspace, authority });
  notifications.setHooks({ hooks: [{ event: 'task.completed', command: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fired')`] }] });
  const hookExecutor = new HookExecutor({ authority, notifications });

  hookExecutor.onTaskEvent({ event: 'exit', job_id: 'j1', label: 'demo', exitCode: 0, signal: null }, { owner: serviceActor });
  await new Promise(r => setTimeout(r, 300));
  await assert.rejects(() => fs.stat(marker), { code: 'ENOENT' });

  authority.control.close();
});

test('EventHub task payload does not expose actor handle or authority material', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-hook-privacy-'));
  await fs.mkdir(path.join(workspace, '.aide'), { recursive: true });
  const marker = path.join(workspace, 'privacy-hook-marker.txt');

  await fs.writeFile(path.join(workspace, '.aide', 'tasks.json'), JSON.stringify({
    version: '2.0.0',
    tasks: [{ label: 'probe', type: 'process', command: process.execPath, args: ['-e', 'console.log("task-ran")'] }]
  }));
  await fs.writeFile(path.join(workspace, '.aide', 'hooks.json'), JSON.stringify(markerHook(marker)));

  const arch = new ArchServer(workspace, path.join(workspace, 'arch.log'));
  const routes = await buildRoutes(workspace, '0.0.0-test', { events: arch.events, authority: arch.authority });
  for (const route of routes) arch.route(route);
  const server = await arch.listen(0);

  try {
    const base = `http://127.0.0.1:${await getPort(server)}`;
    const owner = await pairFixture(arch, base);

    const port = await getPort(server);
    const token = owner.headers.Authorization.slice(7);
    const ws = await subscribeWs(port, token, ['tasks']);
    const notifications = await watchNotifications(port, token);
    const payloads: Array<{ channel: string; data: { event?: string; job_id?: string; authority_state?: { phase?: string; state?: string; operation_id?: string | null } } }> = [];
    ws.on('message', raw => { payloads.push(JSON.parse(raw.toString()) as typeof payloads[number]); });
    const waitPayload = async (predicate: (p: typeof payloads[number]) => boolean, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = payloads.find(predicate);
        if (found) return found;
        await new Promise(r => setTimeout(r, 50));
      }
      throw new Error('task payload not found');
    };

    try {
      const headers = await owner.approve('POST', '/api/tasks/run', { label: 'probe' }, 'task:privacy');
      const runRes = await owner.request('/api/tasks/run', { method: 'POST', headers, body: JSON.stringify({ label: 'probe' }) });
      assert.equal(runRes.status, 200);
      const jobId = (await runRes.json() as { ok: boolean; data: { job_id: string } }).data.job_id;

      const commandAuth = await waitPayload(p => p.data.event === 'authority' && p.data.authority_state?.phase === 'command' && p.data.authority_state?.state === 'pending');
      assert.ok(commandAuth.data.authority_state?.operation_id);
      assert.equal((await owner.decide(commandAuth.data.authority_state.operation_id, 'approve')).status, 200);
      await waitPayload(p => p.data.event === 'exit' && p.data.job_id === jobId);
      await pollTaskStatus(owner, data => data.jobs.every(j => j.status !== 'running'));
      await new Promise(r => setTimeout(r, 200));

      assert.ok(payloads.length >= 2, 'authorized subscription must observe real task payloads');
      const serialized = JSON.stringify(payloads);
      assert.ok(!serialized.includes(token), 'tasks channel must not carry bearer tokens');
      assert.ok(!serialized.includes('actor_id'), 'tasks channel must not carry actor_id');
      assert.ok(!serialized.includes('Authorization'), 'tasks channel must not carry authorization headers');
      assert.ok(!serialized.includes('handle'), 'tasks channel must not carry actor or execution handles');
      assert.ok(!serialized.includes('execution'), 'tasks channel must not carry execution material');

      const pending = await notifications.wait(n => n.source === 'hook' && !!n.body && n.body.includes('pending'));
      const hookOpId = pending.body?.match(/operation_id=([a-f0-9-]+)/)?.[1];
      assert.ok(hookOpId, 'hook operation must exist for the leak check');
      assert.ok(!serialized.includes(hookOpId), 'capability.execute operation id must not leak on the tasks channel');

      await new Promise(r => setTimeout(r, 300));
      await assert.rejects(() => fs.stat(marker), { code: 'ENOENT' });
    } finally {
      notifications.close();
      ws.close();
    }
  } finally {
    server.close();
    arch.authority.control.close();
  }
});

test('task observation does not require hook execution authorization', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-hook-observe-'));
  await fs.mkdir(path.join(workspace, '.aide'), { recursive: true });
  const marker = path.join(workspace, 'observe-hook-marker.txt');

  await fs.writeFile(path.join(workspace, '.aide', 'tasks.json'), JSON.stringify({
    version: '2.0.0',
    tasks: [{ label: 'probe', type: 'process', command: process.execPath, args: ['-e', 'console.log("task-ran")'] }]
  }));
  await fs.writeFile(path.join(workspace, '.aide', 'hooks.json'), JSON.stringify({
    hooks: [{ event: 'task.completed', command: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fired')`] }]
  }));

  const arch = new ArchServer(workspace, path.join(workspace, 'arch.log'));
  const routes = await buildRoutes(workspace, '0.0.0-test', { events: arch.events, authority: arch.authority });
  for (const route of routes) arch.route(route);
  const server = await arch.listen(0);

  try {
    const base = `http://127.0.0.1:${await getPort(server)}`;
    const owner = await pairFixture(arch, base);

    const port = await getPort(server);
    const token = owner.headers.Authorization.slice(7);
    const notifications = await watchNotifications(port, token);
    const tasks = await watchTasks(port, token);

    try {
      const headers = await owner.approve('POST', '/api/tasks/run', { label: 'probe' }, 'task:observe');
      const runRes = await owner.request('/api/tasks/run', { method: 'POST', headers, body: JSON.stringify({ label: 'probe' }) });
      assert.equal(runRes.status, 200);
      const jobId = (await runRes.json() as { ok: boolean; data: { job_id: string } }).data.job_id;

      const commandAuth = await tasks.wait(e => e.event === 'authority' && e.authority_state?.phase === 'command' && e.authority_state?.state === 'pending');
      assert.ok(commandAuth.authority_state?.operation_id);
      assert.equal((await owner.decide(commandAuth.authority_state.operation_id, 'approve')).status, 200);
      await pollTaskStatus(owner, data => data.jobs.every(j => j.status !== 'running'));

      const taskNotice = await notifications.wait(n => n.source === 'task' && n.job_id === jobId);
      assert.match(taskNotice.title, /passed/);

      const pending = await notifications.wait(n => n.source === 'hook' && !!n.body && n.body.includes('pending'));
      const hookOpId = pending.body?.match(/operation_id=([a-f0-9-]+)/)?.[1];
      assert.ok(hookOpId, 'hook operation must be pending and unapproved');
      await new Promise(r => setTimeout(r, 300));
      await assert.rejects(() => fs.stat(marker), { code: 'ENOENT' });

      const deniedPromise = notifications.wait(n => n.source === 'hook' && !!n.body && n.body.includes('denied'));
      assert.equal((await owner.decide(hookOpId, 'reject')).status, 200);
      const denied = await deniedPromise;
      assert.ok(denied.body?.includes(hookOpId));
      await assert.rejects(() => fs.stat(marker), { code: 'ENOENT' });
    } finally {
      notifications.close();
      tasks.close();
    }
  } finally {
    server.close();
    arch.authority.control.close();
  }
});

test('task observation needs no hook configuration at all', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-hook-nohook-'));
  await fs.mkdir(path.join(workspace, '.aide'), { recursive: true });

  await fs.writeFile(path.join(workspace, '.aide', 'tasks.json'), JSON.stringify({
    version: '2.0.0',
    tasks: [{ label: 'probe', type: 'process', command: process.execPath, args: ['-e', 'console.log("task-ran")'] }]
  }));

  const arch = new ArchServer(workspace, path.join(workspace, 'arch.log'));
  const routes = await buildRoutes(workspace, '0.0.0-test', { events: arch.events, authority: arch.authority });
  for (const route of routes) arch.route(route);
  const server = await arch.listen(0);

  try {
    const base = `http://127.0.0.1:${await getPort(server)}`;
    const owner = await pairFixture(arch, base);

    const port = await getPort(server);
    const token = owner.headers.Authorization.slice(7);
    const notifications = await watchNotifications(port, token);
    const tasks = await watchTasks(port, token);

    try {
      const headers = await owner.approve('POST', '/api/tasks/run', { label: 'probe' }, 'task:nohook');
      const runRes = await owner.request('/api/tasks/run', { method: 'POST', headers, body: JSON.stringify({ label: 'probe' }) });
      assert.equal(runRes.status, 200);
      const jobId = (await runRes.json() as { ok: boolean; data: { job_id: string } }).data.job_id;

      const commandAuth = await tasks.wait(e => e.event === 'authority' && e.authority_state?.phase === 'command' && e.authority_state?.state === 'pending');
      assert.ok(commandAuth.authority_state?.operation_id);
      assert.equal((await owner.decide(commandAuth.authority_state.operation_id, 'approve')).status, 200);
      await pollTaskStatus(owner, data => data.jobs.every(j => j.status !== 'running'));

      const taskNotice = await notifications.wait(n => n.source === 'task' && n.job_id === jobId);
      assert.match(taskNotice.title, /passed/);
      assert.ok(!notifications.received.some(n => n.source === 'hook'), 'no hook notification without hook configuration');
    } finally {
      notifications.close();
      tasks.close();
    }
  } finally {
    server.close();
    arch.authority.control.close();
  }
});

test('hook-level revocation produces zero side effects and no unhandled rejection', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-hook-revoke-'));
  const marker = path.join(workspace, 'revoke-marker.txt');
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => { rejections.push(reason); };
  process.on('unhandledRejection', onRejection);
  const { authority, owner } = await directAuthority(workspace);
  const notifications = new NotificationService({ workspace, authority });
  notifications.setHooks(markerHook(marker));
  const hookExecutor = new HookExecutor({ authority, notifications });
  try {
    hookExecutor.onTaskEvent({ event: 'exit', job_id: 'jrevoke', label: 'demo', exitCode: 0, signal: null }, { owner });
    const pending = await waitForHookEntry(notifications, n => n.source === 'hook' && !!n.body && n.body.includes('pending'));
    const opId = opIdFrom(pending);
    assert.equal(hookExecutor.pendingCount(), 1);
    authority.control.revoke(owner);
    const terminal = await waitForHookEntry(notifications, n => n.source === 'hook' && !!n.body && n.body.includes(opId) && !n.body.includes('pending'));
    assert.match(terminal.body ?? '', /revoked|failed|denied/);
    await new Promise(r => setTimeout(r, 300));
    await assert.rejects(() => fs.stat(marker), { code: 'ENOENT' });
    assert.equal(hookExecutor.pendingCount(), 0);
    await new Promise(r => setTimeout(r, 200));
    assert.deepEqual(rejections, []);
  } finally {
    process.off('unhandledRejection', onRejection);
    authority.control.close();
  }
});

test('hook-level expiration produces zero side effects', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-hook-expire-'));
  const marker = path.join(workspace, 'expire-marker.txt');
  const { authority, owner } = await directAuthority(workspace, { operationTtlMs: 200 });
  const notifications = new NotificationService({ workspace, authority });
  notifications.setHooks(markerHook(marker));
  const hookExecutor = new HookExecutor({ authority, notifications });
  try {
    hookExecutor.onTaskEvent({ event: 'exit', job_id: 'jexpire', label: 'demo', exitCode: 0, signal: null }, { owner });
    const pending = await waitForHookEntry(notifications, n => n.source === 'hook' && !!n.body && n.body.includes('pending'));
    const opId = opIdFrom(pending);
    assert.equal(hookExecutor.pendingCount(), 1);
    const terminal = await waitForHookEntry(notifications, n => n.source === 'hook' && !!n.body && n.body.includes(opId) && !n.body.includes('pending'));
    assert.match(terminal.body ?? '', /expired/);
    await assert.rejects(() => fs.stat(marker), { code: 'ENOENT' });
    assert.equal(hookExecutor.pendingCount(), 0);
  } finally {
    authority.control.close();
  }
});

test('consumed tasks.run authorization cannot authorize a hook', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-hook-consumed-'));
  const marker = path.join(workspace, 'consumed-marker.txt');
  const { authority, owner } = await directAuthority(workspace);
  const notifications = new NotificationService({ workspace, authority });
  notifications.setHooks(markerHook(marker));
  try {
    const input = { workspace, taskId: 'task:consumed-run', kind: 'tasks.run', args: { body: { label: 'probe' } } };
    const operation = await authority.prepare(owner, input);
    assert.equal((await authority.decide(owner, operation.operation_id, 'approve')).state, 'approved');
    let consumed: ExecutionHandle | undefined;
    await authority.execute(owner, operation.operation_id, input, (_descriptor, execution) => { consumed = execution; return 'ran'; });
    assert.ok(consumed, 'tasks.run handle must have been issued');
    const consumedHandle = consumed!;
    await assert.rejects(() => notifications.runHooks('task.completed', {}, consumedHandle), AuthorityError);
    await assert.rejects(() => notifications.runHooks('task.completed', {}, { ...consumedHandle }), AuthorityError);
    await new Promise(r => setTimeout(r, 200));
    await assert.rejects(() => fs.stat(marker), { code: 'ENOENT' });
  } finally {
    authority.control.close();
  }
});

test('pending continuation state is cleaned on every terminal path', async () => {
  const scenarios: Array<{ name: string; act: 'approve' | 'reject' | 'revoke' | 'expire' | 'prepare-failure'; ttl?: number }> = [
    { name: 'approved', act: 'approve' },
    { name: 'denied', act: 'reject' },
    { name: 'revoked', act: 'revoke' },
    { name: 'expired', act: 'expire', ttl: 200 },
    { name: 'prepare-failure', act: 'prepare-failure' }
  ];
  for (const scenario of scenarios) {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), `phase2a-hook-clean-${scenario.act}-`));
    const marker = path.join(workspace, 'clean-marker.txt');
    const { authority, owner } = await directAuthority(workspace, scenario.ttl ? { operationTtlMs: scenario.ttl } : {});
    const notifications = new NotificationService({ workspace, authority });
    notifications.setHooks(markerHook(marker));
    const hookExecutor = new HookExecutor({ authority, notifications });
    try {
      if (scenario.act === 'prepare-failure') {
        authority.control.revoke(owner);
        hookExecutor.onTaskEvent({ event: 'exit', job_id: 'j-pre', label: 'demo', exitCode: 0, signal: null }, { owner });
        await waitForHookEntry(notifications, n => n.source === 'hook' && !!n.body && n.body.includes('failed'));
        assert.equal(hookExecutor.pendingCount(), 0, `${scenario.name}: no pending entry after prepare failure`);
        continue;
      }
      hookExecutor.onTaskEvent({ event: 'exit', job_id: `j-${scenario.act}`, label: 'demo', exitCode: 0, signal: null }, { owner });
      const pending = await waitForHookEntry(notifications, n => n.source === 'hook' && !!n.body && n.body.includes('pending'));
      const opId = opIdFrom(pending);
      assert.equal(hookExecutor.pendingCount(), 1, `${scenario.name}: pending entry present while awaiting decision`);
      if (scenario.act === 'approve') await authority.decide(owner, opId, 'approve');
      if (scenario.act === 'reject') await authority.decide(owner, opId, 'reject');
      if (scenario.act === 'revoke') authority.control.revoke(owner);
      const expected = scenario.act === 'approve'
        ? 'succeeded'
        : scenario.act === 'reject'
          ? 'denied'
          : null;
      if (expected) {
        await waitForHookEntry(notifications, n => n.source === 'hook' && !!n.body && n.body.includes(expected));
      } else {
        await waitForHookEntry(notifications, n => n.source === 'hook' && !!n.body && n.body.includes(opId) && !n.body.includes('pending'));
      }
      if (expected !== 'succeeded') await assert.rejects(() => fs.stat(marker), { code: 'ENOENT' }, `${scenario.name}: no hook side effect`);
      assert.equal(hookExecutor.pendingCount(), 0, `${scenario.name}: pending entry cleaned`);
    } finally {
      authority.control.close();
    }
  }
});

test('duplicate task event delivery cannot produce an unintended second hook execution', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-hook-duplicate-'));
  const marker = path.join(workspace, 'dup-marker.txt');
  const { authority, owner } = await directAuthority(workspace);
  const notifications = new NotificationService({ workspace, authority });
  notifications.setHooks({ hooks: [{ event: 'task.completed', command: [process.execPath, '-e', `require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'x')`] }] });
  const hookExecutor = new HookExecutor({ authority, notifications });
  try {
    const evt = { event: 'exit' as const, job_id: 'jdup', label: 'demo', exitCode: 0, signal: null };
    hookExecutor.onTaskEvent(evt, { owner });
    hookExecutor.onTaskEvent(evt, { owner });
    for (let i = 0; i < 100 && hookExecutor.pendingCount() < 2; i++) await new Promise(r => setTimeout(r, 50));
    assert.equal(hookExecutor.pendingCount(), 2, 'duplicate delivery creates gated requests, never executions');

    const pending = notifications.list().notifications.filter(n => n.source === 'hook' && !!n.body && n.body.includes('pending'));
    assert.equal(pending.length, 2, 'each delivery must wait for its own approval');
    const firstId = opIdFrom(pending[0]!);
    const secondId = opIdFrom(pending[1]!);
    assert.notEqual(firstId, secondId);

    await authority.decide(owner, firstId, 'approve');
    await waitForHookEntry(notifications, n => n.source === 'hook' && !!n.body && n.body.includes('succeeded'));
    assert.equal(await fs.readFile(marker, 'utf8'), 'x', 'exactly one approved execution');
    await new Promise(r => setTimeout(r, 300));
    assert.equal(await fs.readFile(marker, 'utf8'), 'x', 'the unapproved duplicate produces no execution');
    assert.equal(hookExecutor.pendingCount(), 1);

    await authority.decide(owner, secondId, 'reject');
    await waitForHookEntry(notifications, n => n.source === 'hook' && !!n.body && n.body.includes(secondId) && n.body.includes('denied'));
    assert.equal(await fs.readFile(marker, 'utf8'), 'x');
    assert.equal(hookExecutor.pendingCount(), 0);
  } finally {
    authority.control.close();
  }
});
