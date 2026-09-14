import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';
import { pairFixture } from './authority-fixture.ts';
import { Envelope } from '../../common/errors.ts';
import {
  AcademyCatalogResponse,
  AcademySessionResponse,
  AcademyCheckResponse
} from '../../common/contracts/academy.ts';
import { CommunityRoot, CommunityItemResponse } from '../../common/contracts/community.ts';
import { PluginsListResponse, PluginPresetsResponse } from '../../common/contracts/plugins.ts';
import { ReplaysResponse, ReplayAddResponse } from '../../common/contracts/replays.ts';
import { ArtifactsResponse } from '../../common/contracts/artifacts.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-bucket-c-routes-'));
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

async function read(urlPath: string) {
  const response = await owner.request(urlPath);
  return { status: response.status, envelope: Envelope.safeParse(await response.json()) };
}

async function call(method: string, urlPath: string, body: unknown, timeoutMs = 30000) {
  const headers = await owner.approve(method, urlPath, body, `task:${method}:${urlPath}`);
  const response = await owner.request(urlPath, { method, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  return { status: response.status, envelope: Envelope.safeParse(await response.json()) };
}

async function unapproved(method: string, urlPath: string, body: unknown) {
  const response = await owner.request(urlPath, { method, body: JSON.stringify(body) });
  return { status: response.status, envelope: Envelope.safeParse(await response.json()) };
}

async function prepare(method: string, urlPath: string, body: unknown) {
  const response = await owner.request('/api/authority/prepare', {
    method: 'POST',
    body: JSON.stringify({ method, path: urlPath, body, task_id: `task:${method}:${urlPath}` })
  });
  const envelope = Envelope.safeParse(await response.json());
  return { status: response.status, envelope };
}

test('GET /api/academy returns the catalog with progress under the envelope', async () => {
  const { status, envelope } = await read('/api/academy');
  assert.equal(status, 200);
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, true);
  if (!envelope.data.ok) return;
  const payload = AcademyCatalogResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.ok(payload.data.courses.length >= 1);
  const first = payload.data.courses[0];
  assert.ok(first, 'catalog must contain at least one course');
  assert.ok(first.lessons.length >= 1);
  assert.equal(typeof first.progress.eligible_for_certificate, 'boolean');
  assert.deepEqual(first.progress.completed, []);
});

test('GET /api/academy/session?course=... returns the active lesson', async () => {
  const catalog = await read('/api/academy');
  if (!catalog.envelope.success || !catalog.envelope.data.ok) return assert.fail('catalog broken');
  const catalogBody = AcademyCatalogResponse.safeParse(catalog.envelope.data.data);
  if (!catalogBody.success) return assert.fail('catalog payload broken');
  const course = catalogBody.data.courses[0];
  if (!course) return assert.fail('catalog must contain at least one course');
  const courseId = course.id;

  const { status, envelope } = await read(`/api/academy/session?course=${encodeURIComponent(courseId)}`);
  assert.equal(status, 200);
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  if (!envelope.data.ok) return;
  const payload = AcademySessionResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(payload.data.course.id, courseId);
  assert.ok(payload.data.lesson.id);
  assert.deepEqual(payload.data.progress.completed, []);
});

test('POST /api/academy/check rejects an unknown lesson with NOT_FOUND', async () => {
  const { status, envelope } = await call('POST', '/api/academy/check', { courseId: 'python-foundations', lessonId: 'does-not-exist' });
  assert.equal(status, 404);
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, false);
  if (envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'NOT_FOUND');
});

test('POST /api/academy/complete requires a passed check (CONFLICT)', async () => {
  const { status, envelope } = await call('POST', '/api/academy/complete', { courseId: 'python-foundations', lessonId: 'variables' });
  assert.equal(status, 409);
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, false);
  if (envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'CONFLICT');
});

test('GET /api/academy/certificate without completion is CONFLICT', async () => {
  const { status, envelope } = await read('/api/academy/certificate?course=python-foundations');
  assert.equal(status, 409);
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, false);
  if (envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'CONFLICT');
});

test('GET /api/academy/certificate for an unknown course is NOT_FOUND', async () => {
  const { status, envelope } = await read('/api/academy/certificate?course=no-such-course');
  assert.equal(status, 404);
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, false);
  if (envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'NOT_FOUND');
});

test('POST /api/academy/check returns the passed subprocess result shape', async () => {
  const { status, envelope } = await call('POST', '/api/academy/check', { courseId: 'python-foundations', lessonId: 'variables' });
  assert.equal(status, 200);
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  if (!envelope.data.ok) return;
  const payload = AcademyCheckResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(typeof payload.data.passed, 'boolean');
  assert.equal(typeof payload.data.stdout, 'string');
  assert.equal(typeof payload.data.stderr, 'string');
});

test('GET /api/community starts with empty collections', async () => {
  const { status, envelope } = await read('/api/community');
  assert.equal(status, 200);
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  if (!envelope.data.ok) return;
  const payload = CommunityRoot.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(payload.data.schema_version, '1.0');
  assert.deepEqual(payload.data.projects, []);
  assert.deepEqual(payload.data.discussions, []);
});

test('POST /api/community/items adds and DELETE removes a community item', async () => {
  const add = await call('POST', '/api/community/items', { type: 'issues', item: { title: 'bucket c round-trip', detail: 'arch test' } });
  assert.equal(add.status, 200);
  assert.equal(add.envelope.success, true);
  if (!add.envelope.success) return;
  if (!add.envelope.data.ok) return;
  const added = CommunityItemResponse.safeParse(add.envelope.data.data);
  assert.equal(added.success, true);
  if (!added.success) return;
  assert.equal(added.data.item.title, 'bucket c round-trip');
  assert.ok(added.data.item.created_at);

  const remove = await call('DELETE', '/api/community/items', { type: 'issues', index: 0 });
  assert.equal(remove.status, 200);
  assert.equal(remove.envelope.success, true);
  if (!remove.envelope.success || !remove.envelope.data.ok) return assert.fail('remove envelope broken');

  const list = await read('/api/community');
  if (!list.envelope.success || !list.envelope.data.ok) return assert.fail('list envelope broken');
  const after = CommunityRoot.safeParse(list.envelope.data.data);
  if (!after.success) return assert.fail('list payload broken');
  assert.deepEqual(after.data.issues, []);
});

test('POST /api/community/items rejects a disallowed type with BAD_REQUEST', async () => {
  const { status, envelope } = await unapproved('POST', '/api/community/items', { type: 'bogus', item: { title: 'x' } });
  assert.equal(status, 400);
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, false);
  if (envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'BAD_REQUEST');
});

test('bucket-c authority: reads require a paired actor and mutations bind exact content', async () => {
  const anonymous = await fetch(`${base}/api/community`);
  assert.equal(anonymous.status, 403);

  const before = await read('/api/community');
  if (!before.envelope.success || !before.envelope.data.ok) return assert.fail('community read broken');

  const blocked = await unapproved('POST', '/api/community/items', { type: 'issues', item: { title: 'must not land' } });
  assert.equal(blocked.status, 409);
  if (!blocked.envelope.success) return;
  assert.equal(blocked.envelope.data.ok, false);
  if (blocked.envelope.data.ok) return;
  assert.equal(blocked.envelope.data.error.code, 'NOT_READY');
  const afterBlocked = await read('/api/community');
  if (!afterBlocked.envelope.success || !afterBlocked.envelope.data.ok) return assert.fail('community read broken');
  const blockedBody = CommunityRoot.safeParse(afterBlocked.envelope.data.data);
  if (!blockedBody.success) return assert.fail('community payload broken');
  assert.deepEqual(blockedBody.data.issues, [], 'mutation without approval must have zero side effect');

  const original = { type: 'issues', item: { title: 'bound content' } };
  const changed = { type: 'issues', item: { title: 'changed content' } };
  const headers = await owner.approve('POST', '/api/community/items', original, 'task:bound');
  const changedAttempt = await owner.request('/api/community/items', { method: 'POST', headers, body: JSON.stringify(changed) });
  assert.equal(changedAttempt.status, 409, 'changed content cannot reuse approval');
  const boundRun = await owner.request('/api/community/items', { method: 'POST', headers, body: JSON.stringify(original) });
  assert.equal(boundRun.status, 200, 'the exact approved content executes once');
  const replayAttempt = await owner.request('/api/community/items', { method: 'POST', headers, body: JSON.stringify(original) });
  assert.equal(replayAttempt.status, 409, 'consumed approval cannot replay');

  const prepared = await prepare('POST', '/api/community/items', original);
  assert.equal(prepared.status, 200);
  if (!prepared.envelope.success || !prepared.envelope.data.ok) return assert.fail('prepare broken');
  const operation = prepared.envelope.data.data as { kind?: string; risk?: string };
  assert.equal(operation.kind, 'capability.write');
  assert.equal(operation.risk, 'write');

  const pluginExec = await prepare('POST', '/api/plugins/execute', { id: 'workspace-health', payload: {} });
  assert.equal(pluginExec.status, 200);
  if (!pluginExec.envelope.success || !pluginExec.envelope.data.ok) return assert.fail('plugin prepare broken');
  const pluginOperation = pluginExec.envelope.data.data as { kind?: string; risk?: string };
  assert.equal(pluginOperation.kind, 'capability.execute', 'plugin execution must use the execution capability');
  assert.equal(pluginOperation.risk, 'execute');
});

test('GET /api/plugins returns an empty installed set with api_version 1', async () => {
  const { status, envelope } = await read('/api/plugins');
  assert.equal(status, 200);
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  if (!envelope.data.ok) return;
  const payload = PluginsListResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(payload.data.api_version, '1');
  assert.deepEqual(payload.data.plugins, []);
});

test('GET /api/plugins/presets returns the full catalog uninstalled', async () => {
  const { status, envelope } = await read('/api/plugins/presets');
  assert.equal(status, 200);
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  if (!envelope.data.ok) return;
  const payload = PluginPresetsResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.ok(payload.data.presets.length >= 1);
  assert.equal(payload.data.presets.every(preset => preset.installed === false), true);
});

test('plugin scaffold + trust + execute-without-entrypoint round-trips', async () => {
  const presetList = await read('/api/plugins/presets');
  if (!presetList.envelope.success || !presetList.envelope.data.ok) return assert.fail('presets envelope broken');
  const presets = PluginPresetsResponse.safeParse(presetList.envelope.data.data);
  if (!presets.success) return assert.fail('presets payload broken');
  const preset = presets.data.presets[0];
  if (!preset) return assert.fail('preset catalog must not be empty');
  const presetId = preset.id;

  const scaffold = await call('POST', '/api/plugins/scaffold', { id: presetId, approved: true });
  assert.equal(scaffold.status, 200);
  if (!scaffold.envelope.success || !scaffold.envelope.data.ok) return assert.fail('scaffold envelope broken');
  const scaffolded = PluginsListResponse.safeParse(scaffold.envelope.data.data);
  if (!scaffolded.success) return assert.fail('scaffold payload broken');
  assert.equal(scaffolded.data.plugins.some(plugin => plugin.id === presetId), true);

  const trust = await call('POST', '/api/plugins/trust', { id: presetId, trusted: true });
  assert.equal(trust.status, 200);
  if (!trust.envelope.success || !trust.envelope.data.ok) return assert.fail('trust envelope broken');
  const trusted = PluginsListResponse.safeParse(trust.envelope.data.data);
  if (!trusted.success) return assert.fail('trust payload broken');
  const trustedPlugin = trusted.data.plugins.find(plugin => plugin.id === presetId);
  assert.ok(trustedPlugin);
  assert.equal(trustedPlugin.trusted, true);
  assert.equal(trustedPlugin.executable, false);

  const execute = await call('POST', '/api/plugins/execute', { id: presetId, payload: {} });
  assert.equal(execute.status, 400);
  assert.equal(execute.envelope.success, true);
  if (!execute.envelope.success) return;
  assert.equal(execute.envelope.data.ok, false);
  if (execute.envelope.data.ok) return;
  assert.equal(execute.envelope.data.error.code, 'BAD_REQUEST');
});

test('GET /api/replays starts empty and POST adds a metadata-only record', async () => {
  const list = await read('/api/replays');
  assert.equal(list.status, 200);
  assert.equal(list.envelope.success, true);
  if (!list.envelope.success) return;
  if (!list.envelope.data.ok) return;
  const empty = ReplaysResponse.safeParse(list.envelope.data.data);
  assert.equal(empty.success, true);
  if (!empty.success) return;
  assert.equal(empty.data.privacy, 'metadata-only');
  assert.deepEqual(empty.data.replays, []);

  const add = await call('POST', '/api/replays', { task_class: 'plan', model: 'arch-test', status: 'passed' });
  assert.equal(add.status, 200);
  assert.equal(add.envelope.success, true);
  if (!add.envelope.success) return;
  if (!add.envelope.data.ok) return;
  const added = ReplayAddResponse.safeParse(add.envelope.data.data);
  assert.equal(added.success, true);
  if (!added.success) return;
  assert.match(added.data.replay.id, /^replay-/);
  assert.equal(added.data.replay.task_class, 'plan');
});

test('GET /api/artifacts returns the approved evaluation exports', async () => {
  const { status, envelope } = await read('/api/artifacts');
  assert.equal(status, 200);
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  if (!envelope.data.ok) return;
  const payload = ArtifactsResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.deepEqual(payload.data.artifacts, []);
});
