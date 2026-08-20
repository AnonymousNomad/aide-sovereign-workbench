import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type http from 'node:http';
import { WebSocket } from 'ws';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes, createLspManager } from '../../node/src/openapi.ts';
import { LspManager } from '../../node/src/services/lsp.ts';
import { lspDiagnosticsToMarkers } from '../../node/src/routes/lsp.ts';
import { Envelope } from '../../common/errors.ts';
import { LspStartResponse } from '../../common/contracts/lsp.ts';
import { EventEnvelope } from '../../common/contracts/events.ts';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const TSSERVER = path.join(REPO_ROOT, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs');
const BROKEN = 'export const answer: string = 42;\n';
const BROKEN_URI = 'file:///broken.ts';

let dir: string;
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let wsUrl: string;
let manager: LspManager;

function fileExists(p: string): boolean {
  return existsSync(p);
}

before(async () => {
  assert.ok(fileExists(TSSERVER), 'typescript-language-server must be installed for the real round-trip test');
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-lsp-'));
  await fs.writeFile(path.join(dir, 'broken.ts'), BROKEN, 'utf8');
  server = new ArchServer(dir, path.join(dir, '.aide', 'arch-lsp-test.log'));
  manager = createLspManager(REPO_ROOT, dir, { events: server.events, logger: server.logger });
  const routes = await buildRoutes(dir, 'test', { events: server.events, logger: server.logger, lspManager: manager });
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
  wsUrl = `ws://127.0.0.1:${address.port}/ws`;
});

after(async () => {
  await manager.stopAll();
  server.events.close();
  await server.logger.flush();
  httpServer.closeAllConnections();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

test('lsp status lists typescript and javascript as available before any start', async () => {
  const response = await fetch(`${base}/api/lsp/status`);
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = envelope.data.data as { servers: { languageId: string; status: string }[] };
  assert.ok(payload.servers.some(entry => entry.languageId === 'typescript' && entry.status === 'available'));
  assert.ok(payload.servers.some(entry => entry.languageId === 'javascript'));
});

test('lsp start rejects an unallowlisted language with CHILD_FAILED', async () => {
  const response = await fetch(`${base}/api/lsp/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ languageId: 'python' })
  });
  assert.equal(response.status, 504);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'CHILD_FAILED');
});

test('lsp start runs the real typescript server and reports running', async () => {
  const response = await fetch(`${base}/api/lsp/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ languageId: 'typescript' })
  });
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = LspStartResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(payload.data.languageId, 'typescript');
  assert.equal(payload.data.status, 'running');
});

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

test('opening a broken ts file publishes an error diagnostic over the ws diagnostics channel', async () => {
  const socket = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'subscribe', channels: ['diagnostics'] }));

  const diagnostics = waitForDiagnostics(socket, BROKEN_URI, 60000, markers => markers.length > 0);

  const response = await fetch(`${base}/api/lsp/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uri: BROKEN_URI, languageId: 'typescript', text: BROKEN })
  });
  assert.equal(response.status, 200);

  const payload = (await diagnostics) as { uri: string; markers: { severity: number; message: string; startLineNumber: number }[] };
  assert.equal(payload.uri, BROKEN_URI);
  const error = payload.markers.find(marker => marker.severity === 8);
  assert.ok(error, 'expected an error-severity marker');
  assert.ok(error.message.includes('number'), `expected type mismatch message, got: ${error.message}`);
  assert.equal(error.startLineNumber, 1);
  socket.close();
});

test('fixing the code via lsp change clears the error markers', async () => {
  const socket = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'subscribe', channels: ['diagnostics'] }));

  const cleared = waitForDiagnostics(
    socket,
    BROKEN_URI,
    60000,
    markers => (markers as { severity?: number }[]).every(marker => marker.severity !== 8)
  );

  const fixed = 'export const answer: string = "ok";\n';
  const response = await fetch(`${base}/api/lsp/change`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uri: BROKEN_URI, text: fixed, version: 2 })
  });
  assert.equal(response.status, 200);

  const payload = (await cleared) as { markers: { severity: number }[] };
  assert.ok(payload.markers.every(marker => marker.severity !== 8), 'error markers must be cleared after the fix');
  socket.close();
});

const FEATURE = 'const obj = { alpha: 1, beta: 2 };\nconst value = obj.\nfunction target(): number { return 1; }\nconst hit = target();\n';
const FEATURE_URI = 'file:///features.ts';

async function postJson(url: string, body: unknown): Promise<{ status: number; payload: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, payload: await response.json() };
}

test('lsp completion returns members after a dot on a real ts file', async () => {
  await fs.writeFile(path.join(dir, 'features.ts'), FEATURE, 'utf8');
  const opened = await postJson(`${base}/api/lsp/open`, { uri: FEATURE_URI, languageId: 'typescript', text: FEATURE });
  assert.equal(opened.status, 200);

  const completion = await postJson(`${base}/api/lsp/completion`, { uri: FEATURE_URI, position: { line: 1, character: 18 } });
  assert.equal(completion.status, 200);
  const envelope = Envelope.safeParse(completion.payload);
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = envelope.data.data as { items: { label: string; kind?: number }[] };
  assert.ok(payload.items.some(item => item.label === 'alpha'), `expected alpha in completion items, got: ${payload.items.map(item => item.label).join(', ')}`);
  assert.ok(payload.items.some(item => item.label === 'beta'), 'expected beta in completion items');
});

test('lsp hover returns type information on a real ts file', async () => {
  const hover = await postJson(`${base}/api/lsp/hover`, { uri: FEATURE_URI, position: { line: 1, character: 15 } });
  assert.equal(hover.status, 200);
  const envelope = Envelope.safeParse(hover.payload);
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = envelope.data.data as { contents: string };
  assert.ok(payload.contents.includes('alpha'), `expected hover to mention alpha, got: ${payload.contents}`);
});

test('lsp definition resolves the target symbol to its declaration', async () => {
  const definition = await postJson(`${base}/api/lsp/definition`, { uri: FEATURE_URI, position: { line: 3, character: 14 } });
  assert.equal(definition.status, 200);
  const envelope = Envelope.safeParse(definition.payload);
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = envelope.data.data as { locations: { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }[] };
  assert.ok(payload.locations.length > 0, 'expected at least one definition location');
  const location = payload.locations[0];
  assert.equal(location?.uri, FEATURE_URI, 'definition uri must be remapped to the original client uri');
  assert.equal(location?.range.start.line, 2, 'target is declared on line 3 (0-based line 2)');
});

test('lsp close reports closed and stops the server cleanly', async () => {  const response = await fetch(`${base}/api/lsp/close`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uri: BROKEN_URI })
  });
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  assert.equal((envelope.data.data as { closed: boolean }).closed, true);
  await manager.stop('typescript');
  const status = manager.status().find(entry => entry.languageId === 'typescript');
  assert.ok(status);
  assert.equal(status.status, 'stopped');
});

test('lsp status changes are published on the lsp-status channel', async () => {
  const socket = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'subscribe', channels: ['lsp-status'] }));
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
      if (Date.now() - startedAt > 10000) return reject(new Error(`timed out waiting for lsp-status events, got: ${JSON.stringify(statuses)}`));
      setTimeout(check, 25);
    };
    check();
  });
  await poll();
  socket.close();
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