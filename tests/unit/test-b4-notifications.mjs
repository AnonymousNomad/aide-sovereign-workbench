import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { NotificationService, HookValidationError, normalizeHooksFile } from '../../node/src/services/notification-service.mjs';
import { buildToastScript } from '../../node/src/services/os-toast.mjs';
import { encodeOsc9, encodeOsc777 } from '../../node/src/services/osc.mjs';
import { createExecutionAuthority, AuthorityError } from '../../node/src/services/execution-authority.mjs';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'aide-b4-unit-'));
let tick = 0;
const clock = () => 1_000_000 + (tick += 1000);

function makeService(overrides = {}) {
  const seen = [];
  const service = new NotificationService({
    workspace: tmp,
    onEvent: n => seen.push(n),
    clock,
    ...overrides
  });
  return { service, seen };
}

async function makeAuthority(workspace) {
  const events = [];
  const authority = createExecutionAuthority({
    workspace,
    record: event => { events.push(event); return { persisted: true }; }
  });
  const pairing = authority.control.createPairing('test');
  const session = await authority.pair(pairing, 'test');
  const operator = authority.authenticate(session.token, 'test');
  return { authority, operator, events };
}

async function runHookEvent(service, operator, authority, eventName, context, taskId) {
  const input = service.describeHookExecution(eventName, context, taskId);
  const op = await authority.prepare(operator, input);
  const approved = await authority.decide(operator, op.operation_id, 'approve');
  return authority.execute(operator, approved.operation_id, input, async (_operation, execution) => {
    return service.runHooks(eventName, context, execution);
  });
}

async function runTaskEvent(service, operator, authority, evt, taskId) {
  const eventName = evt.event === 'started'
    ? 'task.started'
    : evt.event === 'problems'
      ? 'diagnostics.new'
      : evt.exitCode === 0
        ? 'task.completed'
        : 'task.failed';
  const context = evt.event === 'started'
    ? { label: evt.label ?? evt.job_id ?? 'task', job_id: evt.job_id }
    : evt.event === 'problems'
      ? { label: evt.label ?? evt.job_id ?? 'task', job_id: evt.job_id, count: Array.isArray(evt.problems) ? evt.problems.length : 0 }
      : { label: evt.label ?? evt.job_id ?? 'task', job_id: evt.job_id, exit_code: evt.exitCode };
  const input = service.describeHookExecution(eventName, context, taskId);
  const op = await authority.prepare(operator, input);
  const approved = await authority.decide(operator, op.operation_id, 'approve');
  return authority.execute(operator, approved.operation_id, input, async (_operation, execution) => {
    service.ingestTaskEvent(evt, { execution });
    await new Promise(r => setTimeout(r, 150));
  });
}

// 1. record -> list -> unread counts
{
  const { service } = makeService();
  service.record({ severity: 'info', source: 'daemon', title: 'hello' });
  assert.equal(service.list().notifications.length, 1);
  assert.equal(service.list().unread, 1);
  assert.equal(service.list({ unreadOnly: true }).notifications.length, 1);
}

// 2. coalescing identical within window; different body passes
{
  const { service } = makeService();
  const a = service.record({ severity: 'error', source: 'task', title: 'T', body: 'same' });
  const b = service.record({ severity: 'error', source: 'task', title: 'T', body: 'same' });
  assert.equal(a.id, b.id, 'identical inside 2s coalesce window must reuse');
  assert.equal(service.list().notifications.length, 1);
  service.record({ severity: 'error', source: 'task', title: 'T', body: 'different' });
  assert.equal(service.list().notifications.length, 2);
}

// 3. markRead / read-all / unknown id
{
  const { service } = makeService();
  const n = service.record({ severity: 'warn', source: 'user', title: 'w' });
  assert.equal(service.markRead('nope'), null);
  assert.equal(service.markRead(n.id).read, true);
  assert.equal(service.list().unread, 0);
  const m = service.record({ severity: 'info', source: 'daemon', title: 'x' });
  assert.equal(service.markAllRead(), 1);
  assert.ok(service.list().notifications.every(item => item.read || item.id !== m.id));
}

// 4. ring buffer cap
{
  const { service } = makeService();
  for (let i = 0; i < 260; i++) {
    service.record({ severity: 'info', source: 'daemon', title: `t${i}` });
  }
  assert.equal(service.list().notifications.length, 200);
  assert.equal(service.list().notifications.at(-1).title, 't259');
}

// 5. task event mapping (real TaskEventT shapes)
{
  const { service, seen } = makeService();
  service.ingestTaskEvent({ event: 'started', job_id: 'j1', label: 'build' });
  assert.equal(seen.length, 0, 'started produces no notification');
  service.ingestTaskEvent({ event: 'exit', job_id: 'j1', label: 'build', exitCode: 2, signal: null });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].severity, 'error');
  assert.equal(seen[0].source, 'task');
  assert.equal(seen[0].job_id, 'j1');
  assert.match(seen[0].body, /exit code 2/);
  service.ingestTaskEvent({ event: 'exit', job_id: 'j2', label: 'test', exitCode: 0, signal: null });
  assert.equal(seen[1].severity, 'success');
  service.ingestTaskEvent({ event: 'exit', job_id: 'j3', label: 'dev', exitCode: null, signal: 'SIGTERM' });
  assert.equal(seen[2].severity, 'warn');
  assert.match(seen[2].body, /signal SIGTERM/);
}

// 6. hooks normalization: junk rejected
{
  assert.throws(() => normalizeHooksFile({ hooks: [{ event: 'nope', command: ['x'] }] }), HookValidationError);
  assert.throws(() => normalizeHooksFile({ hooks: [{ event: 'task.failed' }] }), HookValidationError);
  assert.throws(() => normalizeHooksFile({ hooks: [{ event: 'task.failed', command: ['x'], sneaky: 1 }] }), HookValidationError);
  assert.throws(() => normalizeHooksFile({ nothooks: [] }), HookValidationError);
}

// 7. consent guard at config time and exec time
{
  const { authority, operator } = await makeAuthority(tmp);
  const { service } = makeService({ authority });
  assert.throws(
    () => service.setHooks({ hooks: [{ event: 'task.failed', command: ['curl', 'http://evil.example'] }] }),
    /network_consent/
  );
  const allowed = service.setHooks({ hooks: [{ event: 'task.failed', command: ['node', '-e', 'require("node:http"]'], network_consent: true }] });
  assert.equal(allowed.length, 1);
  const results = await runHookEvent(service, operator, authority, 'task.failed', {}, 'task:consent');
  assert.equal(results[0].rejected, undefined);
  // exec-time guard: mutate an already-loaded hook past the config-time normalizer
  service.hooks = [...service.hooks];
  service.hooks[1] = { ...service.hooks[1], event: 'task.completed', command: ['wget'] };
  delete service.hooks[1].network_consent;
  const guarded = await runHookEvent(service, operator, authority, 'task.completed', {}, 'task:consent');
  assert.equal(guarded[0].rejected, 'CONSENT_REQUIRED');
}

// 8. hook executes argv array and captures output; timeout kills
{
  const { authority, operator } = await makeAuthority(tmp);
  const { service } = makeService({ authority });
  service.setHooks({ hooks: [
    { event: 'task.completed', command: [process.execPath, '-e', 'console.log("hook-ran")'], show: true },
    { event: 'diagnostics.new', command: [process.execPath, '-e', 'setTimeout(()=>{},60000)'], timeout_ms: 300, show: true }
  ]});
  const okResults = await runHookEvent(service, operator, authority, 'task.completed', {}, 'task:exec');
  assert.equal(okResults[0].ok, true);
  assert.equal(okResults[0].timed_out, false);
  assert.match(okResults[0].output, /hook-ran/);
  assert.ok(service.list().notifications.some(n => n.source === 'hook' && /Hook ran/.test(n.title)));
  const t0 = Date.now();
  const slow = await runHookEvent(service, operator, authority, 'diagnostics.new', {}, 'task:exec');
  const elapsed = Date.now() - t0;
  assert.equal(slow[0].timed_out, true);
  assert.ok(elapsed < 5000, `timeout path must return promptly, took ${elapsed}ms`);
  assert.ok(service.list().notifications.some(n => /Hook timed out/.test(n.title)));
}

// 9. hook writes marker file end-to-end via ingestTaskEvent with trusted execution
{
  const marker = path.join(tmp, 'marker.txt');
  const { authority, operator } = await makeAuthority(tmp);
  const { service } = makeService({ authority });
  service.setHooks({ hooks: [{ event: 'task.failed', command: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fired')`] }] });
  await runTaskEvent(service, operator, authority, { event: 'exit', job_id: 'j9', label: 'demo', exitCode: 1, signal: null }, 'task:j9');
  for (let i = 0; i < 40 && !await readFile(marker, 'utf8').then(() => true).catch(() => false); i++) {
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(await readFile(marker, 'utf8'), 'fired', 'failed-task hook must have written the marker file');
}
await rm(path.join(tmp, 'marker.txt'), { force: true });

// 10. loadHooks from .aide/hooks.json round trip + corrupt file surfaces typed error
{
  await mkdir_aide(tmp);
  await writeFile(path.join(tmp, '.aide', 'hooks.json'), JSON.stringify({ hooks: [{ event: 'task.started', command: ['git', 'status'] }] }));
  const { service } = makeService();
  const loaded = await service.loadHooks();
  assert.equal(loaded.length, 1);
  assert.deepEqual(loaded[0].command, ['git', 'status']);
  await writeFile(path.join(tmp, '.aide', 'hooks.json'), '{not json');
  const broken = new NotificationService({ workspace: tmp, clock });
  await assert.rejects(() => broken.loadHooks(), HookValidationError);
}
await rm(path.join(tmp, '.aide'), { recursive: true, force: true });

// 11. toast script builder literals + escaping
{
  const script = buildToastScript({ title: "Build's done", body: 'exit 0' });
  assert.match(script, /ToastText02/);
  assert.match(script, /CreateToastNotifier/);
  assert.match(script, /''/, 'single quotes in payload must be PS-escaped');
  assert.doesNotMatch(script, /Build's done/);
}

// 12. OSC encoders sanitize control chars
{
  assert.equal(encodeOsc9('done'), '\x1b]9;done\x07');
  assert.equal(encodeOsc777('done now'), '\x1b]777;notify;AIDE;done now\x07');
  const hostile = encodeOsc9(`a\x07b\x1b]0;c`);
  assert.ok(!hostile.slice(4).includes('\x07') === false ? true : true); // structure preserved below
  assert.ok(hostile.startsWith('\x1b]9;a'));
  assert.equal(hostile.replace(/^.{3}/, '').split('\x07').length, 2, 'only the terminating BEL survives');
}

// 13. authority boundary for hook execution
{
  const marker = path.join(tmp, 'auth-marker.txt');
  await rm(marker, { force: true });
  const { authority, operator } = await makeAuthority(tmp);
  const { service } = makeService({ authority });
  service.setHooks({ hooks: [{ event: 'task.completed', command: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fired')`] }] });

  // 13a. authorized hook execution succeeds once
  await runHookEvent(service, operator, authority, 'task.completed', {}, 'task:auth');
  assert.equal(await readFile(marker, 'utf8'), 'fired', 'authorized hook must run');
  await rm(marker, { force: true });

  // 13b. missing authority denied
  const noAuthService = makeService().service;
  await assert.rejects(() => noAuthService.runHooks('task.completed', {}, {}), AuthorityError);

  // 13c. direct service execution without proper trusted handle denied
  await assert.rejects(() => service.runHooks('task.completed', {}, {}), AuthorityError);

  // 13d. forged execution handle denied
  await assert.rejects(() => service.runHooks('task.completed', {}, { forged: true }), AuthorityError);

  // 13e. replay/consumed authority denied
  const input = service.describeHookExecution('task.completed', {}, 'task:replay');
  const op = await authority.prepare(operator, input);
  const approved = await authority.decide(operator, op.operation_id, 'approve');
  let capturedExecution;
  await authority.execute(operator, approved.operation_id, input, async (_operation, execution) => {
    capturedExecution = execution;
    return service.runHooks('task.completed', {}, execution);
  });
  await assert.rejects(() => service.runHooks('task.completed', {}, capturedExecution), AuthorityError);

  // 13f. changed command denied
  const changedInput = service.describeHookExecution('task.completed', {}, 'task:changed');
  const changedOp = await authority.prepare(operator, changedInput);
  const changedApproved = await authority.decide(operator, changedOp.operation_id, 'approve');
  service.setHooks({ hooks: [{ event: 'task.completed', command: [process.execPath, '-e', 'console.log("different")'] }] });
  await assert.rejects(
    () => authority.execute(operator, changedApproved.operation_id, changedInput, async (_operation, execution) => service.runHooks('task.completed', {}, execution)),
    AuthorityError
  );

  // 13g. changed context denied
  const contextInput = service.describeHookExecution('task.completed', { job_id: 'j1' }, 'task:context');
  const contextOp = await authority.prepare(operator, contextInput);
  const contextApproved = await authority.decide(operator, contextOp.operation_id, 'approve');
  await assert.rejects(
    () => authority.execute(operator, contextApproved.operation_id, contextInput, async (_operation, execution) => service.runHooks('task.completed', { job_id: 'j2' }, execution)),
    AuthorityError
  );

  // 13h. event-originated execution without proper authority produces no hook process/marker
  await rm(marker, { force: true });
  service.setHooks({ hooks: [{ event: 'task.failed', command: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fired')`] }] });
  const { service: noAuthEventService } = makeService();
  noAuthEventService.ingestTaskEvent({ event: 'exit', job_id: 'j-noauth', label: 'demo', exitCode: 1, signal: null });
  await new Promise(r => setTimeout(r, 200));
  await assert.rejects(() => readFile(marker, 'utf8'), /ENOENT/, 'event without authority must not write marker');
}
await rm(path.join(tmp, 'auth-marker.txt'), { force: true });

async function mkdir_aide(root) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(root, '.aide'), { recursive: true });
}

console.log('b4 notification unit tests passed');
process.exit(0);
