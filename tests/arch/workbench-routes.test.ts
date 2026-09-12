import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { ArchServer } from '../../node/src/server.ts';
import { pairFixture } from './authority-fixture.ts';

let workspace: string;
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let owner: Awaited<ReturnType<typeof pairFixture>>;

const trustStateFile = () => path.join(workspace, '.aide', 'workbenches', 'sovereign-coder.json');
const trustStateRaw = () => fs.readFile(trustStateFile(), 'utf8').catch(() => '');

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-wb-routes-'));
  // Seed the installed state directly: POST /api/workbenches/install is an
  // ARCHITECTURE-DECISION route and stays frozen (403) until its own wave, but
  // trust mutations require an installed workbench. Seeding durable state is
  // fixture setup, not a production shortcut.
  await fs.mkdir(path.dirname(trustStateFile()), { recursive: true });
  await fs.writeFile(trustStateFile(), JSON.stringify({
    id: 'sovereign-coder',
    version: '0.1.0',
    installed_at: new Date().toISOString(),
    enabled: false,
    plugins_enabled: {},
    skills_enabled: {},
    mcp_trusted: {}
  }, null, 2), 'utf8');

  server = new ArchServer(workspace, path.join(workspace, 'wb-routes.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
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
  httpServer.closeAllConnections();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  for (let attempt = 0; attempt < 10; attempt++) {
    try { await fs.rm(workspace, { recursive: true, force: true }); return; }
    catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
});

interface Envelope<T = unknown> { ok?: boolean; data?: T; error?: { code: string; message: string; detail?: unknown } }

async function read<T = unknown>(urlPath: string, init: RequestInit = {}): Promise<{ status: number; envelope: Envelope<T> }> {
  const response = await owner.request(urlPath, init);
  const envelope = await response.json() as Envelope<T>;
  return { status: response.status, envelope };
}

async function mutate<T = unknown>(urlPath: string, body: Record<string, unknown>, taskId: string): Promise<{ status: number; envelope: Envelope<T> }> {
  const headers = await owner.approve('POST', urlPath, body, taskId);
  const response = await owner.request(urlPath, { method: 'POST', headers, body: JSON.stringify(body) });
  const envelope = await response.json() as Envelope<T>;
  return { status: response.status, envelope };
}

async function detail(): Promise<Envelope<{ workbench: { installed: boolean; mcp_servers: Array<{ name: string; trusted: boolean }> } }>> {
  const { envelope } = await read<{ workbench: { installed: boolean; mcp_servers: Array<{ name: string; trusted: boolean }> } }>('/api/workbenches/detail', {
    method: 'POST',
    body: JSON.stringify({ id: 'sovereign-coder' })
  });
  return envelope;
}

test('GET /api/workbenches lists the shipped sovereign-coder bundle', async () => {
  const { status, envelope } = await read<{ workbenches: Array<{ id: string; installed: boolean; validated: boolean; online_mcp_count: number }> }>('/api/workbenches');
  assert.equal(status, 200);
  assert.equal(envelope.ok, true);
  const bundle = (envelope.data?.workbenches ?? []).find(b => b.id === 'sovereign-coder');
  assert.ok(bundle, 'sovereign-coder discoverable via the API');
  assert.equal(bundle.installed, true, 'fixture-seeded installed state is reported');
  assert.equal(bundle.validated, true);
  assert.equal(bundle.online_mcp_count, 2);
});

test('POST /api/workbenches/install stays frozen for its own architecture-decision wave', async () => {
  const { status } = await read('/api/workbenches/install', { method: 'POST', body: JSON.stringify({ id: 'sovereign-coder' }) });
  assert.equal(status, 403, 'install remains fail-closed until enrolled');
});

test('trusting an online server without consent returns FORBIDDEN + CONSENT_REQUIRED', async () => {
  const { status, envelope } = await mutate<{ workbench: { mcp_servers: Array<{ name: string; trusted: boolean }> } }>(
    '/api/workbenches/trust', { id: 'sovereign-coder', server: 'github', trusted: true }, 'task:wb-online'
  );
  assert.equal(status, 403);
  assert.equal(envelope.error?.code, 'FORBIDDEN');
  assert.equal((envelope.error?.detail as { code?: string } | undefined)?.code, 'CONSENT_REQUIRED');
  const github = (await detail()).data?.workbench.mcp_servers.find(s => s.name === 'github');
  assert.equal(github?.trusted, false, 'server remains untrusted');
});

test('trusting an offline server succeeds and the API reports trusted=true', async () => {
  const { status, envelope } = await mutate<{ workbench: { mcp_servers: Array<{ name: string; trusted: boolean }> } }>(
    '/api/workbenches/trust', { id: 'sovereign-coder', server: 'filesystem', trusted: true }, 'task:wb-offline'
  );
  assert.equal(status, 200);
  assert.equal(envelope.ok, true);
  const filesystem = envelope.data?.workbench.mcp_servers.find(s => s.name === 'filesystem');
  assert.equal(filesystem?.trusted, true);
});

test('trust authority: exact id/server/boolean binding, zero mutation without approval, trust is not authority', async () => {
  const anonymous = await fetch(`${base}/api/workbenches/trust`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'sovereign-coder', server: 'filesystem', trusted: false })
  });
  assert.equal(anonymous.status, 403, 'anonymous actor rejected');

  const before = await trustStateRaw();
  const blocked = await owner.request('/api/workbenches/trust', { method: 'POST', body: JSON.stringify({ id: 'sovereign-coder', server: 'filesystem', trusted: false }) });
  assert.equal(blocked.status, 409, 'paired actor without approval fails');
  assert.equal(await trustStateRaw(), before, 'no trust mutation without approval');

  // Changed id/server/boolean cannot reuse an approval; exact body executes.
  const original = { id: 'sovereign-coder', server: 'filesystem', trusted: false };
  const changedBoolean = { id: 'sovereign-coder', server: 'filesystem', trusted: true };
  const changedServer = { id: 'sovereign-coder', server: 'github', trusted: false };
  const headers = await owner.approve('POST', '/api/workbenches/trust', original, 'task:wb-bound');
  const wrongBoolean = await owner.request('/api/workbenches/trust', { method: 'POST', headers, body: JSON.stringify(changedBoolean) });
  assert.equal(wrongBoolean.status, 409, 'changed trust value cannot reuse approval');
  const wrongServer = await owner.request('/api/workbenches/trust', { method: 'POST', headers, body: JSON.stringify(changedServer) });
  assert.equal(wrongServer.status, 409, 'changed server cannot reuse approval');
  const applied = await owner.request('/api/workbenches/trust', { method: 'POST', headers, body: JSON.stringify(original) });
  assert.equal(applied.status, 200, 'exact approved trust mutation executes');
  const filesystem = (await detail()).data?.workbench.mcp_servers.find(s => s.name === 'filesystem');
  assert.equal(filesystem?.trusted, false, 'revocation semantics preserved');
  const replay = await owner.request('/api/workbenches/trust', { method: 'POST', headers, body: JSON.stringify(original) });
  assert.equal(replay.status, 409, 'consumed trust approval cannot replay');

  // Unknown ids/servers fail deterministically without mutating state.
  const afterReplay = await trustStateRaw();
  const unknownId = await mutate('/api/workbenches/trust', { id: 'not-a-workbench', server: 'filesystem', trusted: true }, 'task:wb-unknown-id');
  assert.equal(unknownId.status, 400);
  const unknownServer = await mutate('/api/workbenches/trust', { id: 'sovereign-coder', server: 'not-a-server', trusted: true }, 'task:wb-unknown-server');
  assert.equal(unknownServer.status, 400);
  assert.equal(await trustStateRaw(), afterReplay, 'failed trust mutations leave state unchanged');

  // Trust state is descriptive policy, never authority: a trusted workbench
  // does not unlock the still-frozen install route, and the state file holds no
  // authority material.
  await mutate('/api/workbenches/trust', { id: 'sovereign-coder', server: 'filesystem', trusted: true }, 'task:wb-trust-again');
  const stillFrozen = await read('/api/workbenches/install', { method: 'POST', body: JSON.stringify({ id: 'sovereign-coder' }) });
  assert.equal(stillFrozen.status, 403, 'trust never grants execution authority');
  const serialized = await trustStateRaw();
  const token = owner.headers.Authorization.slice(7);
  assert.ok(!serialized.includes(token) && !serialized.includes(owner.actorId), 'trust state must not serialize authority material');
  assert.ok(!serialized.includes(headers['X-AIDE-Operation']), 'trust state must not serialize operation ids');
});

test('POST /api/workbenches/uninstall stays frozen for its own architecture-decision wave', async () => {
  const { status } = await read('/api/workbenches/uninstall', { method: 'POST', body: JSON.stringify({ id: 'sovereign-coder' }) });
  assert.equal(status, 403, 'uninstall remains fail-closed until enrolled');
});
