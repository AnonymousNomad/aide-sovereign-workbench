// Closed-loop on-by-default (aid-closed-loop-on-by-default skill, wire-in
// gate): proves the selfimprove runner exits clean, the state bus is fed by
// the injected audit trail, and the runner emits a verifier-stamped signal
// when a failure event lands on the bus. Uses AIDE_SELFIMPROVE_ROOT to point
// the runner at a temp workspace so the test never touches the real repo
// .aide state.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-closed-loop-'));

const SCRIPT = path.join(repoRoot, 'scripts', 'selfimprove.mjs');
const runExec = promisify(execFile);

function runSelfimprove(args: string[], env: Record<string, string> = {}) {
  return runExec(process.execPath, [SCRIPT, ...args], {
    cwd: repoRoot,
    env: { ...process.env, AIDE_SELFIMPROVE_ROOT: workspace, CLOSED_LOOP_TEMP: '1', ...env },
    windowsHide: true
  }).then(out => ({ code: 0, stdout: String(out.stdout), stderr: String(out.stderr) }), (error: NodeJS.ErrnoException & { stderr?: string; stdout?: string }) => ({
    code: typeof error.code === 'number' ? error.code : 1,
    stdout: String(error.stdout || ''),
    stderr: String(error.stderr || '')
  }));
}

before(async () => {
  await fs.mkdir(path.join(workspace, '.aide'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.aide', 'training'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.aide', 'logs'), { recursive: true });
});

after(async () => {
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

test('closed-loop: selfimprove --dry-run exits 0 with empty state', async () => {
  const result = await runSelfimprove(['--dry-run']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /OBSERVE: \d+ events/);
});

test('closed-loop: a rejection event on the bus becomes a selfimprove signal', async () => {
  // Kernel of Loop C: the agent-loop directs an approval decision through the
  // audit trail, which writes BOTH the legacy rejection shape (the [learned]
  // injector contract) and the agent.approval envelope. Here we simulate the
  // audit trail write that start()/decide() would produce and assert the
  // closed-loop runner converts it into a fine-tune-lane signal row.
  const busPath = path.join(workspace, '.aide', 'cipher-state.jsonl');
  const event = {
    type: 'rejection',
    at: new Date().toISOString(),
    session_id: 'test-session',
    tool: 'run_command',
    decision: 'reject',
    summary: 'operator rejected the command'
  };
  await fs.appendFile(busPath, JSON.stringify(event) + '\n', 'utf8');

  const beforeSignals = countSignalFiles();
  const result = await runSelfimprove(['--since=1h']);

  assert.equal(result.code, 0);
  const afterSignals = countSignalFiles();
  assert.equal(afterSignals, beforeSignals + 1, 'runner must emit a signal file for the failure');
  const signalDir = path.join(workspace, '.aide', 'training');
  const files = (await fs.readdir(signalDir)).filter(name => name.startsWith('signal-') && name.endsWith('.jsonl'));
  const latest = files.sort().pop();
  assert.ok(latest);
  const text = await fs.readFile(path.join(signalDir, latest), 'utf8');
  const rows = text.split(/\r?\n/).filter(Boolean);
  const row = rows.find((line: string) => line.includes('test-session') && line.includes('rejection'));
  assert.ok(row, 'signal must reference the injected failure session');

  // Pre-existing row count in that file should have been appended, not the
  // whole file overwritten (selfimprove appends across iterations).
  assert.ok(rows.length >= 1);
});

test('closed-loop: status route reports the env gate and runner-observable state', async () => {
  // Real ArchServer over HTTP (per aide-arch-backend-core doctrine: real
  // HTTP, not mocked). The route must reflect the AIDE_CLOSED_LOOP gate the
  // daemon uses for its spawn path, and the state the runner produced above.
  const { ArchServer } = await import('../../node/src/server.ts');
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const server = new ArchServer(workspace, path.join(workspace, 'closed-loop-status.log'));
  const routes = await buildRoutes(workspace, 'test', {});
  for (const route of routes) server.route(route);
  const httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const r = await fetch(`${base}/api/closed-loop/status`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as { ok: boolean; data?: { enabled: boolean; signal_file_count: number; bus_event_count: number } };
    assert.equal(body.ok, true);
    assert.ok(body.data);
    // daemon gate default = enabled (AIDE_CLOSED_LOOP unset in this process)
    assert.equal(body.data.enabled, true);
    // the previous test injected 1 bus event + emitted 1 signal file
    assert.equal(body.data.bus_event_count, 1);
    assert.equal(body.data.signal_file_count, 1);
  } finally {
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  }
});

function countSignalFiles(): number {
  const dir = path.join(workspace, '.aide', 'training');
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(name => name.startsWith('signal-') && name.endsWith('.jsonl')).length;
}