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
  // Seed the installed state directly so the trust tests stay independent of
  // the install enrollment: trust mutations require an installed workbench,
  // and seeding durable state is fixture setup, not a production shortcut.
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

test('install authority: anonymous, unapproved, malformed, changed and unknown ids never write', async () => {
  const anonymous = await fetch(`${base}/api/workbenches/install`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'sovereign-coder' })
  });
  assert.equal(anonymous.status, 403, 'anonymous actor rejected');

  const before = await trustStateRaw();
  const unapproved = await read('/api/workbenches/install', { method: 'POST', body: JSON.stringify({ id: 'sovereign-coder' }) });
  assert.equal(unapproved.status, 409, 'unapproved install denied');
  const malformed = await read('/api/workbenches/install', { method: 'POST', body: JSON.stringify({ id: '' }) });
  assert.equal(malformed.status, 400, 'empty id rejected');
  const extra = await read('/api/workbenches/install', { method: 'POST', body: JSON.stringify({ id: 'sovereign-coder', approved: true }) });
  assert.equal(extra.status, 400, 'no extra authority fields exist');
  assert.equal(await trustStateRaw(), before, 'no mutation before approval');

  const headers = await owner.approve('POST', '/api/workbenches/install', { id: 'sovereign-architect' }, 'task:wb-install-changed');
  const changed = await owner.request('/api/workbenches/install', { method: 'POST', headers, body: JSON.stringify({ id: 'sovereign-coder' }) });
  assert.equal(changed.status, 409, 'changed catalog id cannot reuse approval');
  assert.equal(await trustStateRaw(), before, 'changed id writes nothing');

  const unknown = await mutate('/api/workbenches/install', { id: 'not-a-workbench' }, 'task:wb-install-unknown');
  assert.equal(unknown.status, 400, 'unknown catalog id rejected');
  assert.equal(await trustStateRaw(), before, 'unknown id writes nothing');
  await assert.rejects(() => fs.access(path.join(path.dirname(trustStateFile()), 'not-a-workbench.json')));
});

test('install: approved exact operation creates untrusted disabled state; replay and duplicate semantics', async () => {
  const headers = await owner.approve('POST', '/api/workbenches/install', { id: 'sovereign-coder' }, 'task:wb-install-exact');
  const first = await owner.request('/api/workbenches/install', { method: 'POST', headers, body: JSON.stringify({ id: 'sovereign-coder' }) });
  assert.equal(first.status, 200, await first.clone().text());
  const firstEnvelope = await first.json() as Envelope<{ workbench: { installed: boolean; enabled: boolean } }>;
  assert.equal(firstEnvelope.data?.workbench.installed, true);
  assert.equal(firstEnvelope.data?.workbench.enabled, false, 'install never enables or trusts');
  const state = JSON.parse(await trustStateRaw());
  assert.equal(state.enabled, false);
  assert.deepEqual(state.mcp_trusted, {}, 'install grants no trust');

  const replay = await owner.request('/api/workbenches/install', { method: 'POST', headers, body: JSON.stringify({ id: 'sovereign-coder' }) });
  assert.equal(replay.status, 409, 'consumed install approval cannot replay');

  const duplicate = await mutate<{ workbench: { installed: boolean; enabled: boolean } }>('/api/workbenches/install', { id: 'sovereign-coder' }, 'task:wb-install-dup');
  assert.equal(duplicate.status, 200, 'duplicate install preserves overwrite semantics');
  assert.equal(duplicate.envelope.data?.workbench.enabled, false, 'reinstall remains disabled and untrusted');
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
  // does not authorize an unapproved install, and the state file holds no
  // authority material.
  await mutate('/api/workbenches/trust', { id: 'sovereign-coder', server: 'filesystem', trusted: true }, 'task:wb-trust-again');
  const stillGated = await read('/api/workbenches/install', { method: 'POST', body: JSON.stringify({ id: 'sovereign-coder' }) });
  assert.equal(stillGated.status, 409, 'trust never grants execution authority: unapproved install still fails');
  const serialized = await trustStateRaw();
  const token = owner.headers.Authorization.slice(7);
  assert.ok(!serialized.includes(token) && !serialized.includes(owner.actorId), 'trust state must not serialize authority material');
  assert.ok(!serialized.includes(headers['X-AIDE-Operation']), 'trust state must not serialize operation ids');
});

test('containment: linked state objects cannot expose or mutate outside content through trust/detail', async () => {
  const statePath = trustStateFile();
  const original = await fs.readFile(statePath, 'utf8');
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-route-outside-'));
  const outsideSentinel = path.join(outsideDir, 'sentinel.json');
  const sentinel = JSON.stringify({ id: 'sentinel', enabled: true, mcp_trusted: { filesystem: true } }, null, 2);
  await fs.writeFile(outsideSentinel, sentinel);
  try {
    // (a) state-file symlink to the outside sentinel: detail read and approved
    //     trust write both fail closed; the sentinel is never exposed.
    await fs.rm(statePath, { force: true });
    await fs.symlink(outsideSentinel, statePath, 'file');
    const detailLinked = await read('/api/workbenches/detail', { method: 'POST', body: JSON.stringify({ id: 'sovereign-coder' }) });
    assert.equal(detailLinked.status, 400, 'detail rejects link-like state object');
    assert.equal(await fs.readFile(outsideSentinel, 'utf8'), sentinel, 'sentinel not exposed or modified');
    const trustLinked = await mutate('/api/workbenches/trust', { id: 'sovereign-coder', server: 'filesystem', trusted: false }, 'task:wb-contained-link');
    assert.equal(trustLinked.status, 400, 'approved trust fails closed on link-like state object');
    assert.equal(await fs.readFile(outsideSentinel, 'utf8'), sentinel);

    // (b) hardlink to the outside sentinel: same uniform policy.
    await fs.rm(statePath, { force: true });
    await fs.link(outsideSentinel, statePath);
    const detailHard = await read('/api/workbenches/detail', { method: 'POST', body: JSON.stringify({ id: 'sovereign-coder' }) });
    assert.equal(detailHard.status, 400, 'detail rejects hard-linked state object');
    assert.equal(await fs.readFile(outsideSentinel, 'utf8'), sentinel);
    const trustHard = await mutate('/api/workbenches/trust', { id: 'sovereign-coder', server: 'filesystem', trusted: false }, 'task:wb-contained-hard');
    assert.equal(trustHard.status, 400, 'approved trust fails closed on hard-linked state object');
    assert.equal(await fs.readFile(outsideSentinel, 'utf8'), sentinel);
    await fs.rm(statePath, { force: true });

    // (c) root junction to an outside directory: list/detail/trust all fail
    //     closed and write nothing outside.
    const rootDir = path.dirname(statePath);
    await fs.rm(rootDir, { recursive: true, force: true });
    await fs.symlink(outsideDir, rootDir, 'junction');
    const listJunction = await read('/api/workbenches');
    assert.equal(listJunction.status, 400, 'list fails closed on junctioned root');
    const detailJunction = await read('/api/workbenches/detail', { method: 'POST', body: JSON.stringify({ id: 'sovereign-coder' }) });
    assert.equal(detailJunction.status, 400, 'detail fails closed on junctioned root');
    const trustJunction = await mutate('/api/workbenches/trust', { id: 'sovereign-coder', server: 'filesystem', trusted: true }, 'task:wb-contained-root');
    assert.equal(trustJunction.status, 400, 'approved trust fails closed on junctioned root');
    assert.deepEqual(await fs.readdir(outsideDir), ['sentinel.json'], 'nothing written outside; sentinel intact');
    assert.equal(await fs.readFile(outsideSentinel, 'utf8'), sentinel);
  } finally {
    const rootDir = path.dirname(statePath);
    await fs.rm(rootDir, { recursive: true, force: true });
    await fs.mkdir(rootDir, { recursive: true });
    await fs.writeFile(statePath, original, 'utf8');
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

test('uninstall authority: exact approved operation removes only its canonical state', async () => {
  // Prepare: both bundles installed plus an unrelated .aide file.
  await mutate('/api/workbenches/install', { id: 'sovereign-coder' }, 'task:wb-uninstall-prep-coder');
  await mutate('/api/workbenches/install', { id: 'sovereign-architect' }, 'task:wb-uninstall-prep-arch');
  const keep = path.join(workspace, '.aide', 'keep.json');
  await fs.writeFile(keep, '{"keep":true}');
  const architectState = path.join(path.dirname(trustStateFile()), 'sovereign-architect.json');

  const anonymous = await fetch(`${base}/api/workbenches/uninstall`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'sovereign-coder' })
  });
  assert.equal(anonymous.status, 403, 'anonymous actor rejected');
  const unapproved = await read('/api/workbenches/uninstall', { method: 'POST', body: JSON.stringify({ id: 'sovereign-coder' }) });
  assert.equal(unapproved.status, 409, 'unapproved uninstall denied');
  const malformed = await read('/api/workbenches/uninstall', { method: 'POST', body: JSON.stringify({ id: '' }) });
  assert.equal(malformed.status, 400, 'empty id rejected');

  const headers = await owner.approve('POST', '/api/workbenches/uninstall', { id: 'sovereign-coder' }, 'task:wb-uninstall-changed');
  const changed = await owner.request('/api/workbenches/uninstall', { method: 'POST', headers, body: JSON.stringify({ id: 'sovereign-architect' }) });
  assert.equal(changed.status, 409, 'changed id cannot reuse approval');
  await fs.access(trustStateFile());
  await fs.access(architectState);

  const removed = await mutate<{ removed: string }>('/api/workbenches/uninstall', { id: 'sovereign-coder' }, 'task:wb-uninstall-exact');
  assert.equal(removed.status, 200);
  assert.equal(removed.envelope.data?.removed, 'sovereign-coder');
  await assert.rejects(() => fs.access(trustStateFile()));
  await fs.access(architectState);
  assert.equal(await fs.readFile(keep, 'utf8'), '{"keep":true}', 'unrelated .aide state untouched');

  // Replay: a consumed uninstall approval cannot run again.
  const replayHeaders = await owner.approve('POST', '/api/workbenches/uninstall', { id: 'sovereign-architect' }, 'task:wb-uninstall-replay');
  const first = await owner.request('/api/workbenches/uninstall', { method: 'POST', headers: replayHeaders, body: JSON.stringify({ id: 'sovereign-architect' }) });
  assert.equal(first.status, 200);
  const replay = await owner.request('/api/workbenches/uninstall', { method: 'POST', headers: replayHeaders, body: JSON.stringify({ id: 'sovereign-architect' }) });
  assert.equal(replay.status, 409, 'consumed uninstall approval cannot replay');

  // Non-installed but catalog-valid id preserves the no-op semantics.
  const noop = await mutate<{ removed: string }>('/api/workbenches/uninstall', { id: 'sovereign-pipeline' }, 'task:wb-uninstall-noop');
  assert.equal(noop.status, 200);
  assert.equal(noop.envelope.data?.removed, 'sovereign-pipeline');

  // Containment regression: authority may approve the exact uninstall, but a
  // link-like state object still fails closed with no outside effect.
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-uninstall-outside-'));
  const outsideSentinel = path.join(outsideDir, 'sentinel.json');
  const sentinel = JSON.stringify({ id: 'sentinel' }, null, 2);
  await fs.writeFile(outsideSentinel, sentinel);
  try {
    await fs.symlink(outsideSentinel, trustStateFile(), 'file');
    const linked = await mutate('/api/workbenches/uninstall', { id: 'sovereign-coder' }, 'task:wb-uninstall-linked');
    assert.equal(linked.status, 400, 'approved uninstall fails closed on a link-like state object');
    assert.equal(await fs.readFile(outsideSentinel, 'utf8'), sentinel, 'sentinel untouched');
    assert.equal((await fs.lstat(trustStateFile())).isSymbolicLink(), true, 'link untouched by the rejected removal');
  } finally {
    await fs.rm(trustStateFile(), { force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});
