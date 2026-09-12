import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { pairFixture } from './authority-fixture.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-commands-routes-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let owner: Awaited<ReturnType<typeof pairFixture>>;

before(async () => {
  server = new ArchServer(workspace, path.join(workspace, 'arch-test.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const routes = await buildRoutes(workspace, 'test', { events: server.events, authority: server.authority });
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
  owner = await pairFixture(server, base);
});

after(async () => {
  httpServer.closeAllConnections();
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

const settingsFile = () => path.join(workspace, '.aide', 'settings.json');
const settingsRaw = () => fs.readFile(settingsFile(), 'utf8').catch(() => '');

async function prepare(method: string, pathName: string, payload: unknown) {
  const response = await owner.request('/api/authority/prepare', {
    method: 'POST',
    body: JSON.stringify({ method, path: pathName, body: payload, task_id: `task:${method}:${pathName}` })
  });
  return { status: response.status, body: (await response.json()) as { ok: boolean; error?: { code: string }; data?: unknown } };
}

test('commands list is non-empty; invoke is frozen pending its architecture-decision wave', async () => {
  const listResponse = await owner.request('/api/commands');
  assert.equal(listResponse.status, 200);
  const listed = (await listResponse.json()) as { data?: { commands?: Array<Record<string, unknown>> } };
  assert.ok((listed.data?.commands?.length ?? 0) > 0, 'registry must expose built-in commands');

  // POST /api/commands/invoke is ARCHITECTURE-DECISION (not yet authorized);
  // it fails closed for every caller until its own enrollment wave. The
  // original 404/400 semantics are re-asserted when that route is enrolled.
  const unknown = await owner.request('/api/commands/invoke', { method: 'POST', body: JSON.stringify({ id: 'aide.does.notExist' }) });
  assert.equal(unknown.status, 403);
  const badPayload = await owner.request('/api/commands/invoke', { method: 'POST', body: JSON.stringify({ id: 'x' }) });
  assert.equal(badPayload.status, 400, 'contract violations still fail before authority');
  const anonymous = await fetch(`${base}/api/commands/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'x' }) });
  assert.equal(anonymous.status, 403);
});

test('keybindings resolve single chords, chord sequences, and report pending prefixes', async () => {
  const resolved = await owner.request('/api/keybindings/resolve', { method: 'POST', body: JSON.stringify({ chords: ['ctrl+shift+p'] }) });
  const body = (await resolved.json()) as { data?: { match?: string | null; pending?: boolean } };
  assert.equal(body.data?.match, 'aide.commandPalette.show');
  assert.equal(body.data?.pending, false);

  const prefix = await owner.request('/api/keybindings/resolve', { method: 'POST', body: JSON.stringify({ chords: ['ctrl+k'] }) });
  const prefixBody = (await prefix.json()) as { data?: { pending?: boolean } };
  assert.equal(prefixBody.data?.pending, true);

  const empty = await owner.request('/api/keybindings/resolve', { method: 'POST', body: JSON.stringify({ chords: [] }) });
  assert.equal(empty.status, 400);
});

test('settings round-trip through GET and PUT with machine-scope protection', async () => {
  const initial = await owner.request('/api/settings');
  const before = (await initial.json()) as { data?: { values?: Record<string, unknown>; descriptors?: Array<{ key: string }> } };
  assert.equal(before.data?.values?.['aide.editor.fontSize'], 14);
  assert.ok((before.data?.descriptors?.length ?? 0) >= 5);

  const values = { values: { 'aide.editor.fontSize': 18 } };
  const headers = await owner.approve('PUT', '/api/settings', values, 'task:settings');
  const written = await owner.request('/api/settings', { method: 'PUT', headers, body: JSON.stringify(values) });
  const after = (await written.json()) as { data?: { values?: Record<string, unknown> } };
  assert.equal(after.data?.values?.['aide.editor.fontSize'], 18);

  const machineScope = await prepare('PUT', '/api/settings', { values: { 'aide.terminal.shellPath': 'evil' } });
  assert.equal(machineScope.status, 400);
  assert.equal(machineScope.body.error?.code, 'BAD_REQUEST');
});

test('settings PUT authority: exact values, single-use, no mutation without approval', async () => {
  const before = await settingsRaw();

  const blocked = await owner.request('/api/settings', { method: 'PUT', body: JSON.stringify({ values: { 'aide.editor.fontSize': 21 } }) });
  assert.equal(blocked.status, 409, 'paired actor without approval fails');
  assert.equal(await settingsRaw(), before, 'no mutation without approval');

  const malformed = await owner.request('/api/settings', { method: 'PUT', body: JSON.stringify({ values: 'nope' }) });
  assert.equal(malformed.status, 400, 'malformed values fail before authority');
  assert.equal(await settingsRaw(), before, 'malformed input must not mutate');

  const original = { values: { 'aide.editor.fontSize': 20 } };
  const changed = { values: { 'aide.editor.fontSize': 22 } };
  const headers = await owner.approve('PUT', '/api/settings', original, 'task:settings-bound');
  const changedAttempt = await owner.request('/api/settings', { method: 'PUT', headers, body: JSON.stringify(changed) });
  assert.equal(changedAttempt.status, 409, 'changed values cannot reuse approval');
  const applied = await owner.request('/api/settings', { method: 'PUT', headers, body: JSON.stringify(original) });
  assert.equal(applied.status, 200, 'exact approved values execute');
  const replay = await owner.request('/api/settings', { method: 'PUT', headers, body: JSON.stringify(original) });
  assert.equal(replay.status, 409, 'consumed approval cannot replay');

  const serialized = await settingsRaw();
  const token = owner.headers.Authorization.slice(7);
  assert.ok(!serialized.includes(token), 'settings artifacts must not serialize bearer material');
  assert.ok(!serialized.includes(owner.actorId), 'settings artifacts must not serialize actor identity');
  assert.ok(!serialized.includes(headers['X-AIDE-Operation']), 'settings artifacts must not serialize operation ids');
});
