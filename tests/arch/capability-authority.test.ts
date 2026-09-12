import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ArchServer } from '../../node/src/server.ts';
import { routesForGit } from '../../node/src/routes/git.ts';
import { GitService } from '../../node/src/services/git-service.mjs';
import { pairFixture, pairServiceFixture } from './authority-fixture.ts';
import { WebSocket, type RawData } from 'ws';
import { once } from 'node:events';
import { createTelegramBridgeService, routesForTelegram } from '../../node/src/routes/telegram.ts';
import fsSync from 'node:fs';
import { BuildCache } from '../../node/src/services/build-cache.mjs';
import { TaskService } from '../../node/src/services/task-service.mjs';
import { TaskEvent, TaskJob, type TaskEventT } from '../../common/contracts/tasks.ts';
import { routesForTasks } from '../../node/src/routes/tasks.ts';
import { NotificationService } from '../../node/src/services/notification-service.mjs';
import { AuthorityError } from '../../node/src/services/execution-authority.mjs';

test('workspace task hooks cannot reach a command executor without canonical authority', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-hook-boundary-'));
  await fs.mkdir(path.join(workspace, '.aide'));
  const marker = path.join(workspace, 'must-not-exist.txt');
  await fs.writeFile(path.join(workspace, '.aide', 'hooks.json'), JSON.stringify({ hooks: [{
    event: 'task.started', command: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unauthorized')`]
  }] }));
  const service = new NotificationService({ workspace });
  const captured: string[][] = [];
  // Capture at the executor seam: never start the malicious fixture command.
  service.runHookCommand = async hook => { captured.push([...hook.command]); return { ok: true, timed_out: false, output: 'captured, not executed' }; };
  await service.loadHooks();
  service.ingestTaskEvent({ event: 'started', job_id: 'forged-serialized-job', label: 'workspace hook' });
  await assert.rejects(
    () => service.runHooks('task.started', { approved: true, actor_id: 'forged' }, { forged: true } as unknown as import('../../node/src/services/execution-authority.mjs').ExecutionHandle),
    AuthorityError
  );
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
  console.log(JSON.stringify({ hookBoundaryWorkspace: workspace, capturedExecutorCalls: captured.length, realProcessesSpawned: 0, realMutations: 0 }));
  assert.deepEqual(captured, [], 'task event/payload must not authorize hook command execution');
});

test('task HTTP graph approval and real EventHub/WS lifecycle reject replay and changed commands', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-task-http-'));
  await fs.mkdir(path.join(workspace, '.vscode'));
  const file = path.join(workspace, '.vscode', 'tasks.json');
  const tasks = { version: '2.0.0', tasks: [{ label: 'probe', type: 'process', command: process.execPath, args: ['-e', 'console.log("task-http-marker")'] }] };
  await fs.writeFile(file, JSON.stringify(tasks));
  const arch = new ArchServer(workspace, path.join(workspace, 'arch.log'));
  for (const route of routesForTasks(workspace, { authority: arch.authority, onEvent: event => assert.deepEqual(arch.events.publish('tasks', event), { accepted: true }) })) arch.route(route);
  const server = await arch.listen(0);
  let socket: WebSocket | undefined;
  try {
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const owner = await pairFixture(arch, base);
    const body = { label: 'probe' };
    assert.equal((await fetch(`${base}/api/tasks/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status, 403);
    const stale = await owner.approve('POST', '/api/tasks/run', body, 'http-task');
    tasks.tasks[0]!.args = ['-e', 'console.log("altered")'];
    await fs.writeFile(file, JSON.stringify(tasks));
    assert.equal((await owner.request('/api/tasks/run', { method: 'POST', headers: stale, body: JSON.stringify(body) })).status, 409);
    const empty = await owner.request('/api/tasks/status');
    assert.deepEqual((await empty.json()).data.jobs, []);
    const headers = await owner.approve('POST', '/api/tasks/run', body, 'http-task');
    socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { origin: owner.headers.Origin });
    await once(socket, 'open');
    const auth = once(socket, 'message', { signal: AbortSignal.timeout(5000) });
    socket.send(JSON.stringify({ type: 'authenticate', token: owner.headers.Authorization.slice(7) }));
    await auth;
    socket.send(JSON.stringify({ type: 'subscribe', channels: ['tasks'] }));
    const barrier = once(socket, 'pong', { signal: AbortSignal.timeout(5000) }); socket.ping(); await barrier;
    const event = once(socket, 'message', { signal: AbortSignal.timeout(5000) });
    const response = await owner.request('/api/tasks/run', { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    const jobId = (await response.json()).data.job_id;
    const delivered = JSON.parse(String((await event)[0]));
    assert.equal(delivered.channel, 'tasks'); assert.equal(delivered.data.event, 'authority');
    assert.equal(delivered.data.authority_state.phase, 'command'); assert.equal(delivered.data.authority_state.state, 'pending');
    assert.equal(delivered.data.job_id, jobId);
    assert.equal(TaskEvent.safeParse(delivered.data).success, true);
    assert.equal((await owner.request('/api/tasks/run', { method: 'POST', headers, body: JSON.stringify(body) })).status, 409);
    const exit = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('task exit event deadline')), 5000);
      socket!.on('message', raw => { const message = JSON.parse(String(raw)); if (message.data?.event === 'exit' && message.data.job_id === jobId) { clearTimeout(timer); resolve(); } });
    });
    assert.equal((await owner.decide(delivered.data.authority_state.operation_id, 'approve')).status, 200);
    await exit;
    const status = await owner.request('/api/tasks/status');
    assert.equal(status.status, 200);
    assert.equal((await status.json()).data.jobs[0].status, 'exited');
    console.log(JSON.stringify({ taskHttpWorkspace: workspace, port: address.port, typedApprovalEventDelivered: true, changedGraphRejected: true, replayRejected: true }));
  } finally {
    socket?.terminate(); arch.events.close(); server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await arch.logger.flush();
  }
});

test('task/cache lifecycle requires fresh approvals; serialized pending state and consumed handles grant nothing', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-task-authority-'));
  const f = await pairServiceFixture(workspace);
  await fs.mkdir(path.join(workspace, '.vscode'));
  await fs.writeFile(path.join(workspace, 'input.txt'), 'source');
  await fs.writeFile(path.join(workspace, '.vscode', 'tasks.json'), JSON.stringify({ version: '2.0.0', tasks: [{
    label: 'build', type: 'process', command: process.execPath,
    args: ['-e', 'require("node:fs").writeFileSync("ran.txt", "ran"); console.log("built")'], cache: { inputs: ['input.txt'] }
  }] }));
  const events: TaskEventT[] = [];
  const waiters = new Set<() => void>();
  const svc = new TaskService({ workspace, authority: f.authority, onEvent: event => {
    assert.equal(TaskEvent.safeParse(event).success, true, JSON.stringify(event));
    events.push(event); for (const wake of [...waiters]) wake();
  } });
  const wait = (predicate: (event: TaskEventT) => boolean) => new Promise<TaskEventT>((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(check); reject(new Error('task lifecycle event deadline')); }, 5000);
    const check = () => { const found = events.find(predicate); if (found) { clearTimeout(timer); waiters.delete(check); resolve(found); } };
    waiters.add(check); check();
  });
  try {
    for (const handle of [undefined, { approved: true }, { approved: 'false' }, { operation_id: 'forged' }]) {
      await assert.rejects(svc.run('build', handle as never), { code: 'FORBIDDEN' });
    }
    assert.equal(svc.status().jobs.length, 0);
    await assert.rejects(fs.stat(path.join(workspace, 'ran.txt')), { code: 'ENOENT' });
    const input = await svc.describeRun('build', 'exact-task');
    let consumed: import('../../node/src/services/execution-authority.mjs').ExecutionHandle | undefined;
    const run = await f.approveAndExecute(input.kind, input.args.body, input.taskId, execution => { consumed = execution; return svc.run('build', execution); });
    await assert.rejects(svc.run('build', consumed), { code: 'FORBIDDEN' });
    const get = await wait(e => e.event === 'authority' && e.authority_state.phase === 'cache-get' && e.authority_state.state === 'pending');
    assert.equal(get.event, 'authority'); if (get.event !== 'authority') throw new Error('wrong event');
    const getId = get.authority_state.operation_id!;
    const pending = f.authority.inspect(f.owner, getId);
    assert.equal(pending.state, 'pending');
    assert.equal(TaskJob.safeParse(svc.status().jobs[0]).success, true);
    // Neither an observed/persisted operation nor its ID is an execution handle.
    await assert.rejects(svc.cache.get('k1', JSON.parse(JSON.stringify(pending))), { code: 'FORBIDDEN' });
    await assert.rejects(svc.cache.get('k1', consumed), { code: 'FORBIDDEN' });
    await assert.rejects(fs.stat(path.join(workspace, '.aide', 'cache', 'builds')), { code: 'ENOENT' });
    await f.authority.decide(f.owner, getId, 'approve');
    const command = await wait(e => e.event === 'authority' && e.authority_state.phase === 'command' && e.authority_state.state === 'pending');
    if (command.event !== 'authority') throw new Error('wrong event');
    assert.notEqual(command.authority_state.operation_id, getId);
    await assert.rejects(fs.stat(path.join(workspace, 'ran.txt')), { code: 'ENOENT' });
    await f.authority.decide(f.owner, command.authority_state.operation_id!, 'approve');
    const record = await wait(e => e.event === 'authority' && e.authority_state.phase === 'cache-record' && e.authority_state.state === 'pending');
    if (record.event !== 'authority') throw new Error('wrong event');
    const recordId = record.authority_state.operation_id!;
    assert.notEqual(recordId, getId);
    assert.equal(await fs.readFile(path.join(workspace, 'ran.txt'), 'utf8'), 'ran');
    const before = await fs.readFile(path.join(svc.cache.dir, 'index.json'), 'utf8');
    assert.deepEqual(svc.cache.stats().entries, []);
    await f.authority.decide(f.owner, recordId, 'reject');
    await wait(e => e.event === 'exit' && e.job_id === run.job_id);
    assert.equal(await fs.readFile(path.join(svc.cache.dir, 'index.json'), 'utf8'), before);
    assert.deepEqual(await fs.readdir(svc.cache.dir), ['index.json']);
    const job = svc.status().jobs[0]!;
    assert.equal(job.status, 'exited'); // process success is separate from cache denial
    const parsed = TaskJob.parse(job);
    assert.equal(parsed.authority_state?.state, 'denied');
    await assert.rejects(f.authority.decide(f.owner, recordId, 'approve'), { code: 'CONFLICT' });
    console.log(JSON.stringify({ taskFixture: workspace, freshOperations: [getId, command.authority_state.operation_id, recordId], deniedRecordTargetsUnchanged: true }));
  } finally { f.authority.control.close(); }
});

test('cache eviction cannot turn workspace-controlled index keys into out-of-cache deletion', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-cache-scope-'));
  const dir = path.join(workspace, '.aide', 'cache', 'builds');
  await fs.mkdir(dir, { recursive: true });
  const victim = path.join(workspace, 'source.log');
  await fs.writeFile(victim, 'protected fixture source');
  const key = '../../../source';
  await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify({ entries: {
    [key]: { key, label: 'poisoned persisted entry', createdAt: 1, sizeBytes: 1, exitCode: 0 }
  }, hits: 0, misses: 0 }));
  const cache = new BuildCache({ workspace, maxEntries: 1 });
  const originalRemove = fsSync.rmSync;
  const originalUnlink = fsSync.unlinkSync;
  const targets: string[] = [];
  fsSync.rmSync = target => { targets.push(String(target)); }; // capture only: never delete
  fsSync.unlinkSync = target => { targets.push(String(target)); };
  let failure: unknown;
  try {
    await cache.record({ key: 'a'.repeat(32), label: 'approved task', createdAt: 2, sizeBytes: 1, exitCode: 0 }, 'ok', []);
  } catch (error) { failure = error; }
  finally { fsSync.rmSync = originalRemove; fsSync.unlinkSync = originalUnlink; }
  assert.equal(await fs.readFile(victim, 'utf8'), 'protected fixture source');
  const outside = targets.filter(target => {
    const relative = path.relative(dir, target);
    return relative.startsWith('..') || path.isAbsolute(relative);
  });
  console.log(JSON.stringify({ cacheScopeFixture: workspace, capturedDeletionTargets: targets, outsideCacheTargets: outside, realDeletions: 0, errorObserved: failure instanceof Error ? failure.message : null }));
  assert.deepEqual(outside, [], 'cache index content must not enlarge an approved mutation target');
  assert.equal((failure as { code: string }).code, 'CACHE_BOUNDARY', 'confinement itself must reject the poisoned index');
});

test('cache path matrix rejects traversal, rooted, normalized, encoded and invalid keys before I/O', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-cache-keys-'));
  const victim = path.join(workspace, 'source.log'); await fs.writeFile(victim, 'source remains');
  const cache = new BuildCache({ workspace });
  const keys = ['../../../source', '..\\..\\..\\source', '/tmp/source', '\\source', 'C:\\source', 'C:source',
    '\\\\server\\share\\source', '\\\\?\\C:\\source', 'a/../../source', 'a\\..\\source', '.', '..', '',
    '%2e%2e%2fsource', 'x:stream', 'con', 'nul', 'key.', 'key ', 'UPPER', '__proto__', 'constructor', 'prototype'];
  const targets: string[] = [];
  const unlink = fsSync.unlinkSync, rm = fsSync.rmSync;
  fsSync.unlinkSync = target => { targets.push(String(target)); };
  fsSync.rmSync = target => { targets.push(String(target)); };
  try {
    for (const key of keys) {
      const payload = { manifest: { key, label: 'invalid', createdAt: 1, sizeBytes: 1, exitCode: 0 }, logText: 'x', problems: [] };
      assert.throws(() => cache.describe('record', payload, 'path-negative'), { code: 'CACHE_BOUNDARY' });
      await assert.rejects(cache.record(payload.manifest, 'x', []), { code: 'CACHE_BOUNDARY' });
    }
    assert.deepEqual(targets, []);
    assert.equal(await fs.readFile(victim, 'utf8'), 'source remains');
    assert.deepEqual(await fs.readdir(workspace), ['source.log']);
  } finally { fsSync.unlinkSync = unlink; fsSync.rmSync = rm; }
  console.log(JSON.stringify({ cacheKeyMatrix: keys.length, deletedTargets: targets, platform: process.platform }));
});

test('cache canonical authority preserves record/hit/LRU/clear and denies forgery, alteration and replay', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-cache-valid-'));
  const f = await pairServiceFixture(workspace);
  const cache = new BuildCache({ workspace, authority: f.authority, maxEntries: 2 });
  const payload = (key: string, stamp: number) => ({ manifest: { key, label: key, createdAt: stamp, sizeBytes: 3, exitCode: 0 }, logText: 'log', problems: [] });
  async function record(key: string, stamp: number) {
    const data = payload(key, stamp), input = cache.describe('record', data, 'cache-fixture');
    return f.approveAndExecute('cache.mutate', input.args.body, input.taskId,
      execution => cache.record(data.manifest, data.logText, data.problems, execution));
  }
  const first = payload('k1', 1);
  for (const forged of [undefined, { operation_id: 'forged', approved: true }, { operation_id: 'forged', approved: 'false' }]) {
    await assert.rejects(cache.record(first.manifest, first.logText, [], forged), { code: 'FORBIDDEN' });
    assert.deepEqual(await fs.readdir(workspace), []);
  }
  const input = cache.describe('record', first, 'cache-fixture');
  const pending = await f.authority.prepare(f.owner, input);
  await f.authority.decide(f.owner, pending.operation_id, 'approve');
  await assert.rejects(f.authority.execute(f.owner, pending.operation_id, { ...input, args: { body: { ...input.args.body as object, root: workspace } } }, () => assert.fail('altered target reached executor')), { code: 'CONFLICT' });
  await f.authority.execute(f.owner, pending.operation_id, input, (executionDescriptor, execution) => {
    assert.equal(executionDescriptor.kind, 'cache.mutate');
    return cache.record(first.manifest, first.logText, [], execution);
  });
  await assert.rejects(f.authority.execute(f.owner, pending.operation_id, input, () => assert.fail('replay reached executor')), { code: 'CONFLICT' });
  await record('k2', 2);
  const getInput = cache.describe('get', { key: 'k1' }, 'cache-fixture');
  const hit = await f.approveAndExecute('cache.mutate', getInput.args.body, getInput.taskId, execution => cache.get('k1', execution));
  assert.equal(hit?.logText, 'log'); assert.equal(cache.stats().hits, 1);
  await record('k3', 3);
  assert.deepEqual(cache.stats().entries.map(entry => entry.key).sort(), ['k1', 'k3']);
  assert.equal(fsSync.existsSync(path.join(cache.dir, 'k2.log')), false);
  const clearInput = cache.describe('clear', {}, 'cache-fixture');
  const cleared = await f.approveAndExecute('cache.mutate', clearInput.args.body, clearInput.taskId, execution => cache.clear(execution));
  assert.equal(cleared, 2); assert.deepEqual(cache.stats().entries, []);
  assert.deepEqual(await fs.readdir(cache.dir), []);
  console.log(JSON.stringify({ cacheCompatibility: 'record/hit/LRU/clear', root: cache.dir, hits: hit !== null }));
});

test('cache rejects redirected roots and linked targets, and binds resolved target identity', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-cache-links-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-cache-peer-'));
  const source = path.join(outside, 'source.log'); await fs.writeFile(source, 'unrelated');
  for (const dir of [workspace, path.dirname(workspace), path.join(workspace, 'source'), outside]) {
    assert.throws(() => new BuildCache({ workspace, dir }), { code: 'CACHE_BOUNDARY' });
  }
  await fs.mkdir(path.join(workspace, '.aide', 'cache'), { recursive: true });
  const root = path.join(workspace, '.aide', 'cache', 'builds');
  await fs.symlink(outside, root, process.platform === 'win32' ? 'junction' : 'dir');
  const redirected = new BuildCache({ workspace });
  assert.throws(() => redirected.describe('clear', {}, 'root-negative'), { code: 'CACHE_BOUNDARY' });
  await fs.unlink(root); await fs.mkdir(root);
  await fs.link(source, path.join(root, 'k1.log'));
  const linked = new BuildCache({ workspace });
  assert.throws(() => linked.describe('get', { key: 'k1' }, 'link-negative'), { code: 'CACHE_BOUNDARY' });
  await fs.unlink(path.join(root, 'k1.log'));
  const f = await pairServiceFixture(workspace);
  const cache = new BuildCache({ workspace, authority: f.authority });
  const input = cache.describe('clear', {}, 'bound-directory');
  const op = await f.authority.prepare(f.owner, input); await f.authority.decide(f.owner, op.operation_id, 'approve');
  await fs.rename(root, root + '-original');
  await fs.symlink(outside, root, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.authority.execute(f.owner, op.operation_id, input, (_, execution) => cache.clear(execution)), { code: 'CACHE_BOUNDARY' });
  assert.equal(await fs.readFile(source, 'utf8'), 'unrelated');
  await fs.unlink(root); await fs.rename(root + '-original', root);
});

test('cache eviction deletion failure remains a failure with completed-target evidence', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-cache-failure-'));
  const f = await pairServiceFixture(workspace);
  const cache = new BuildCache({ workspace, authority: f.authority, maxEntries: 1 });
  async function record(key: string, createdAt: number) {
    const manifest = { key, label: key, createdAt, exitCode: 0, sizeBytes: 1 }, payload = { manifest, logText: 'x', problems: [] };
    const input = cache.describe('record', payload, 'failure-fixture');
    return f.approveAndExecute('cache.mutate', input.args.body, input.taskId, execution => cache.record(manifest, 'x', [], execution));
  }
  await record('k1', 1);
  const unlink = fsSync.unlinkSync;
  fsSync.unlinkSync = target => {
    assert.equal(String(target), path.join(cache.dir, 'k1.log'));
    throw Object.assign(new Error('injected deletion failure'), { code: 'EACCES' });
  };
  try {
    await assert.rejects(record('k2', 2), (error: { code: string; detail: { outcome: string; cause: string; completed: string[] } }) => {
      assert.equal(error.code, 'CACHE_BOUNDARY'); assert.equal(error.detail.outcome, 'partial');
      assert.match(error.detail.cause, /injected deletion failure/); assert.equal(error.detail.completed.length, 2); return true;
    });
    assert.equal(fsSync.existsSync(path.join(cache.dir, 'k1.log')), true);
    assert.deepEqual(cache.stats().entries.map(entry => entry.key), ['k1']);
    assert.equal(f.records.at(-1)?.decision, 'execution-failed');
  } finally { fsSync.unlinkSync = unlink; }
});

test('Telegram HTTP routes propagate canonical authority and never grant from payloads', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-telegram-http-'));
  const configPath = path.join(workspace, '.aide', 'telegram', 'config.json');
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const before = JSON.stringify({ enabled: false, token_b64: '', bot_username: null, chat_ids: [] });
  await fs.writeFile(configPath, before);
  const arch = new ArchServer(workspace, path.join(workspace, 'arch.log'));
  const bridge = createTelegramBridgeService(workspace, undefined, arch.authority);
  for (const route of routesForTelegram(bridge)) arch.route(route);
  const server = await arch.listen(0);
  try {
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const owner = await pairFixture(arch, base);
    const other = await pairFixture(arch, base);
    const body = { chat_id: 123, user_id: 456 };
    const direct = await fetch(`${base}/api/telegram/authorize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(direct.status, 403);
    await assert.rejects(async () => bridge.authorizeChat(body), { code: 'FORBIDDEN' });
    for (const approved of [true, 'false', false]) {
      const rejected = await owner.request('/api/telegram/authorize', { method: 'POST', body: JSON.stringify({ ...body, approved }) });
      assert.equal(rejected.status, 400);
      assert.equal(await fs.readFile(configPath, 'utf8'), before);
    }
    const pending = await owner.request('/api/telegram/authorize', { method: 'POST', body: JSON.stringify(body) });
    assert.equal(pending.status, 409);
    const headers = await owner.approve('POST', '/api/telegram/authorize', body, 'telegram-binding');
    for (const variant of [
      { client: other, body, headers },
      { client: owner, body: { ...body, user_id: 789 }, headers },
      { client: owner, body: { ...body, chat_id: 789 }, headers },
      { client: owner, body, headers: { ...headers, 'X-AIDE-Task': 'wrong-task' } }
    ]) {
      const rejected = await variant.client.request('/api/telegram/authorize', { method: 'POST', headers: variant.headers, body: JSON.stringify(variant.body) });
      assert.ok([403, 409].includes(rejected.status));
      assert.equal(await fs.readFile(configPath, 'utf8'), before);
    }
    const accepted = await owner.request('/api/telegram/authorize', { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(accepted.status, 200);
    const status = await accepted.json();
    assert.equal(status.ok, true);
    assert.equal(status.data.running, false, 'identity grant must not implicitly start network polling');
    const saved = await fs.readFile(configPath, 'utf8');
    assert.deepEqual(JSON.parse(saved).chat_ids, [123]);
    const replay = await owner.request('/api/telegram/authorize', { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(replay.status, 409);
    assert.equal(await fs.readFile(configPath, 'utf8'), saved);
    const read = await owner.request('/api/telegram/status');
    assert.equal(read.status, 200);
    assert.equal((await read.json()).ok, true);
    console.log(JSON.stringify({ telegramFixture: workspace, port: address.port, negativeCases: 10, approvedIdentityBindings: 1, networkCalls: 0 }));
  } finally {
    arch.events.close(); arch.authority.control.close(); server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await arch.logger.flush();
  }
});

// Actual route/server/facade; capture the executor so a red security test
// cannot mutate a repository. No test-only bypass is added to production.
test('unpaired capability callers cannot stage through direct TS or facade', async () => {
  const workspace = await fs.mkdtemp(path.join(process.platform === 'win32' ? 'E:/pip_temp/opencode' : os.tmpdir(), 'phase2a-authority-'));
  const arch = new ArchServer(workspace, path.join(workspace, 'arch.log'));
  const savedStage = GitService.prototype.stage;
  const savedRun = GitService.prototype.run;
  const calls: string[][] = [];
  GitService.prototype.stage = async function (paths: string[]) { calls.push(paths); };
  GitService.prototype.run = async function () { return { stdout: 'fixture-head', stderr: '' }; };
  const { createFacade, loadRouteMap } = await import(new URL('../../scripts/facade.mjs', import.meta.url).href);
  let facade: { server: import('node:http').Server; close(): Promise<void> } | undefined;
  let server: import('node:http').Server | undefined;
  try {
    for (const route of routesForGit(workspace)) arch.route(route);
    server = await arch.listen(0);
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const target = { host: '127.0.0.1', port: address.port };
    facade = await createFacade({ routeMap: await loadRouteMap(path.resolve('common/facade-route-map.json')), targets: { ts: target, legacy: target } });
    assert.ok(facade);
    const front = facade.server.address();
    assert.ok(front && typeof front === 'object');
    const observations = [];
    for (const port of [address.port, front.port]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/git/stage`, {
        method: 'POST', headers: { 'content-type': 'text/plain', origin: 'http://untrusted.invalid' },
        body: JSON.stringify({ paths: ['fixture-only.txt'] }), signal: AbortSignal.timeout(5000)
      });
      observations.push({ port, status: response.status, body: await response.json() });
    }
    console.log(JSON.stringify({ pid: process.pid, workspace, observations, capturedExecutions: calls.length, realGitMutation: false }));
    assert.deepEqual({ denied: observations.every(item => item.status >= 400), capturedExecutions: calls.length },
      { denied: true, capturedExecutions: 0 }, 'unpaired request reached a Git mutation executor');
  } finally {
    GitService.prototype.stage = savedStage;
    GitService.prototype.run = savedRun;
    if (facade) await facade.close();
    arch.events.close();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    }
    await arch.logger.flush();
    console.log(JSON.stringify({ cleanup: 'closed', archListening: server?.listening ?? false, facadeListening: facade?.server.listening ?? false }));
  }
});

test('privileged WebSocket subscription requires paired actor; revocation stops delivery', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-ws-'));
  const arch = new ArchServer(workspace, path.join(workspace, 'arch.log'));
  const server = await arch.listen(0);
  const sockets: WebSocket[] = [];
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const owner = await pairFixture(arch, base);
    for (const message of [{ type: 'subscribe', channels: ['log'], approved: true }, { type: 'authenticate', token: 'forged', actor_id: owner.actorId }]) {
      const socket: WebSocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { origin: owner.headers.Origin });
      sockets.push(socket);
      await once(socket, 'open');
      const delivered: unknown[] = [];
      socket.on('message', (data: RawData) => delivered.push(JSON.parse(String(data))));
      const closed: Promise<unknown[]> = once(socket, 'close', { signal: AbortSignal.timeout(5000) });
      socket.send(JSON.stringify(message));
      assert.equal((await closed)[0], 1008);
      assert.deepEqual(delivered, []);
    }
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { origin: owner.headers.Origin });
    sockets.push(socket);
    await once(socket, 'open');
    const authenticated = once(socket, 'message', { signal: AbortSignal.timeout(5000) });
    const token = owner.headers.Authorization.slice(7);
    socket.send(JSON.stringify({ type: 'authenticate', token }));
    assert.deepEqual(JSON.parse(String((await authenticated)[0])), { type: 'authenticated' });
    // Ping/pong is an ordered transport barrier, not a timing sleep.
    socket.send(JSON.stringify({ type: 'subscribe', channels: ['log'] }));
    const subscribed = once(socket, 'pong', { signal: AbortSignal.timeout(5000) });
    socket.ping();
    await subscribed;
    const event = once(socket, 'message', { signal: AbortSignal.timeout(5000) });
    assert.deepEqual(arch.events.publish('log', { level: 'info', message: 'authority-marker' }), { accepted: true });
    assert.equal(JSON.parse(String((await event)[0])).data.message, 'authority-marker');
    const actor = arch.authority.authenticate(token, owner.headers.Origin);
    arch.authority.control.revoke(actor);
    const denied: unknown[] = [];
    socket.on('message', data => denied.push(JSON.parse(String(data))));
    const closed = once(socket, 'close', { signal: AbortSignal.timeout(5000) });
    arch.events.publish('log', { level: 'info', message: 'must-not-deliver' });
    assert.equal((await closed)[0], 1008);
    assert.deepEqual(denied, []);
  } finally {
    for (const socket of sockets) socket.terminate();
    arch.events.close(); server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await arch.logger.flush();
  }
});

test('real HTTP pairing and action-bound approval preserve Git reads and deny forgery/replay', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-http-'));
  const arch = new ArchServer(workspace, path.join(workspace, 'arch.log'));
  const savedStage = GitService.prototype.stage;
  const savedRun = GitService.prototype.run;
  const calls: string[][] = [];
  GitService.prototype.stage = async function (paths: string[]) { calls.push(paths); };
  GitService.prototype.run = async function () { return { stdout: '', stderr: '' }; };
  for (const route of routesForGit(workspace)) arch.route(route);
  const server = await arch.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const owner = await pairFixture(arch, base);
    const other = await pairFixture(arch, base);
    const read = await owner.request('/api/git/status');
    assert.equal(read.status, 200);
    assert.equal((await read.json()).ok, true);
    for (const approved of [true, false, 'false', {}, null]) {
      const result = await owner.request('/api/git/stage', { method: 'POST', body: JSON.stringify({ paths: ['one'], approved }) });
      assert.equal(result.status, 400);
      assert.equal((await result.json()).error.code, 'BAD_REQUEST');
      assert.equal(calls.length, 0);
    }
    const body = { paths: ['one'] };
    const unapproved = await owner.request('/api/git/stage', { method: 'POST', body: JSON.stringify(body) });
    assert.equal(unapproved.status, 409);
    assert.equal((await unapproved.json()).error.detail.reason, 'APPROVAL_REQUIRED');
    assert.equal(calls.length, 0);
    const pending = await owner.propose('POST', '/api/git/stage', body, 'task-one');
    const wrongApprover = await other.decide(pending.operation_id, 'approve');
    assert.equal(wrongApprover.status, 403);
    assert.equal((await owner.decide(pending.operation_id, 'approve')).status, 200);
    const headers = { 'X-AIDE-Operation': pending.operation_id, 'X-AIDE-Task': 'task-one' };
    for (const variant of [
      { client: owner, headers, body: { paths: ['two'] } },
      { client: owner, headers: { ...headers, 'X-AIDE-Task': 'task-two' }, body },
      { client: other, headers, body }
    ]) {
      const response = await variant.client.request('/api/git/stage', { method: 'POST', headers: variant.headers, body: JSON.stringify(variant.body) });
      assert.ok([403, 409].includes(response.status));
      assert.equal(calls.length, 0);
    }
    const responses = await Promise.all([1, 2].map(() => owner.request('/api/git/stage', { method: 'POST', headers, body: JSON.stringify(body) })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    assert.deepEqual(calls, [['one']]);
    const forged = await owner.request('/api/git/stage', { method: 'POST', headers: { Authorization: 'Bearer forged', 'X-AIDE-Actor': owner.actorId, 'X-AIDE-Internal': 'true', ...headers }, body: JSON.stringify(body) });
    assert.equal(forged.status, 403);
    assert.deepEqual(calls, [['one']]);
  } finally {
    GitService.prototype.stage = savedStage;
    GitService.prototype.run = savedRun;
    arch.events.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    arch.authority.control.close();
    await arch.logger.flush();
    console.log(JSON.stringify({ pid: process.pid, workspace, closed: !server.listening, capturedExecutions: calls.length, realGitMutation: false }));
  }
});
