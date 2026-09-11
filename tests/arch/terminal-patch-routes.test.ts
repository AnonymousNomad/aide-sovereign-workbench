import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';
import { Envelope } from '../../common/errors.ts';
import { TerminalRunResponse } from '../../common/contracts/terminal.ts';
import { PatchApplyResponse } from '../../common/contracts/patch.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runExec = promisify(execFile);

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-terminal-patch-routes-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;

before(async () => {
  server = new ArchServer(workspace, path.join(workspace, 'arch-test.log'));
  const routes = await buildRoutes(workspace, 'test');
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.events.close();
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

test('POST /api/terminal/run echo runs under approval (FORBIDDEN without)', async () => {
  const denied = await fetch(`${base}/api/terminal/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ program: 'echo', args: ['ok'], approved: false })
  });
  assert.equal(denied.status, 403);
  const deniedEnvelope = Envelope.safeParse(await denied.json());
  assert.equal(deniedEnvelope.success, true);
  if (!deniedEnvelope.success) return;
  assert.equal(deniedEnvelope.data.ok, false);
  if (deniedEnvelope.data.ok) return;
  assert.equal(deniedEnvelope.data.error.code, 'FORBIDDEN');

  const done = await fetch(`${base}/api/terminal/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ program: 'echo', args: ['ok'], approved: true })
  });
  assert.equal(done.status, 200);
  const envelope = Envelope.safeParse(await done.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, true);
  if (!envelope.data.ok) return;
  const payload = TerminalRunResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(payload.data.code, 0);
  assert.match(payload.data.stdout, /ok/);
});

test('POST /api/terminal/run rejects a non-allowlisted program', async () => {
  const response = await fetch(`${base}/api/terminal/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ program: 'powershell', args: [], approved: true })
  });
  assert.equal(response.status, 403);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, false);
  if (envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'FORBIDDEN');
});

test('POST /api/terminal/run pwd prints the workspace root', async () => {
  const response = await fetch(`${base}/api/terminal/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ program: 'pwd', args: [], approved: true })
  });
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, true);
  if (!envelope.data.ok) return;
  const payload = TerminalRunResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.match(payload.data.stdout, /aide-terminal-patch-routes/);
});

test('POST /api/patch/apply requires approval (FORBIDDEN)', async () => {
  const response = await fetch(`${base}/api/patch/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patch: 'diff --git a/x.txt b/x.txt\n', approved: false })
  });
  assert.equal(response.status, 403);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, false);
  if (envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'FORBIDDEN');
});

test('POST /api/patch/apply rejects a non-unified-diff body', async () => {
  const response = await fetch(`${base}/api/patch/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patch: 'not a diff at all', approved: true })
  });
  assert.equal(response.status, 400);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, false);
  if (envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'BAD_REQUEST');
});

test('POST /api/patch/apply applies a valid unified diff', async () => {
  await fs.writeFile(path.join(workspace, 'target.txt'), 'line A\nline B\n', 'utf8');
  await runExec('git', ['init', '-q'], { cwd: workspace });
  await runExec('git', ['add', '.'], { cwd: workspace });
  await runExec('git', ['-c', 'user.name=AIDE', '-c', 'user.email=aide@example.invalid', 'commit', '-qm', 'base'], { cwd: workspace });
  const patch = [
    'diff --git a/target.txt b/target.txt',
    '--- a/target.txt',
    '+++ b/target.txt',
    '@@ -1,2 +1,2 @@',
    '-line A',
    '+line A1',
    ' line B'
  ].join('\n') + '\n';
  const response = await fetch(`${base}/api/patch/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patch, approved: true })
  });
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, true);
  if (!envelope.data.ok) return;
  const payload = PatchApplyResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(payload.data.applied, true);
  assert.ok(payload.data.bytes > 0);
  const applied = await fs.readFile(path.join(workspace, 'target.txt'), 'utf8');
  assert.match(applied, /line A1/);
});