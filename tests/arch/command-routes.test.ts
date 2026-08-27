import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-commands-routes-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;

before(async () => {
  server = new ArchServer(workspace, path.join(workspace, 'arch-test.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const routes = await buildRoutes(workspace, 'test', { events: server.events });
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
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

async function post(pathName: string, payload: unknown) {
  return fetch(`${base}${pathName}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
}

test('commands list is non-empty and invoke covers success, unknown, and disabled', async () => {
  const listResponse = await fetch(`${base}/api/commands`);
  const listed = (await listResponse.json()) as { data?: { commands?: Array<Record<string, unknown>> } };
  assert.ok((listed.data?.commands?.length ?? 0) > 0, 'registry must expose built-in commands');

  const unknown = await post('/api/commands/invoke', { id: 'aide.does.notExist' });
  assert.equal(unknown.status, 404);

  const badPayload = await post('/api/commands/invoke', { id: 'x' });
  assert.equal(badPayload.status, 400);
});

test('keybindings resolve single chords, chord sequences, and report pending prefixes', async () => {
  const resolved = await post('/api/keybindings/resolve', { chords: ['ctrl+shift+p'] });
  const body = (await resolved.json()) as { data?: { match?: string | null; pending?: boolean } };
  assert.equal(body.data?.match, 'aide.commandPalette.show');
  assert.equal(body.data?.pending, false);

  const prefix = await post('/api/keybindings/resolve', { chords: ['ctrl+k'] });
  const prefixBody = (await prefix.json()) as { data?: { pending?: boolean } };
  assert.equal(prefixBody.data?.pending, true);

  const empty = await post('/api/keybindings/resolve', { chords: [] });
  assert.equal(empty.status, 400);
});

test('settings round-trip through GET and PUT with machine-scope protection', async () => {
  const initial = await fetch(`${base}/api/settings`);
  const before = (await initial.json()) as { data?: { values?: Record<string, unknown>; descriptors?: Array<{ key: string }> } };
  assert.equal(before.data?.values?.['aide.editor.fontSize'], 14);
  assert.ok((before.data?.descriptors?.length ?? 0) >= 5);

  const written = await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values: { 'aide.editor.fontSize': 18 } }) });
  const after = (await written.json()) as { data?: { values?: Record<string, unknown> } };
  assert.equal(after.data?.values?.['aide.editor.fontSize'], 18);

  const machineScope = await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values: { 'aide.terminal.shellPath': 'evil' } }) });
  assert.equal(machineScope.status, 400);
});
