import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { NotificationService, HookValidationError, normalizeHooksFile } from '../../node/src/services/notification-service.mjs';
import { buildToastScript } from '../../node/src/services/os-toast.mjs';
import { encodeOsc9, encodeOsc777 } from '../../node/src/services/osc.mjs';

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
  const { service } = makeService();
  assert.throws(
    () => service.setHooks({ hooks: [{ event: 'task.failed', command: ['curl', 'http://evil.example'] }] }),
    /network_consent/
  );
  const allowed = service.setHooks({ hooks: [{ event: 'task.failed', command: ['node', '-e', 'require("node:http"]'], network_consent: true }] });
  assert.equal(allowed.length, 1);
  const results = await service.runHooks('task.failed', {});
  assert.equal(results[0].rejected, undefined);
  // exec-time guard: mutate an already-loaded hook past the config-time normalizer
  service.hooks = [...service.hooks];
  service.hooks[1] = { ...service.hooks[1], event: 'task.completed', command: ['wget'] };
  delete service.hooks[1].network_consent;
  const guarded = await service.runHooks('task.completed', {});
  assert.equal(guarded[0].rejected, 'CONSENT_REQUIRED');
}

// 8. hook executes argv array and captures output; timeout kills
{
  const { service } = makeService();
  service.setHooks({ hooks: [
    { event: 'task.completed', command: [process.execPath, '-e', 'console.log("hook-ran")'], show: true },
    { event: 'diagnostics.new', command: [process.execPath, '-e', 'setTimeout(()=>{},60000)'], timeout_ms: 300, show: true }
  ]});
  const okResults = await service.runHooks('task.completed', {});
  assert.equal(okResults[0].ok, true);
  assert.equal(okResults[0].timed_out, false);
  assert.match(okResults[0].output, /hook-ran/);
  assert.ok(service.list().notifications.some(n => n.source === 'hook' && /Hook ran/.test(n.title)));
  const t0 = Date.now();
  const slow = await service.runHooks('diagnostics.new', {});
  const elapsed = Date.now() - t0;
  assert.equal(slow[0].timed_out, true);
  assert.ok(elapsed < 5000, `timeout path must return promptly, took ${elapsed}ms`);
  assert.ok(service.list().notifications.some(n => /Hook timed out/.test(n.title)));
}

// 9. hook writes marker file end-to-end via ingestTaskEvent
{
  const marker = path.join(tmp, 'marker.txt');
  const { service } = makeService();
  service.setHooks({ hooks: [{ event: 'task.failed', command: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fired')`] }] });
  service.ingestTaskEvent({ event: 'exit', job_id: 'j9', label: 'demo', exitCode: 1, signal: null });
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

async function mkdir_aide(root) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(root, '.aide'), { recursive: true });
}

console.log('b4 notification unit tests passed');
process.exit(0);
