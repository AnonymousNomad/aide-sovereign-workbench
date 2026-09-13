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
import { pairFixture } from './authority-fixture.ts';

const runExec = promisify(execFile);

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-terminal-patch-routes-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let owner: Awaited<ReturnType<typeof pairFixture>>;

before(async () => {
  server = new ArchServer(workspace, path.join(workspace, 'arch-test.log'));
  const routes = await buildRoutes(workspace, 'test', { authority: server.authority, events: server.events });
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
  owner = await pairFixture(server, base);
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
  // The transport approves this exact operation; the domain flag `approved:false`
  // must still be refused by the route (defense in depth).
  const deniedBody = { program: 'echo', args: ['ok'], approved: false };
  const deniedHeaders = await owner.approve('POST', '/api/terminal/run', deniedBody, 'terminal-run-denied');
  const denied = await owner.request('/api/terminal/run', {
    method: 'POST',
    headers: { ...deniedHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(deniedBody)
  });
  assert.equal(denied.status, 403);
  const deniedEnvelope = Envelope.safeParse(await denied.json());
  assert.equal(deniedEnvelope.success, true);
  if (!deniedEnvelope.success) return;
  assert.equal(deniedEnvelope.data.ok, false);
  if (deniedEnvelope.data.ok) return;
  assert.equal(deniedEnvelope.data.error.code, 'FORBIDDEN');

  const doneBody = { program: 'echo', args: ['ok'], approved: true };
  const doneHeaders = await owner.approve('POST', '/api/terminal/run', doneBody, 'terminal-run-echo');
  const done = await owner.request('/api/terminal/run', {
    method: 'POST',
    headers: { ...doneHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(doneBody)
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
  const body = { program: 'powershell', args: [], approved: true };
  const headers = await owner.approve('POST', '/api/terminal/run', body, 'terminal-run-nonallowlisted');
  const response = await owner.request('/api/terminal/run', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body)
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
  const body = { program: 'pwd', args: [], approved: true };
  const headers = await owner.approve('POST', '/api/terminal/run', body, 'terminal-run-pwd');
  const response = await owner.request('/api/terminal/run', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body)
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
  // Transport-approved exact operation, but the domain flag `approved:false`
  // must still be refused by the workspace service (defense in depth).
  const body = { patch: 'diff --git a/x.txt b/x.txt\n', approved: false };
  const headers = await owner.approve('POST', '/api/patch/apply', body, 'patch-apply-requires-approval');
  const response = await owner.request('/api/patch/apply', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body)
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
  const body = { patch: 'not a diff at all', approved: true };
  const headers = await owner.approve('POST', '/api/patch/apply', body, 'patch-apply-nonunified');
  const response = await owner.request('/api/patch/apply', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body)
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
  const body = { patch, approved: true };
  const headers = await owner.approve('POST', '/api/patch/apply', body, 'patch-apply-valid');
  const response = await owner.request('/api/patch/apply', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body)
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