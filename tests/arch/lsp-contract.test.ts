// tests/arch/lsp-contract.test.ts
// Wave 3H: LSP process lifecycle only.
//   POST /api/lsp/start -> capability.execute binding {languageId}
//   POST /api/lsp/stop  -> capability.execute binding {id}
// The document-sync routes (open/change/close/notify/request) remain
// migration-waived and are asserted fail-closed. Real-server document coverage
// is exercised at the service boundary so deferred routes are never treated as
// enrolled.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type http from 'node:http';
import { WebSocket } from 'ws';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes, createLspManager } from '../../node/src/openapi.ts';
import { LspManager } from '../../node/src/services/lsp.ts';
import { lspDiagnosticsToMarkers } from '../../node/src/routes/lsp.ts';
import { pairFixture } from './authority-fixture.ts';
import { LspStartResponse } from '../../common/contracts/lsp.ts';
import { EventEnvelope } from '../../common/contracts/events.ts';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const TSSERVER = path.join(REPO_ROOT, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs');
const BROKEN = 'export const answer: string = 42;\n';
const BROKEN_URI = 'file:///broken.ts';
const FEATURE = 'const obj = { alpha: 1, beta: 2 };\nconst value = obj.\nfunction target(): number { return 1; }\nconst hit = target();\n';
const FEATURE_URI = 'file:///features.ts';

let dir: string;
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let wsUrl: string;
let manager: LspManager;
let owner: Awaited<ReturnType<typeof pairFixture>>;
let canary: ReturnType<typeof spawn>;
let roundtripReady = false;
let roundtripSkipReason = 'capability probe has not run';

interface SpawnCall { cmd: string; args: readonly string[] | undefined; opts: Record<string, unknown> | undefined }
const spawnCalls: SpawnCall[] = [];
const childPids: number[] = [];

const spawnSpy = ((cmd: string, args?: readonly string[], opts?: Record<string, unknown>) => {
  spawnCalls.push({ cmd, args, opts });
  const child = spawn(cmd, (args ?? []) as string[], (opts ?? {}) as never);
  if (typeof child.pid === 'number') childPids.push(child.pid);
  return child;
}) as unknown as typeof spawn;

function makeManager(workspace: string, spawnImpl: typeof spawn, srv: ArchServer): LspManager {
  return new LspManager({
    command: TSSERVER,
    args: ['--stdio'],
    workspace,
    spawnChild: spawnImpl,
    logger: srv.logger,
    onDiagnostics: (uri, diagnostics) => {
      srv.events.publish('diagnostics', { uri, markers: lspDiagnosticsToMarkers(diagnostics) });
    },
    onStatusChange: (languageId, status) => {
      srv.events.publish('lsp-status', { languageId, status });
    }
  });
}

before(async () => {
  assert.ok(existsSync(TSSERVER), 'typescript-language-server must be installed for the real round-trip test');
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-lsp-'));
  await fs.writeFile(path.join(dir, 'broken.ts'), BROKEN, 'utf8');
  server = new ArchServer(dir, path.join(dir, '.aide', 'arch-lsp-test.log'));
  manager = makeManager(dir, spawnSpy, server);
  const routes = await buildRoutes(dir, 'test', { events: server.events, logger: server.logger, lspManager: manager });
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
  wsUrl = `ws://127.0.0.1:${address.port}/ws`;
  owner = await pairFixture(server, base);

  canary = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });

  const probe = createLspManager(REPO_ROOT, dir, {});
  try {
    await probe.start('typescript');
    roundtripReady = true;
    roundtripSkipReason = '';
  } catch (error) {
    roundtripSkipReason = `typescript-language-server cannot run in this environment: ${(error as Error).message}`;
  } finally {
    await probe.stopAll();
  }
});

after(async () => {
  await manager.stopAll();
  canary.kill();
  server.authority.control.close();
  server.events.close();
  await server.logger.flush();
  httpServer.closeAllConnections();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  for (let attempt = 0; attempt < 10; attempt++) {
    try { await fs.rm(dir, { recursive: true, force: true }); return; }
    catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
});

type EnvelopeT<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

async function post<T>(pathName: string, payload: unknown, headers?: Record<string, string>): Promise<{ status: number; body: EnvelopeT<T> }> {
  const response = await owner.request(pathName, {
    method: 'POST',
    ...(headers ? { headers } : {}),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000)
  });
  return { status: response.status, body: (await response.json()) as EnvelopeT<T> };
}

async function get<T>(pathName: string): Promise<{ status: number; body: EnvelopeT<T> }> {
  const response = await owner.request(pathName, { signal: AbortSignal.timeout(30000) });
  return { status: response.status, body: (await response.json()) as EnvelopeT<T> };
}

async function anonymousPost(pathName: string, payload: unknown): Promise<Response> {
  return fetch(`${base}${pathName}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000)
  });
}

async function subscribeWs(channels: string[]): Promise<WebSocket> {
  const token = owner.headers.Authorization.slice(7);
  const socket = new WebSocket(wsUrl, { headers: { Origin: 'http://fixture.local' } });
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ type: 'authenticate', token }));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('websocket auth timeout')), 5000);
    socket.on('message', raw => {
      const msg = JSON.parse(String(raw)) as { type?: string };
      if (msg.type === 'authenticated') { clearTimeout(timer); resolve(); }
    });
  });
  socket.send(JSON.stringify({ type: 'subscribe', channels }));
  await new Promise(resolve => setTimeout(resolve, 150));
  return socket;
}

function waitForDiagnostics(socket: WebSocket, uri: string, timeoutMs: number, predicate: (markers: unknown[]) => boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for diagnostics on ${uri}`)), timeoutMs);
    socket.on('message', raw => {
      const parsed = EventEnvelope.safeParse(JSON.parse(String(raw)));
      if (!parsed.success || parsed.data.channel !== 'diagnostics') return;
      const payload = parsed.data.data as { uri: string; markers: unknown[] };
      if (payload.uri === uri && predicate(payload.markers)) {
        clearTimeout(timer);
        resolve(payload);
      }
    });
  });
}

async function waitForPidGone(pid: number, timeoutMs = 10000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return true; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

test('lsp status lists typescript and javascript as available before any start', async () => {
  const status = await get<{ servers: { languageId: string; status: string }[] }>('/api/lsp/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.ok, true);
  assert.ok(status.body.data?.servers.some(entry => entry.languageId === 'typescript' && entry.status === 'available'));
  assert.ok(status.body.data?.servers.some(entry => entry.languageId === 'javascript'));
});

test('deferred LSP lifecycle routes remain fail-closed for paired actors', async () => {
  const deferred: Array<[string, unknown]> = [
    ['/api/lsp/open', { uri: BROKEN_URI, languageId: 'typescript', text: BROKEN }],
    ['/api/lsp/change', { uri: BROKEN_URI, text: BROKEN, version: 2 }],
    ['/api/lsp/close', { uri: BROKEN_URI }],
    ['/api/lsp/notify', { id: 'typescript', message: { method: 'textDocument/didChange', params: {} } }],
    ['/api/lsp/request', { id: 'typescript', message: { method: 'textDocument/hover', params: {} } }]
  ];
  for (const [routePath, body] of deferred) {
    const result = await post(routePath, body);
    assert.equal(result.status, 403, `${routePath} must stay fail-closed until its own taxonomy decision`);
  }
});

test('lsp start authority: anonymous, unapproved, malformed, changed and unsupported inputs never spawn', async () => {
  const body = { languageId: 'typescript' };
  assert.equal((await anonymousPost('/api/lsp/start', body)).status, 403, 'anonymous rejected');
  assert.equal((await post('/api/lsp/start', body)).status, 409, 'unapproved denied');
  assert.equal((await post('/api/lsp/start', { languageId: '' })).status, 400, 'empty languageId rejected');
  assert.equal((await post('/api/lsp/start', { languageId: 'typescript', cmd: 'evil' })).status, 400, 'no caller process options exist');
  assert.equal(spawnCalls.length, 0, 'no spawn before any approval');

  const approvePython = await owner.approve('POST', '/api/lsp/start', { languageId: 'python' }, 'task:lsp-start-changed');
  assert.equal((await post('/api/lsp/start', body, approvePython)).status, 409, 'changed languageId rejected');
  assert.equal(spawnCalls.length, 0, 'changed identity never reaches spawn');

  const traversalHeaders = await owner.approve('POST', '/api/lsp/start', { languageId: '../../evil' }, 'task:lsp-start-traversal');
  assert.equal((await post('/api/lsp/start', { languageId: '../../evil' }, traversalHeaders)).status, 504, 'unsupported identity fails closed');
  assert.equal(spawnCalls.length, 0, 'unsupported languageId spawns nothing');

  const pythonHeaders = await owner.approve('POST', '/api/lsp/start', { languageId: 'python' }, 'task:lsp-start-python');
  const python = await post('/api/lsp/start', { languageId: 'python' }, pythonHeaders);
  assert.equal(python.status, 504, 'unallowlisted language fails with CHILD_FAILED');
  assert.equal(python.body.error?.code, 'CHILD_FAILED');
  assert.equal(spawnCalls.length, 0, 'allowlist rejection happens before any spawn');
});

test('lsp start: approved exact operation starts only the canonical server', async t => {
  if (!roundtripReady) {
    t.skip(roundtripSkipReason);
    return;
  }
  const body = { languageId: 'typescript' };
  const headers = await owner.approve('POST', '/api/lsp/start', body, 'task:lsp-start');
  const started = await post('/api/lsp/start', body, headers);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const payload = LspStartResponse.safeParse(started.body.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(payload.data.languageId, 'typescript');
  assert.equal(payload.data.status, 'running');

  assert.equal(spawnCalls.length, 1, 'exactly one canonical spawn');
  const call = spawnCalls[0]!;
  assert.equal(call.cmd, process.execPath, 'executable is the node binary, not caller-controlled');
  assert.equal(call.args?.[0], TSSERVER, 'CLI path is the repo-local language server');
  assert.equal(call.args?.[1], '--stdio', 'args are server-derived');
  assert.equal(call.opts?.shell, false, 'no shell interpretation');
  assert.equal(call.opts?.cwd, dir, 'cwd is the workspace');
  assert.equal('env' in (call.opts ?? {}), false, 'no caller environment injection');
  assert.notEqual(call.opts?.detached, true, 'no detached process');
  const pid = childPids[0]!;
  process.kill(pid, 0);

  assert.equal((await post('/api/lsp/start', body, headers)).status, 409, 'consumed start approval cannot replay');
  assert.equal(spawnCalls.length, 1, 'replay spawns nothing');

  const duplicateHeaders = await owner.approve('POST', '/api/lsp/start', body, 'task:lsp-start-dup');
  const duplicate = await post('/api/lsp/start', body, duplicateHeaders);
  assert.equal(duplicate.status, 200, JSON.stringify(duplicate.body));
  assert.equal(spawnCalls.length, 1, 'duplicate start is idempotent and spawns nothing');
});

test('document synchronization stays functional at the service boundary while its routes stay deferred', async t => {
  if (!roundtripReady) {
    t.skip(roundtripSkipReason);
    return;
  }
  const socket = await subscribeWs(['diagnostics']);
  try {
    const diagnostics = waitForDiagnostics(socket, BROKEN_URI, 60000, markers => markers.length > 0);
    await manager.didOpen(BROKEN_URI, 'typescript', BROKEN);
    const payload = (await diagnostics) as { uri: string; markers: { severity: number; message: string; startLineNumber: number }[] };
    assert.equal(payload.uri, BROKEN_URI);
    const error = payload.markers.find(marker => marker.severity === 8);
    assert.ok(error, 'expected an error-severity marker');
    assert.ok(error.message.includes('number'), `expected type mismatch message, got: ${error.message}`);
    assert.equal(error.startLineNumber, 1);

    const cleared = waitForDiagnostics(socket, BROKEN_URI, 60000, markers => (markers as { severity?: number }[]).every(marker => marker.severity !== 8));
    await manager.didChange(BROKEN_URI, 'export const answer: string = "ok";\n', 2);
    const clearedPayload = (await cleared) as { markers: { severity: number }[] };
    assert.ok(clearedPayload.markers.every(marker => marker.severity !== 8), 'error markers must clear after the fix');
    await manager.didClose(BROKEN_URI);
  } finally {
    socket.close();
  }
});

test('enrolled feature reads work against an open document (no document-route enrollment)', async t => {
  if (!roundtripReady) {
    t.skip(roundtripSkipReason);
    return;
  }
  await fs.writeFile(path.join(dir, 'features.ts'), FEATURE, 'utf8');
  await manager.didOpen(FEATURE_URI, 'typescript', FEATURE);

  const completion = await post<{ items: { label: string; kind?: number }[] }>('/api/lsp/completion', { uri: FEATURE_URI, position: { line: 1, character: 18 } });
  assert.equal(completion.status, 200);
  assert.ok(completion.body.data?.items.some(item => item.label === 'alpha'), `expected alpha, got: ${completion.body.data?.items.map(item => item.label).join(', ')}`);
  assert.ok(completion.body.data?.items.some(item => item.label === 'beta'), 'expected beta in completion items');

  const hover = await post<{ contents: string }>('/api/lsp/hover', { uri: FEATURE_URI, position: { line: 1, character: 15 } });
  assert.equal(hover.status, 200);
  assert.ok(hover.body.data?.contents.includes('alpha'), `expected hover to mention alpha, got: ${hover.body.data?.contents}`);

  const definition = await post<{ locations: { uri: string; range: { start: { line: number; character: number } } }[] }>('/api/lsp/definition', { uri: FEATURE_URI, position: { line: 3, character: 14 } });
  assert.equal(definition.status, 200);
  const location = definition.body.data?.locations[0];
  assert.ok(location, 'expected at least one definition location');
  assert.equal(location.uri, FEATURE_URI, 'definition uri must be remapped to the original client uri');
  assert.equal(location.range.start.line, 2, 'target is declared on line 3 (0-based line 2)');

  await manager.didClose(FEATURE_URI);
});

test('lsp stop authority: approved exact operation terminates only the retained child', async t => {
  if (!roundtripReady) {
    t.skip(roundtripSkipReason);
    return;
  }
  const pid = childPids[0]!;
  assert.equal((await anonymousPost('/api/lsp/stop', { id: 'typescript' })).status, 403, 'anonymous rejected');
  assert.equal((await post('/api/lsp/stop', { id: 'typescript' })).status, 409, 'unapproved denied');
  assert.equal((await post('/api/lsp/stop', { id: 'typescript', pid: 1234 })).status, 400, 'no caller PID target exists');

  const changedHeaders = await owner.approve('POST', '/api/lsp/stop', { id: 'javascript' }, 'task:lsp-stop-changed');
  assert.equal((await post('/api/lsp/stop', { id: 'typescript' }, changedHeaders)).status, 409, 'changed id rejected');
  process.kill(pid, 0);

  const stopHeaders = await owner.approve('POST', '/api/lsp/stop', { id: 'typescript' }, 'task:lsp-stop');
  const stopped = await post<{ id: string; status: string }>('/api/lsp/stop', { id: 'typescript' }, stopHeaders);
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
  assert.equal(stopped.body.data?.status, 'stopped');
  assert.equal(await waitForPidGone(pid), true, 'approved stop terminates exactly the retained child');
  assert.equal((await post('/api/lsp/stop', { id: 'typescript' }, stopHeaders)).status, 409, 'consumed stop approval cannot replay');

  const unknownHeaders = await owner.approve('POST', '/api/lsp/stop', { id: 'javascript' }, 'task:lsp-stop-unknown');
  const unknown = await post<{ id: string; status: string }>('/api/lsp/stop', { id: 'javascript' }, unknownHeaders);
  assert.equal(unknown.status, 200, 'unknown/not-running id preserves the stopped no-op contract');
  assert.equal(unknown.body.data?.status, 'stopped');
  assert.equal(canary.exitCode, null, 'unrelated process remains untouched');
});

test('lsp status changes are published on the lsp-status channel', async t => {
  if (!roundtripReady) {
    t.skip(roundtripSkipReason);
    return;
  }
  const socket = await subscribeWs(['lsp-status']);
  try {
    const statuses: { languageId: string; status: string }[] = [];
    socket.on('message', raw => {
      const parsed = EventEnvelope.safeParse(JSON.parse(String(raw)));
      if (!parsed.success || parsed.data.channel !== 'lsp-status') return;
      statuses.push(parsed.data.data as { languageId: string; status: string });
    });

    const started = await manager.start('typescript');
    assert.equal(started, 'running');
    await manager.stop('typescript');

    const startedAt = Date.now();
    const poll = (): Promise<void> => new Promise((resolve, reject) => {
      const check = (): void => {
        const hasRunning = statuses.some(entry => entry.languageId === 'typescript' && entry.status === 'running');
        const hasStopped = statuses.some(entry => entry.languageId === 'typescript' && entry.status === 'stopped');
        if (hasRunning && hasStopped) return resolve();
        if (Date.now() - startedAt > 15000) return reject(new Error(`timed out waiting for lsp-status events, got: ${JSON.stringify(statuses)}`));
        setTimeout(check, 25);
      };
      check();
    });
    await poll();
  } finally {
    socket.close();
  }
});

test('lsp start failure cleans only its owned child and leaves unrelated processes alone', async t => {
  if (!roundtripReady) {
    t.skip(roundtripSkipReason);
    return;
  }
  const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-lsp-b-'));
  const serverB = new ArchServer(dirB, path.join(dirB, 'arch-lsp-b.log'));
  let spawnsB = 0;
  const failingSpawn = ((_cmd: string, _args?: readonly string[], opts?: Record<string, unknown>) => {
    spawnsB += 1;
    return spawn(process.execPath, ['-e', 'process.exit(1)'], {
      cwd: opts?.cwd as string | undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
  }) as unknown as typeof spawn;
  const managerB = makeManager(dirB, failingSpawn, serverB);
  const routesB = await buildRoutes(dirB, 'test', { events: serverB.events, logger: serverB.logger, lspManager: managerB });
  for (const route of routesB) serverB.route(route);
  const httpB = await serverB.listen(0);
  const addressB = httpB.address();
  assert.ok(addressB && typeof addressB === 'object');
  const baseB = `http://127.0.0.1:${addressB.port}`;
  const ownerB = await pairFixture(serverB, baseB);
  try {
    const body = { languageId: 'typescript' };
    const headers = await ownerB.approve('POST', '/api/lsp/start', body, 'task:lsp-start-fail');
    const response = await ownerB.request('/api/lsp/start', {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000)
    });
    assert.equal(response.status, 504, 'server failure surfaces as CHILD_FAILED');
    assert.equal(spawnsB, 1, 'exactly one bounded spawn attempt');
    await managerB.stopAll();
    assert.equal(canary.exitCode, null, 'unrelated process remains untouched');
  } finally {
    httpB.closeAllConnections();
    await new Promise<void>(resolve => httpB.close(() => resolve()));
    serverB.authority.control.close();
    serverB.events.close();
    for (let attempt = 0; attempt < 10; attempt++) {
      try { await fs.rm(dirB, { recursive: true, force: true }); break; }
      catch (error) {
        if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
  }
});

test('lsp diagnostics map 0-based lsp ranges to 1-based monaco markers', () => {
  const markers = lspDiagnosticsToMarkers([
    {
      range: { start: { line: 0, character: 10 }, end: { line: 0, character: 16 } },
      severity: 1,
      message: 'type error'
    },
    {
      range: { start: { line: 2, character: 4 }, end: { line: 4, character: 8 } },
      severity: 2,
      message: 'warning'
    },
    {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      severity: 3,
      message: 'info'
    },
    {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      severity: 4,
      message: 'hint'
    },
    {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: 'no severity defaults to error'
    }
  ]);
  assert.deepEqual(
    markers.map(marker => [marker.severity, marker.startLineNumber, marker.startColumn, marker.endLineNumber, marker.endColumn]),
    [
      [8, 1, 11, 1, 17],
      [4, 3, 5, 5, 9],
      [2, 1, 1, 1, 2],
      [1, 1, 1, 1, 2],
      [8, 1, 1, 1, 2]
    ]
  );
});
