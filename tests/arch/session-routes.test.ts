import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { ArchServer } from '../../node/src/server.ts';
import { SessionStore } from '../../node/src/services/session-store.ts';
import { SettingsService } from '../../node/src/services/settings-service.mjs';
import { routeForSessionGet, routeForSessionPut } from '../../node/src/routes/session.ts';
import { routeForSettingsPut } from '../../node/src/routes/commands.ts';
import { routesForAuthority } from '../../node/src/routes/authority.ts';
import { pairFixture } from './authority-fixture.ts';
import { Envelope } from '../../common/errors.ts';

let dir: string;
let httpServer: import('node:http').Server;
let server: ArchServer;
let owner: Awaited<ReturnType<typeof pairFixture>>;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-session-'));
  const store = new SessionStore(dir);
  const settings = new SettingsService({ workspace: dir });
  await settings.load();
  server = new ArchServer(dir, path.join(dir, '.aide', 'arch-test.log'));
  for (const route of routesForAuthority()) server.route(route);
  server.route(routeForSessionGet(store)).route(routeForSessionPut(store)).route(routeForSettingsPut(settings));
  httpServer = await server.listen(0);
  owner = await pairFixture(server, `http://127.0.0.1:${(httpServer.address() as { port: number }).port}`);
});

after(async () => {
  httpServer.closeAllConnections();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

function dataOf(body: unknown): EnvelopeOkT {
  const parsed = Envelope.safeParse(body);
  assert.ok(parsed.success, 'envelope must parse');
  assert.ok(parsed.data.ok, 'envelope must be ok');
  return parsed.data;
}

type EnvelopeOkT = { ok: true; data: unknown };

function portOf(): number {
  return (httpServer.address() as { port: number }).port;
}

async function get(pathname: string): Promise<unknown> {
  const res = await owner.request(pathname);
  assert.equal(res.status, 200);
  return res.json();
}

async function putSession(body: unknown, taskId = `task:session:${Math.random().toString(36).slice(2)}`) {
  const headers = await owner.approve('PUT', '/api/session', body, taskId);
  return owner.request('/api/session', { method: 'PUT', headers, body: JSON.stringify(body) });
}

async function sessionFile(): Promise<string> {
  return fs.readFile(path.join(dir, '.aide', 'session.json'), 'utf8').catch(() => '');
}

test('session starts empty', async () => {
  const body = await get('/api/session');
  assert.deepEqual(dataOf(body).data, { version: 1, tabs: [] });
});

test('session persists a put and returns it', async () => {
  const session = { version: 1, tabs: [{ uri: 'file:///hello.txt', splitId: 's1', viewState: { line: 3 } }], activeTab: 'file:///hello.txt' };
  const put = await putSession(session);
  assert.equal(put.status, 200);
  const putData = dataOf(await put.json()).data as { tabs: { uri: string }[] };
  const firstTab = putData.tabs[0];
  assert.ok(firstTab, 'session must have one tab');
  assert.equal(firstTab.uri, 'file:///hello.txt');

  const getData = dataOf(await get('/api/session')).data as { activeTab: string; tabs: unknown[] };
  assert.equal(getData.activeTab, 'file:///hello.txt');
  assert.equal(getData.tabs.length, 1);
});

test('session rejects a body with unknown keys', async () => {
  const before = await sessionFile();
  const res = await owner.request('/api/session', { method: 'PUT', body: JSON.stringify({ version: 1, tabs: [], bogus: true }) });
  assert.equal(res.status, 400);
  const parsed = Envelope.safeParse(await res.json());
  assert.ok(parsed.success);
  assert.ok(!parsed.data.ok);
  assert.equal(parsed.data.error.code, 'BAD_REQUEST');
  assert.equal(await sessionFile(), before, 'invalid input must not mutate the session file');
});

test('legacy session file migrates instead of 500ing', async () => {
  const legacy = {
    active_file: 'app.js',
    open_files: ['app.js', 'benchmarks\\arena.mjs'],
    buffers: {},
    panel: 'terminal',
    mode: 'simple'
  };
  await fs.writeFile(path.join(dir, '.aide', 'session.json'), JSON.stringify(legacy), 'utf8');
  const res = await owner.request('/api/session');
  assert.equal(res.status, 200);
  const body = dataOf(await res.json()).data as { version: number; tabs: { uri: string }[]; activeTab?: string };
  assert.equal(body.version, 1);
  assert.equal(body.tabs.length, 2);
  const firstTab = body.tabs[0];
  assert.ok(firstTab, 'migrated tab must exist');
  assert.equal(firstTab.uri, 'file:///app.js');
  assert.equal(body.activeTab, 'file:///app.js');
});

test('corrupt session file is backed up and reset instead of 500ing', async () => {
  await fs.writeFile(path.join(dir, '.aide', 'session.json'), '{ not json', 'utf8');
  const res = await owner.request('/api/session');
  assert.equal(res.status, 200);
  const body = dataOf(await res.json()).data as { tabs: unknown[] };
  assert.equal(body.tabs.length, 0);
  const backups = await fs.readdir(path.join(dir, '.aide'));
  assert.ok(backups.some(name => name.startsWith('session.json.legacy-')), 'legacy backup must exist');
});

test('session preserves the legacy key set through PUT and GET', async () => {
  const legacy = {
    version: 1,
    tabs: [{ uri: 'file:///app.js' }],
    active_file: 'app.js',
    open_files: ['app.js', 'lib\\core.ts'],
    buffers: { 'app.js': 'let x = 1;' },
    panel: 'terminal',
    selected_engine_id: 'house-engine'
  };
  const put = await putSession(legacy);
  assert.equal(put.status, 200);
  const saved = dataOf(await put.json()).data as Record<string, unknown>;
  assert.equal(saved.active_file, 'app.js');
  assert.deepEqual(saved.open_files, ['app.js', 'lib\\core.ts']);
  assert.equal((saved.buffers as Record<string, string>)['app.js'], 'let x = 1;');
  assert.equal(saved.panel, 'terminal');
  assert.equal(saved.selected_engine_id, 'house-engine');

  const got = dataOf(await get('/api/session')).data as Record<string, unknown>;
  assert.equal(got.active_file, 'app.js');
  assert.deepEqual(got.open_files, ['app.js', 'lib\\core.ts']);
  assert.equal(got.panel, 'terminal');
  assert.equal(got.selected_engine_id, 'house-engine');
});

test('session partial patch merges and preserves legacy keys', async () => {
  const seed = {
    version: 1,
    tabs: [{ uri: 'file:///seed.ts' }],
    active_file: 'seed.ts',
    open_files: ['seed.ts'],
    panel: 'terminal'
  };
  const seedRes = await putSession(seed);
  assert.equal(seedRes.status, 200);

  const patch = { tabs: [{ uri: 'file:///patched.ts' }] };
  const put = await putSession(patch);
  assert.equal(put.status, 200);
  const saved = dataOf(await put.json()).data as { tabs: { uri: string }[]; active_file: string; open_files: string[]; panel: string };
  assert.equal(saved.active_file, 'seed.ts');
  assert.deepEqual(saved.open_files, ['seed.ts']);
  assert.equal(saved.panel, 'terminal');
  assert.equal(saved.tabs.length, 1);
  const patchedTab = saved.tabs[0];
  assert.ok(patchedTab, 'patched tab must exist');
  assert.equal(patchedTab.uri, 'file:///patched.ts');
});

test('session PUT authority: approval is exact, single-use, actor-bound and cross-route safe', async () => {
  const base = `http://127.0.0.1:${portOf()}`;
  const anonymous = await fetch(`${base}/api/session`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: 1, tabs: [] }) });
  assert.equal(anonymous.status, 403, 'anonymous actor rejected');

  const before = await sessionFile();
  const blocked = await owner.request('/api/session', { method: 'PUT', body: JSON.stringify({ version: 1, tabs: [{ uri: 'file:///blocked.ts' }] }) });
  assert.equal(blocked.status, 409, 'paired actor without approval fails');
  assert.equal(await sessionFile(), before, 'no mutation without approval');

  const original = { version: 1, tabs: [{ uri: 'file:///bound.ts' }], activeTab: 'file:///bound.ts' };
  const changed = { version: 1, tabs: [{ uri: 'file:///changed.ts' }], activeTab: 'file:///changed.ts' };
  const headers = await owner.approve('PUT', '/api/session', original, 'task:session-bound');
  const changedAttempt = await owner.request('/api/session', { method: 'PUT', headers, body: JSON.stringify(changed) });
  assert.equal(changedAttempt.status, 409, 'changed body cannot reuse approval');
  const applied = await owner.request('/api/session', { method: 'PUT', headers, body: JSON.stringify(original) });
  assert.equal(applied.status, 200, 'exact approved body executes');
  const replay = await owner.request('/api/session', { method: 'PUT', headers, body: JSON.stringify(original) });
  assert.equal(replay.status, 409, 'consumed approval cannot replay');

  // Forged actor: a second paired actor cannot use the first actor's approval.
  const forged = await pairFixture(server, base);
  const forgedAttempt = await owner.approve('PUT', '/api/session', original, 'task:session-forged');
  const forgedRun = await forged.request('/api/session', { method: 'PUT', headers: forgedAttempt, body: JSON.stringify(original) });
  assert.equal(forgedRun.status, 403, 'another actor cannot execute this authorization');

  // Cross-route: a settings approval cannot authorize a session mutation.
  const settingsApproval = await owner.approve('PUT', '/api/settings', { values: { 'aide.editor.fontSize': 20 } }, 'task:settings-cross');
  const crossRoute = await owner.request('/api/session', { method: 'PUT', headers: settingsApproval, body: JSON.stringify(original) });
  assert.equal(crossRoute.status, 409, 'authorization from another route cannot cross-authorize');

  // Cross-workspace: an approval minted against another workspace cannot authorize here.
  const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-session-peer-'));
  let peerServer: ArchServer | undefined;
  let peerHttp: import('node:http').Server | undefined;
  try {
    peerServer = new ArchServer(otherDir, path.join(otherDir, 'arch-peer.log'));
    const peerStore = new SessionStore(otherDir);
    for (const route of routesForAuthority()) peerServer.route(route);
    peerServer.route(routeForSessionGet(peerStore)).route(routeForSessionPut(peerStore));
    peerHttp = await peerServer.listen(0);
    const peerBase = `http://127.0.0.1:${(peerHttp.address() as { port: number }).port}`;
    const peerOwner = await pairFixture(peerServer, peerBase);
    const peerHeaders = await peerOwner.approve('PUT', '/api/session', original, 'task:session-peer');
    const crossWorkspace = await owner.request('/api/session', { method: 'PUT', headers: peerHeaders, body: JSON.stringify(original) });
    assert.ok([403, 404, 409].includes(crossWorkspace.status), `cross-workspace authorization must fail (got ${crossWorkspace.status}: ${await crossWorkspace.text()})`);
  } finally {
    if (peerHttp) {
      peerHttp.closeAllConnections();
      await new Promise<void>(resolve => peerHttp!.close(() => resolve()));
    }
    if (peerServer) peerServer.authority.control.close();
    await fs.rm(otherDir, { recursive: true, force: true });
  }

  const serialized = await sessionFile();
  const token = owner.headers.Authorization.slice(7);
  assert.ok(!serialized.includes(token), 'session artifacts must not serialize bearer material');
  assert.ok(!serialized.includes(owner.actorId), 'session artifacts must not serialize actor identity');
  assert.ok(!serialized.includes(headers['X-AIDE-Operation']), 'session artifacts must not serialize operation ids');
});
