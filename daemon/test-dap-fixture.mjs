import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DapManager } from './dap-manager.mjs';

const root = path.resolve(process.cwd());
const fixtureDir = path.join(root, 'fixtures', 'debuggee');
const fixture = path.join(fixtureDir, 'fizz_engine.py');
const pidFile = path.join(fixtureDir, 'debuggee.pid');
const evidenceDir = path.join(root, 'docs', 'evidence');

const python = process.env.AIDE_PYTHON || 'python';

const pythonReady = await new Promise(resolve => {
  const probe = spawn(python, ['-c', 'import debugpy'], { stdio: 'ignore' });
  probe.once('exit', code => resolve(code === 0));
  probe.once('error', () => resolve(false));
});
if (!pythonReady) {
  console.log('dap fixture test SKIPPED: debugpy is not importable by the configured Python (set AIDE_PYTHON or install debugpy)');
  process.exit(0);
}

const waitEvent = (manager, id, predicate, { watermark, timeoutMs, label }) => new Promise((resolve, reject) => {
  const started = Date.now();
  const poll = () => {
    const hit = [...(manager.events.get(id) || []).slice(watermark)].reverse().find(predicate);
    if (hit) return resolve(hit);
    if (Date.now() - started > timeoutMs) return reject(new Error(`timed out waiting for ${label}`));
    setTimeout(poll, 50);
  };
  poll();
});

const waitExit = child => new Promise(resolve => {
  if (child.exitCode !== null) return resolve(child.exitCode);
  child.once('exit', code => resolve(code === null ? -1 : code));
});

const results = [];
const record = (name, ok, detail = '') => results.push({ name, ok, detail });

const source = await fs.readFile(fixture, 'utf8');
const lines = source.split('\n');
const lineOf = marker => lines.findIndex(l => l.includes(marker)) + 1;
const L1 = lineOf('total = sum');
const L2 = lineOf('print(report)');
assert.ok(L1 > 0 && L2 > 0, 'fixture markers must resolve to real lines');

await fs.rm(pidFile, { force: true });
await fs.mkdir(evidenceDir, { recursive: true });

const transcript = [];
const manager = new DapManager({
  manifestPath: path.join(root, 'debuggers', 'manifest.json'),
  workspace: root,
  pythonPath: python,
  transcript
});
await manager.load();

const ID = 'python-debugpy';
let child;
let stopThreadId = null;

try {
  await manager.start(ID);
  child = manager.processes.get(ID);
  assert.ok(child, 'adapter child process must exist');

  const initialize = await manager.request(ID, { command: 'initialize', arguments: { adapterID: 'aide', clientID: 'aide', supportsVariablePaging: false, supportsRunInTerminalRequest: false } });
  assert.equal(initialize.success, true, `initialize must succeed: ${initialize.message || ''}`);
  record('initialize', true);

  const launch = manager.request(ID, { command: 'launch', arguments: { request: 'launch', type: 'python', program: fixture, cwd: fixtureDir, console: 'internalConsole' } });
  const launchWatermark = (manager.events.get(ID) || []).length;

  const setBp = await manager.request(ID, { command: 'setBreakpoints', arguments: { source: { name: 'fizz_engine.py', path: fixture }, breakpoints: [{ line: L1 }, { line: L2 }] } });
  assert.equal(setBp.success, true, 'setBreakpoints must succeed');
  assert.equal(setBp.body.breakpoints.length, 2);
  assert.ok(setBp.body.breakpoints.every(bp => bp.verified), 'all breakpoints must be verified against the real source');
  record('setBreakpoints verified', true);

  const setEx = await manager.request(ID, { command: 'setExceptionBreakpoints', arguments: { filters: [] } });
  assert.equal(setEx.success, true, 'setExceptionBreakpoints must succeed');
  record('setExceptionBreakpoints', true);

  const done = await manager.request(ID, { command: 'configurationDone', arguments: {} });
  assert.equal(done.success, true, 'configurationDone must succeed');
  record('configurationDone', true);

  const launchResponse = await launch;
  assert.equal(launchResponse.success, true, `launch must succeed (debugpy defers its response to configurationDone): ${launchResponse.message || JSON.stringify(launchResponse.body)}`);
  record('launch', true);
  await waitEvent(manager, ID, e => e.event === 'initialized', { watermark: launchWatermark, timeoutMs: 20000, label: 'initialized event (debugpy sends it after launch)' });

  const stop1 = await waitEvent(manager, ID, e => e.event === 'stopped', { watermark: launchWatermark, timeoutMs: 30000, label: 'breakpoint stop' });
  assert.equal(stop1.body.reason, 'breakpoint', `first stop reason must be breakpoint (got ${stop1.body.reason})`);
  stopThreadId = stop1.body.threadId;
  assert.ok(stopThreadId !== undefined, 'stopped event must carry a threadId');
  record('stopped (breakpoint) at line ' + L1, true);

  const threads = await manager.request(ID, { command: 'threads', arguments: {} });
  assert.equal(threads.success, true);
  assert.ok(threads.body.threads.some(t => t.id === stopThreadId), 'threads must include the stopped threadId');
  record('threads', true);

  const stack = await manager.request(ID, { command: 'stackTrace', arguments: { threadId: stopThreadId, startFrame: 0, levels: 10 } });
  assert.equal(stack.success, true);
  const frame = stack.body.stackFrames[0];
  assert.equal(frame.line, L1, `frame must be at the first breakpoint line (got ${frame.line})`);
  assert.equal(frame.name, 'main', `frame name must be main (got ${frame.name})`);
  record('stackTrace frame main@' + L1, true);

  const scopes = await manager.request(ID, { command: 'scopes', arguments: { frameId: frame.id } });
  assert.equal(scopes.success, true);
  const locals = scopes.body.scopes.find(s => s.name === 'Locals');
  assert.ok(locals && locals.variablesReference > 0, 'Locals scope with a variablesReference must exist');
  record('scopes Locals', true);

  const vars1 = await manager.request(ID, { command: 'variables', arguments: { variablesReference: locals.variablesReference } });
  assert.equal(vars1.success, true);
  const engine = vars1.body.variables.find(v => v.name === 'engine');
  assert.ok(engine && engine.variablesReference > 0, 'local engine dict must be expandable');
  record('variables engine (depth 1)', true);

  const vars2 = await manager.request(ID, { command: 'variables', arguments: { variablesReference: engine.variablesReference } });
  const items = vars2.body.variables.find(v => v.name.replace(/^'|'$/g, '') === 'items');
  assert.ok(items && items.variablesReference > 0, 'engine.items list must be expandable');
  const vars3 = await manager.request(ID, { command: 'variables', arguments: { variablesReference: items.variablesReference } });
  const fizz = vars3.body.variables.find(v => v.name === '02' && v.value === "'Fizz'");
  assert.ok(fizz, 'nested items[2] must be Fizz (3 levels of variablesReference)');
  record('nested variables depth 3 (items[2] = Fizz)', true);

  const next = await manager.request(ID, { command: 'next', arguments: { threadId: stopThreadId } });
  assert.equal(next.success, true);
  const nextWatermark = (manager.events.get(ID) || []).length;
  const stop2 = await waitEvent(manager, ID, e => e.event === 'stopped', { watermark: nextWatermark, timeoutMs: 30000, label: 'step stop' });
  assert.equal(stop2.body.reason, 'step', `step stop reason must be step (got ${stop2.body.reason})`);
  assert.equal(stop2.body.threadId, stopThreadId, 'threadId must stay stable across stops');
  const stack2 = await manager.request(ID, { command: 'stackTrace', arguments: { threadId: stopThreadId, startFrame: 0, levels: 5 } });
  assert.equal(stack2.body.stackFrames[0].line, L1 + 1, `next must advance exactly one statement (got ${stack2.body.stackFrames[0].line})`);
  record('next step advanced to line ' + (L1 + 1), true);

  const cont = await manager.request(ID, { command: 'continue', arguments: { threadId: stopThreadId } });
  assert.equal(cont.success, true);
  const continueWatermark = (manager.events.get(ID) || []).length;
  const stop3 = await waitEvent(manager, ID, e => e.event === 'stopped', { watermark: continueWatermark, timeoutMs: 30000, label: 'second breakpoint stop' });
  assert.equal(stop3.body.reason, 'breakpoint', `second stop reason must be breakpoint (got ${stop3.body.reason})`);
  assert.equal(stop3.body.threadId, stopThreadId, 'threadId must stay stable');
  const stack3 = await manager.request(ID, { command: 'stackTrace', arguments: { threadId: stopThreadId, startFrame: 0, levels: 5 } });
  assert.equal(stack3.body.stackFrames[0].line, L2, `frame must be at the second breakpoint line (got ${stack3.body.stackFrames[0].line})`);
  const scopes3 = await manager.request(ID, { command: 'scopes', arguments: { frameId: stack3.body.stackFrames[0].id } });
  const locals3 = scopes3.body.scopes.find(s => s.name === 'Locals');
  const varsReport = await manager.request(ID, { command: 'variables', arguments: { variablesReference: locals3.variablesReference } });
  const total = varsReport.body.variables.find(v => v.name === 'total');
  assert.ok(total && total.value === '43', `computed total must be 43 (got ${total ? total.value : 'missing'})`);
  record('second breakpoint + computed variable total=43', true);

  const termWatermark = (manager.events.get(ID) || []).length;
  const term = await manager.request(ID, { command: 'terminate', arguments: {} });
  record('terminate request', term.success, term.message || '');
  const disc = await manager.request(ID, { command: 'disconnect', arguments: { terminateDebuggee: true } });
  assert.equal(disc.success, true, 'disconnect must succeed');
  await waitEvent(manager, ID, e => e.event === 'terminated', { watermark: termWatermark, timeoutMs: 20000, label: 'terminated event' });
  record('terminated event', true);

  child.stdin.end();
  const exitCode = await Promise.race([waitExit(child), new Promise(resolve => setTimeout(() => resolve(-2), 15000))]);
  assert.equal(exitCode, 0, `adapter must exit cleanly with code 0 (got ${exitCode})`);
  record('adapter clean exit (code 0)', true);

  let orphanFree = true;
  let orphanDetail = 'no pid file (debuggee likely did not run to completion)';
  try {
    const rawPid = await fs.readFile(pidFile, 'utf8');
    const debuggeePid = Number(rawPid.trim());
    if (Number.isFinite(debuggeePid) && debuggeePid > 0) {
      const task = spawn('tasklist', ['/FI', `PID eq ${debuggeePid}`, '/NH'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const out = await new Promise(resolve => {
        let acc = '';
        task.stdout.on('data', chunk => { acc += chunk; });
        task.once('exit', () => resolve(acc));
      });
      orphanFree = !out.toLowerCase().includes('python');
      orphanDetail = orphanFree ? 'no orphaned debuggee process' : `orphaned debuggee PID ${debuggeePid} still alive`;
    } else {
      orphanFree = false;
      orphanDetail = 'pid file did not contain a valid PID';
    }
  } catch (error) {
    orphanFree = false;
    orphanDetail = `pid file check failed: ${error.message}`;
  }
  assert.ok(orphanFree, orphanDetail);
  record('no orphaned debuggee process', true, orphanDetail);
} finally {
  await manager.stop(ID);
  await fs.rm(pidFile, { force: true });
}

const transcriptFile = path.join(evidenceDir, 'dap-wire-sequence.json');
await fs.writeFile(transcriptFile, JSON.stringify({
  generated: new Date().toISOString(),
  tool: 'aide-sovereign-workbench dap fixture test',
  python: python,
  fixture: 'fixtures/debuggee/fizz_engine.py',
  breakpoint_lines: { first: L1, second: L2 },
  assertions: results,
  transcript
}, null, 2));

const failed = results.filter(r => !r.ok);
console.log(`dap fixture test ${failed.length ? 'FAILED' : 'passed'} (${results.length - failed.length}/${results.length} assertions; wire sequence at ${path.relative(root, transcriptFile)})`);
for (const r of results) console.log(`  ${r.ok ? 'OK' : 'FAIL'}  ${r.name}${r.detail && r.ok ? ` (${r.detail})` : ''}`);
if (failed.length) process.exitCode = 1;