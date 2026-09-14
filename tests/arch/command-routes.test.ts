import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { pairFixture } from './authority-fixture.ts';
import { CommandRegistry } from '../../node/src/services/command-registry.mjs';
import { CommandInvokeError, commandArgsDigest, describeCommandInvoke, handlerDigestFor, registryDigestFor } from '../../node/src/services/command-invoke-authority.ts';

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

test('commands list is non-empty; invoke enrolls under capability.execute', async () => {
  const listResponse = await owner.request('/api/commands');
  assert.equal(listResponse.status, 200);
  const listed = (await listResponse.json()) as { data?: { commands?: Array<Record<string, unknown>> } };
  assert.ok((listed.data?.commands?.length ?? 0) > 0, 'registry must expose built-in commands');

  // Contract violations still fail before authority with the original 400.
  const badPayload = await owner.request('/api/commands/invoke', { method: 'POST', body: JSON.stringify({ id: 'x' }) });
  assert.equal(badPayload.status, 400, 'contract violations still fail before authority');
  const anonymous = await fetch(`${base}/api/commands/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'aide.view.toggleSidebar' }) });
  assert.equal(anonymous.status, 403);

  // Unknown command ids keep their original NOT_FOUND semantics at prepare.
  const unknown = await prepare('POST', '/api/commands/invoke', { id: 'aide.does.notExist' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error?.code, 'NOT_FOUND');

  // A paired actor without an approval still cannot execute.
  const blocked = await owner.request('/api/commands/invoke', { method: 'POST', body: JSON.stringify({ id: 'aide.view.toggleSidebar' }) });
  assert.equal(blocked.status, 409, 'paired actor without approval fails');

  const payload = { id: 'aide.view.toggleSidebar', args: { reason: 'audit' } };
  const headers = await owner.approve('POST', '/api/commands/invoke', payload, 'task:invoke');
  const applied = await owner.request('/api/commands/invoke', { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.equal(applied.status, 200);
  const appliedBody = (await applied.json()) as { data?: { result?: unknown } };
  assert.deepEqual(appliedBody.data?.result, { dispatched: 'aide.view.toggleSidebar', surface: 'workbench' });
  const replay = await owner.request('/api/commands/invoke', { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.equal(replay.status, 409, 'consumed approval cannot replay');
});

test('invoke binds exact args: changed args cannot reuse an approval', async () => {
  const original = { id: 'aide.file.save', args: { path: 'a.txt' } };
  const changed = { id: 'aide.file.save', args: { path: 'b.txt' } };
  const headers = await owner.approve('POST', '/api/commands/invoke', original, 'task:invoke-args');
  const changedAttempt = await owner.request('/api/commands/invoke', { method: 'POST', headers, body: JSON.stringify(changed) });
  assert.equal(changedAttempt.status, 409, 'changed args cannot reuse approval');
  const swappedId = await owner.request('/api/commands/invoke', { method: 'POST', headers, body: JSON.stringify({ id: 'aide.git.status', args: original.args }) });
  assert.equal(swappedId.status, 409, 'a different command id cannot reuse approval');
  const applied = await owner.request('/api/commands/invoke', { method: 'POST', headers, body: JSON.stringify(original) });
  assert.equal(applied.status, 200, 'exact approved args execute');
});

test('invoke distinguishes omitted args from null args at the HTTP boundary', async () => {
  const omitted = { id: 'aide.quickOpen.show' };
  const nullArgs = { id: 'aide.quickOpen.show', args: null };
  const headers = await owner.approve('POST', '/api/commands/invoke', omitted, 'task:invoke-omitted');
  const nullAttempt = await owner.request('/api/commands/invoke', { method: 'POST', headers, body: JSON.stringify(nullArgs) });
  assert.equal(nullAttempt.status, 409, 'null args cannot reuse an approval minted for omitted args');
  const applied = await owner.request('/api/commands/invoke', { method: 'POST', headers, body: JSON.stringify(omitted) });
  assert.equal(applied.status, 200);

  // -0 parses to 0 on the wire through the prepare endpoint, so mint the
  // approval with 0 and send the raw -0 text at execute: the execute-side
  // digest must differ and conflict.
  const zero = { id: 'aide.view.zoomReset', args: 0 };
  const zeroHeaders = await owner.approve('POST', '/api/commands/invoke', zero, 'task:invoke-zero');
  const negZeroAttempt = await owner.request('/api/commands/invoke', { method: 'POST', headers: zeroHeaders, body: '{"id":"aide.view.zoomReset","args":-0}' });
  assert.equal(negZeroAttempt.status, 409, '-0 cannot reuse an approval minted for 0');
  const zeroApplied = await owner.request('/api/commands/invoke', { method: 'POST', headers: zeroHeaders, body: JSON.stringify(zero) });
  assert.equal(zeroApplied.status, 200);

  // Infinities parse from raw JSON text; an approval minted for null cannot
  // execute Infinity and vice versa.
  const nullApproved = { id: 'aide.view.zoomReset', args: null };
  const infinityHeaders = await owner.approve('POST', '/api/commands/invoke', nullApproved, 'task:invoke-inf');
  const infinityAttempt = await owner.request('/api/commands/invoke', { method: 'POST', headers: infinityHeaders, body: '{"id":"aide.view.zoomReset","args":1e999}' });
  assert.equal(infinityAttempt.status, 409, 'Infinity cannot reuse an approval minted for null');
});

test('command args encoder covers the full JSON.parse domain iteratively', async () => {
  const samples: Array<[string, unknown]> = [
    ['omitted', undefined], ['null', null], ['true', true], ['false', false],
    ['zero', 0], ['neg-zero', -0], ['one', 1], ['float', 1.5], ['big', 1e21],
    ['infinity', Infinity], ['neg-infinity', -Infinity], ['empty-string', ''], ['string', 'a\u0000b'],
    ['empty-array', []], ['array', [1, 'two', null, undefined]],
    ['empty-object', {}], ['object', { b: 1, a: { nested: ['x'] } }],
    ['neg-zero-object', { value: -0 }], ['infinity-object', { value: Infinity }]
  ];
  const digests = new Set<string>();
  for (const [, sample] of samples) {
    const digestValue = commandArgsDigest(sample);
    assert.match(digestValue, /^[a-f0-9]{64}$/, 'digest must be full 64-hex');
    digests.add(digestValue);
  }
  assert.equal(digests.size, samples.length, 'every distinct JSON value must digest distinctly');
  assert.equal(commandArgsDigest({ b: 1, a: 2 }), commandArgsDigest({ b: 1, a: 2 }), 'encoder must be deterministic');

  let deep: unknown = 0;
  for (let depth = 0; depth < 200_000; depth++) deep = [deep];
  assert.match(commandArgsDigest(deep), /^[a-f0-9]{64}$/, 'iterative encoder must survive 200k-deep nesting');

  assert.throws(() => commandArgsDigest(NaN), (error: unknown) => error instanceof CommandInvokeError && error.code === 'BAD_REQUEST');
  assert.throws(() => commandArgsDigest(1n), (error: unknown) => error instanceof CommandInvokeError && error.code === 'BAD_REQUEST');
  assert.throws(() => commandArgsDigest(new Map()), (error: unknown) => error instanceof CommandInvokeError && error.code === 'BAD_REQUEST');
  assert.throws(() => commandArgsDigest({ [Symbol('foreign')]: 1 }), (error: unknown) => error instanceof CommandInvokeError && error.code === 'BAD_REQUEST');
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.throws(() => commandArgsDigest(cycle), (error: unknown) => error instanceof CommandInvokeError && error.code === 'BAD_REQUEST');
  const getterObject = {};
  Object.defineProperty(getterObject, 'x', { enumerable: true, get() { throw new Error('getter invoked'); } });
  assert.throws(() => commandArgsDigest(getterObject), (error: unknown) => error instanceof CommandInvokeError && error.code === 'BAD_REQUEST', 'accessors must be rejected without invocation');
});

test('registry and handler digests drift when live registry truth changes', async () => {
  const registry = new CommandRegistry();
  const register = (id: string, handler?: (args: unknown) => unknown) => registry.registerCommand({
    id, title: 'Title', category: 'Category', when: 'true', enablement: 'true', hidden: false,
    handler: handler ?? (() => ({ dispatched: id, surface: 'workbench' }))
  });
  register('aide.commandPalette.show');
  register('aide.quickOpen.show');
  const workspaceName = 'workspace-3n';
  const taskId = 'task:3n-drift';

  const registryBefore = registryDigestFor(registry, workspaceName, taskId);
  const handlerBefore = handlerDigestFor(registry, 'aide.commandPalette.show');
  register('aide.test.drift');
  const registryAfter = registryDigestFor(registry, workspaceName, taskId);
  assert.notEqual(registryAfter, registryBefore, 'registry digest must drift when a command is added');

  register('aide.commandPalette.show', () => ({ dispatched: 'changed', surface: 'workbench' }));
  const handlerAfter = handlerDigestFor(registry, 'aide.commandPalette.show');
  assert.notEqual(handlerAfter, handlerBefore, 'handler digest must drift when the live handler changes');

  const native = new CommandRegistry();
  native.registerCommand({ id: 'aide.native.test', title: 'Title', category: 'Category', when: 'true', enablement: 'true', hidden: false, handler: Math.max as unknown as (args: unknown) => unknown });
  assert.throws(() => handlerDigestFor(native, 'aide.native.test'), (error: unknown) => error instanceof CommandInvokeError && error.code === 'FORBIDDEN');
  const bound = new CommandRegistry();
  bound.registerCommand({ id: 'aide.bound.test', title: 'Title', category: 'Category', when: 'true', enablement: 'true', hidden: false, handler: (() => 1).bind(null) });
  assert.throws(() => handlerDigestFor(bound, 'aide.bound.test'), (error: unknown) => error instanceof CommandInvokeError && error.code === 'FORBIDDEN');
});

test('describeCommandInvoke enforces the pinned allowlist with no wildcard', async () => {
  const registry = new CommandRegistry();
  registry.registerCommand({ id: 'aide.commandPalette.show', title: 'Title', category: 'Category', when: 'true', enablement: 'true', hidden: false, handler: () => ({ dispatched: 'aide.commandPalette.show', surface: 'workbench' }) });
  const allowed = new Set(['aide.commandPalette.show']);
  assert.throws(() => describeCommandInvoke(registry, allowed, 'workspace-3n', 'task:3n', 'aide.quickOpen.show', undefined), (error: unknown) => error instanceof CommandInvokeError && error.code === 'NOT_FOUND');
  assert.throws(() => describeCommandInvoke(registry, allowed, 'workspace-3n', 'task:3n', '', undefined), (error: unknown) => error instanceof CommandInvokeError && error.code === 'BAD_REQUEST');
  const bindings = describeCommandInvoke(registry, allowed, 'workspace-3n', 'task:3n', 'aide.commandPalette.show', { a: 1 });
  assert.match(bindings.args_digest, /^[a-f0-9]{64}$/);
  assert.match(bindings.registry_digest, /^[a-f0-9]{64}$/);
  assert.match(bindings.handler_digest, /^[a-f0-9]{64}$/);
  assert.equal(bindings.id, 'aide.commandPalette.show');
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
