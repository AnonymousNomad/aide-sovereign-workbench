import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { ArchServer } from '../../node/src/server.ts';
import { SessionStore } from '../../node/src/services/session-store.ts';
import { routeForSessionGet, routeForSessionPut } from '../../node/src/routes/session.ts';
import { Envelope } from '../../common/errors.ts';

let dir: string;
let httpServer: import('node:http').Server;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-session-'));
  const store = new SessionStore(dir);
  const server = new ArchServer(dir, path.join(dir, '.aide', 'arch-test.log'));
  server.route(routeForSessionGet(store)).route(routeForSessionPut(store));
  httpServer = await server.listen(0);
});

after(async () => {
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

async function get(port: number, pathname: string): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
  assert.equal(res.status, 200);
  return res.json();
}

test('session starts empty', async () => {
  const port = (httpServer.address() as { port: number }).port;
  const body = await get(port, '/api/session');
  assert.deepEqual(dataOf(body).data, { version: 1, tabs: [] });
});

test('session persists a put and returns it', async () => {
  const port = (httpServer.address() as { port: number }).port;
  const session = { version: 1, tabs: [{ uri: 'file:///hello.txt', splitId: 's1', viewState: { line: 3 } }], activeTab: 'file:///hello.txt' };
  const put = await fetch(`http://127.0.0.1:${port}/api/session`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(session)
  });
  assert.equal(put.status, 200);
  const putData = dataOf(await put.json()).data as { tabs: { uri: string }[] };
  const firstTab = putData.tabs[0];
  assert.ok(firstTab, 'session must have one tab');
  assert.equal(firstTab.uri, 'file:///hello.txt');

  const getData = dataOf(await get(port, '/api/session')).data as { activeTab: string; tabs: unknown[] };
  assert.equal(getData.activeTab, 'file:///hello.txt');
  assert.equal(getData.tabs.length, 1);
});

test('session rejects a body with unknown keys', async () => {
  const port = (httpServer.address() as { port: number }).port;
  const res = await fetch(`http://127.0.0.1:${port}/api/session`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, tabs: [], bogus: true })
  });
  assert.equal(res.status, 400);
  const parsed = Envelope.safeParse(await res.json());
  assert.ok(parsed.success);
  assert.ok(!parsed.data.ok);
  assert.equal(parsed.data.error.code, 'BAD_REQUEST');
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
  const port = (httpServer.address() as { port: number }).port;
  const res = await fetch(`http://127.0.0.1:${port}/api/session`);
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
  const port = (httpServer.address() as { port: number }).port;
  const res = await fetch(`http://127.0.0.1:${port}/api/session`);
  assert.equal(res.status, 200);
  const body = dataOf(await res.json()).data as { tabs: unknown[] };
  assert.equal(body.tabs.length, 0);
  const backups = await fs.readdir(path.join(dir, '.aide'));
  assert.ok(backups.some(name => name.startsWith('session.json.legacy-')), 'legacy backup must exist');
});