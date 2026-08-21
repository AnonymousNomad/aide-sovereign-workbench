import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { DapManager } from '../../node/src/services/dap.ts';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const run = promisify(execFile);

interface TestAdapter {
  id: string;
  name: string;
  command: string;
  args: string[];
  languages: string[];
}

function fakeAdapter(script: string, id = 'fake'): TestAdapter {
  return { id, name: 'Fake Adapter', command: process.execPath, args: [path.join(repoRoot, 'tests', 'fixtures', script)], languages: ['python'] };
}

function buildManager(workspace: string, adapters: TestAdapter[], opts: { requestTimeoutMs?: number } = {}) {
  const events: Array<{ event: string; body: unknown }> = [];
  const managerOptions: {
    workspace: string;
    adapters: TestAdapter[];
    requestTimeoutMs?: number;
    spawnChild: typeof spawn;
    onEvent: (adapterId: string, event: string, body: unknown) => void;
  } = {
    workspace,
    adapters,
    spawnChild: spawn,
    onEvent: (adapterId, event, body) => {
      if (adapterId === adapters[0]?.id) events.push({ event, body });
    }
  };
  if (opts.requestTimeoutMs !== undefined) managerOptions.requestTimeoutMs = opts.requestTimeoutMs;
  const manager = new DapManager(managerOptions);
  return { manager, events };
}

async function tempWorkspace(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-dap-'));
  return {
    dir,
    cleanup: async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          await fs.rm(dir, { recursive: true, force: true });
          return;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
}

function waitFor(events: Array<{ event: string; body: unknown }>, from: number, predicate: (entry: { event: string; body: unknown }) => boolean, timeoutMs = 90000): Promise<{ event: string; body: unknown }> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const hit = events.slice(from).reverse().find(predicate);
      if (hit) return resolve(hit);
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for dap event'));
      setTimeout(poll, 25);
    };
    poll();
  });
}

test('dap status lists adapters with command availability before any start', async () => {
  const { dir, cleanup } = await tempWorkspace();
  try {
    const { manager } = buildManager(dir, [fakeAdapter('fake-dap-adapter.mjs'), { id: 'missing', name: 'Missing', command: path.join(dir, 'no-such-adapter.exe'), args: [], languages: [] }]);
    const status = manager.status();
    const fake = status.find(entry => entry.id === 'fake');
    const missing = status.find(entry => entry.id === 'missing');
    assert.ok(fake, 'fake adapter must be listed');
    assert.equal(fake.status, 'available');
    assert.equal(missing?.status, 'not_found');
  } finally {
    await cleanup();
  }
});

test('dap start rejects an unallowlisted adapter id', async () => {
  const { dir, cleanup } = await tempWorkspace();
  try {
    const { manager } = buildManager(dir, [fakeAdapter('fake-dap-adapter.mjs')]);
    await assert.rejects(() => manager.start('evil'), /not allowlisted/);
  } finally {
    await cleanup();
  }
});

test('dap start runs the fake adapter and stores capabilities', async () => {
  const { dir, cleanup } = await tempWorkspace();
  const { manager } = buildManager(dir, [fakeAdapter('fake-dap-adapter.mjs')]);
  try {
    const status = await manager.start('fake');
    assert.equal(status, 'running');
    const entry = manager.adapterStatus('fake');
    assert.equal(entry?.status, 'running');
    assert.equal(entry?.capabilities.supportsConfigurationDoneRequest, true);
  } finally {
    await manager.stopAll();
    await cleanup();
  }
});

test('full debug session: breakpoints, launch, stopped, stack, scopes, variables, step, continue, disconnect', async () => {
  const { dir, cleanup } = await tempWorkspace();
  const { manager, events } = buildManager(dir, [fakeAdapter('fake-dap-adapter.mjs')]);
  try {
    const program = path.join(dir, 'app.py');
    await fs.writeFile(program, 'x = 1\ny = 2\nprint(x + y)\n');
    await manager.start('fake');
    const launchWatermark = events.length;

    const breakpoints = await manager.setBreakpoints('fake', 'app.py', [1, 3]);
    assert.deepEqual(breakpoints, [
      { line: 1, verified: true },
      { line: 3, verified: true }
    ]);

    await manager.configure('fake');
    await manager.launch('fake', 'app.py', ['--flag']);
    await waitFor(events, launchWatermark, entry => entry.event === 'initialized');
    const stopped1 = await waitFor(events, launchWatermark, entry => entry.event === 'stopped');
    assert.equal((stopped1.body as { reason?: string }).reason, 'breakpoint');
    const threadId = (stopped1.body as { threadId?: number }).threadId;
    assert.equal(threadId, 1);

    const frames = await manager.stack('fake', threadId!);
    assert.equal(frames[0]?.name, 'main');
    assert.equal(frames[0]?.line, 1);
    assert.equal(frames[0]?.path, program);

    const scopes = await manager.scopes('fake', frames[0]!.id);
    const locals = scopes.find(scope => scope.name === 'Locals');
    assert.ok(locals && locals.variablesReference > 0, 'Locals scope with variablesReference');

    const vars1 = await manager.variables('fake', locals!.variablesReference);
    const engine = vars1.find(variable => variable.name === 'engine');
    assert.ok(engine && engine.variablesReference === 11, 'engine expandable at ref 11');
    const vars2 = await manager.variables('fake', 11);
    const items = vars2.find(variable => variable.name === 'items');
    assert.ok(items && items.variablesReference === 12, 'items expandable at ref 12');
    const vars3 = await manager.variables('fake', 12);
    assert.ok(vars3.some(variable => variable.name === '2' && variable.value === "'Fizz'"), 'nested items[2] = Fizz');

    const stepWatermark = events.length;
    await manager.step('fake', threadId!, 'next');
    const stopped2 = await waitFor(events, stepWatermark, entry => entry.event === 'stopped');
    assert.equal((stopped2.body as { reason?: string }).reason, 'step');
    const frames2 = await manager.stack('fake', threadId!);
    assert.equal(frames2[0]?.line, 2, 'next advanced one statement');

    const continueWatermark = events.length;
    await manager.continue('fake', threadId!);
    const stopped3 = await waitFor(events, continueWatermark, entry => entry.event === 'stopped');
    assert.equal((stopped3.body as { reason?: string }).reason, 'breakpoint');

    const beforeDisconnect = events.length;
    await manager.disconnect('fake');
    const terminated = await waitFor(events, beforeDisconnect, entry => entry.event === 'terminated');
    assert.ok(events.indexOf(terminated) >= beforeDisconnect, 'terminated emitted after disconnect');
    assert.equal(manager.adapterStatus('fake')?.status, 'stopped');
  } finally {
    await manager.stopAll();
    await cleanup();
  }
});

test('dap unverified breakpoint lines are reported as such', async () => {
  const { dir, cleanup } = await tempWorkspace();
  const { manager } = buildManager(dir, [fakeAdapter('fake-dap-adapter.mjs')]);
  try {
    await fs.writeFile(path.join(dir, 'tiny.py'), 'x = 1\n');
    await manager.start('fake');
    const breakpoints = await manager.setBreakpoints('fake', 'tiny.py', [1, 999]);
    assert.equal(breakpoints[0]?.verified, true);
    assert.equal(breakpoints[1]?.verified, false);
    assert.equal(breakpoints[1]?.message, 'line out of range');
  } finally {
    await manager.stopAll();
    await cleanup();
  }
});

test('dap request times out when the adapter never responds', async () => {
  const { dir, cleanup } = await tempWorkspace();
  const { manager } = buildManager(dir, [fakeAdapter('fake-dap-silent-adapter.mjs')], { requestTimeoutMs: 500 });
  try {
    await manager.start('fake');
    await assert.rejects(() => manager.continue('fake', 1), /DAP request timed out: continue/);
  } finally {
    await manager.stopAll();
    await cleanup();
  }
});

test('dap adapter crash marks error and rejects pending requests', async () => {
  const { dir, cleanup } = await tempWorkspace();
  const { manager } = buildManager(dir, [fakeAdapter('fake-dap-crash-adapter.mjs')]);
  try {
    await manager.start('fake');
    const started = Date.now();
    while (manager.adapterStatus('fake')?.status !== 'error' && Date.now() - started < 5000) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(manager.adapterStatus('fake')?.status, 'error');
    await assert.rejects(() => manager.continue('fake', 1), /not running/);
  } finally {
    await manager.stopAll();
    await cleanup();
  }
});

test('dap launch rejects paths escaping the workspace', async () => {
  const { dir, cleanup } = await tempWorkspace();
  const { manager } = buildManager(dir, [fakeAdapter('fake-dap-adapter.mjs')]);
  try {
    await manager.start('fake');
    await assert.rejects(() => manager.launch('fake', '../evil.js', []), /escapes workspace/);
    await assert.rejects(() => manager.launch('fake', path.join(dir, '..', 'evil.js'), []), /escapes workspace/);
  } finally {
    await manager.stopAll();
    await cleanup();
  }
});

async function absolutePythonPath(interp: string): Promise<string | null> {
  return new Promise(resolve => {
    const child = spawn(interp, ['-E', '-c', 'import sys; print(sys.executable)'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', chunk => {
      out += String(chunk);
    });
    child.once('error', () => resolve(null));
    child.once('exit', code => {
      const resolved = out.trim();
      resolve(code === 0 && resolved.length > 0 ? resolved : null);
    });
  });
}

async function resolvePython(): Promise<string | null> {
  const candidates: string[] = [];
  if (process.env.AIDE_PYTHON) candidates.push(process.env.AIDE_PYTHON);
  if (process.platform === 'win32') {
    try {
      const result = await run('py', ['-3.10', '-E', '-c', 'import sys; print(sys.executable)']);
      if (result.stdout.trim()) candidates.push(result.stdout.trim());
    } catch {
      // fall through
    }
  }
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) return candidate;
    const absolute = await absolutePythonPath(candidate);
    if (absolute !== null) return absolute;
  }
  return null;
}

async function pythonHasDebugpy(python: string): Promise<boolean> {
  return new Promise(resolve => {
    const probe = spawn(python, ['-c', 'import debugpy'], { stdio: 'ignore' });
    probe.once('exit', code => resolve(code === 0));
    probe.once('error', () => resolve(false));
  });
}

test('real debugpy adapter round trip on the fizz_engine fixture', async t => {
  const python = await resolvePython();
  if (python === null || !(await pythonHasDebugpy(python))) {
    t.skip('debugpy is not importable by the configured Python (set AIDE_PYTHON or install debugpy)');
    return;
  }
  const { dir, cleanup } = await tempWorkspace();
  const events: Array<{ event: string; body: unknown }> = [];
  const manager = new DapManager({
    workspace: dir,
    adapters: [{ id: 'python-debugpy', name: 'Python debugpy', command: python, args: ['-m', 'debugpy.adapter'], languages: ['python'] }],
    requestTimeoutMs: 60000,
    spawnChild: spawn,
    onEvent: (_id, event, body) => events.push({ event, body })
  });
  try {
    const source = await fs.readFile(path.join(repoRoot, 'fixtures', 'debuggee', 'fizz_engine.py'), 'utf8');
    const program = path.join(dir, 'fizz_engine.py');
    await fs.writeFile(program, source);
    const lines = source.split('\n');
    const lineOf = (marker: string): number => lines.findIndex(line => line.includes(marker)) + 1;
    const first = lineOf('total = sum');
    const second = lineOf('print(report)');
    assert.ok(first > 0 && second > 0, 'fixture markers must resolve');

    await manager.start('python-debugpy');
    const launchWatermark = events.length;
    const launch = manager.launch('python-debugpy', 'fizz_engine.py', [], dir);
    await manager.setBreakpoints('python-debugpy', 'fizz_engine.py', [first, second]);
    await manager.configure('python-debugpy');
    await launch;
    await waitFor(events, launchWatermark, entry => entry.event === 'initialized', 20000);
    const stopped1 = await waitFor(events, launchWatermark, entry => entry.event === 'stopped', 30000);
    assert.equal((stopped1.body as { reason?: string }).reason, 'breakpoint');
    const threadId = (stopped1.body as { threadId?: number }).threadId;
    assert.ok(threadId !== undefined, 'stopped carries threadId');

    const frames = await manager.stack('python-debugpy', threadId!);
    assert.equal(frames[0]?.name, 'main');
    assert.equal(frames[0]?.line, first, `frame at first breakpoint line ${first}`);
    assert.equal(frames[0]?.path, program);

    const scopes = await manager.scopes('python-debugpy', frames[0]!.id);
    const locals = scopes.find(scope => scope.name === 'Locals');
    assert.ok(locals && locals.variablesReference > 0, 'Locals scope');

    const vars1 = await manager.variables('python-debugpy', locals!.variablesReference);
    const engine = vars1.find(variable => variable.name === 'engine');
    assert.ok(engine && engine.variablesReference !== undefined && engine.variablesReference > 0, 'engine expandable');
    const vars2 = await manager.variables('python-debugpy', engine!.variablesReference);
    const items = vars2.find(variable => variable.name.replace(/^'|'$/g, '') === 'items');
    assert.ok(items && items.variablesReference !== undefined && items.variablesReference > 0, 'items expandable');
    const vars3 = await manager.variables('python-debugpy', items!.variablesReference);
    assert.ok(vars3.some(variable => variable.name === '02' && variable.value === "'Fizz'"), 'items[2] = Fizz at depth 3');

    const stepWatermark = events.length;
    await manager.step('python-debugpy', threadId!, 'next');
    const stopped2 = await waitFor(events, stepWatermark, entry => entry.event === 'stopped', 30000);
    assert.equal((stopped2.body as { reason?: string }).reason, 'step');
    const frames2 = await manager.stack('python-debugpy', threadId!);
    assert.equal(frames2[0]?.line, first + 1, 'next advanced one statement');

    const continueWatermark = events.length;
    await manager.continue('python-debugpy', threadId!);
    const stopped3 = await waitFor(events, continueWatermark, entry => entry.event === 'stopped', 30000);
    assert.equal((stopped3.body as { reason?: string }).reason, 'breakpoint');
    const frames3 = await manager.stack('python-debugpy', threadId!);
    assert.equal(frames3[0]?.line, second, `frame at second breakpoint line ${second}`);
    const scopes3 = await manager.scopes('python-debugpy', frames3[0]!.id);
    const locals3 = scopes3.find(scope => scope.name === 'Locals');
    const varsTotal = await manager.variables('python-debugpy', locals3!.variablesReference);
    const total = varsTotal.find(variable => variable.name === 'total');
    assert.equal(total?.value, '43', 'computed total = 43');

    const watermark = events.length;
    await manager.disconnect('python-debugpy');
    await waitFor(events, watermark, entry => entry.event === 'terminated', 20000);
    assert.ok(watermark < events.length, 'terminated event arrived after disconnect');
    assert.equal(manager.adapterStatus('python-debugpy')?.status, 'stopped');
  } finally {
    await manager.stopAll();
    await cleanup();
  }
});
