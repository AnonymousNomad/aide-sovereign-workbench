import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';
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

test('GET /api/academy returns the catalog with progress under the envelope', async () => {
  const response = await fetch(`${base}/api/academy`);
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
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
  const catalog = await fetch(`${base}/api/academy`);
  const catalogEnvelope = Envelope.safeParse(await catalog.json());
  if (!catalogEnvelope.success || !catalogEnvelope.data.ok) return assert.fail('catalog broken');
  const catalogBody = AcademyCatalogResponse.safeParse(catalogEnvelope.data.data);
  if (!catalogBody.success) return assert.fail('catalog payload broken');
  const course = catalogBody.data.courses[0];
  if (!course) return assert.fail('catalog must contain at least one course');
  const courseId = course.id;

  const response = await fetch(`${base}/api/academy/session?course=${encodeURIComponent(courseId)}`);
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
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
  const response = await fetch(`${base}/api/academy/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ courseId: 'python-foundations', lessonId: 'does-not-exist' })
  });
  assert.equal(response.status, 404);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, false);
  if (envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'NOT_FOUND');
});

test('POST /api/academy/complete requires a passed check (CONFLICT)', async () => {
  const response = await fetch(`${base}/api/academy/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ courseId: 'python-foundations', lessonId: 'variables' })
  });
  assert.equal(response.status, 409);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, false);
  if (envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'CONFLICT');
});

test('GET /api/academy/certificate without completion is CONFLICT', async () => {
  const response = await fetch(`${base}/api/academy/certificate?course=python-foundations`);
  assert.equal(response.status, 409);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, false);
  if (envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'CONFLICT');
});

test('GET /api/academy/certificate for an unknown course is NOT_FOUND', async () => {
  const response = await fetch(`${base}/api/academy/certificate?course=no-such-course`);
  assert.equal(response.status, 404);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, false);
  if (envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'NOT_FOUND');
});

test('POST /api/academy/check returns the passed subprocess result shape', async () => {
  const response = await fetch(`${base}/api/academy/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ courseId: 'python-foundations', lessonId: 'variables' })
  });
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
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
  const response = await fetch(`${base}/api/community`);
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
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
  const add = await fetch(`${base}/api/community/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'issues', item: { title: 'bucket c round-trip', detail: 'arch test' } })
  });
  assert.equal(add.status, 200);
  const addEnvelope = Envelope.safeParse(await add.json());
  assert.equal(addEnvelope.success, true);
  if (!addEnvelope.success) return;
  if (!addEnvelope.data.ok) return;
  const added = CommunityItemResponse.safeParse(addEnvelope.data.data);
  assert.equal(added.success, true);
  if (!added.success) return;
  assert.equal(added.data.item.title, 'bucket c round-trip');
  assert.ok(added.data.item.created_at);

  const remove = await fetch(`${base}/api/community/items`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'issues', index: 0 })
  });
  assert.equal(remove.status, 200);
  const removeEnvelope = Envelope.safeParse(await remove.json());
  if (!removeEnvelope.success || !removeEnvelope.data.ok) return assert.fail('remove envelope broken');

  const list = await fetch(`${base}/api/community`);
  const listEnvelope = Envelope.safeParse(await list.json());
  if (!listEnvelope.success || !listEnvelope.data.ok) return assert.fail('list envelope broken');
  const after = CommunityRoot.safeParse(listEnvelope.data.data);
  if (!after.success) return assert.fail('list payload broken');
  assert.deepEqual(after.data.issues, []);
});

test('POST /api/community/items rejects a disallowed type with BAD_REQUEST', async () => {
  const response = await fetch(`${base}/api/community/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'bogus', item: { title: 'x' } })
  });
  assert.equal(response.status, 400);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  assert.equal(envelope.data.ok, false);
  if (envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'BAD_REQUEST');
});

test('GET /api/plugins returns an empty installed set with api_version 1', async () => {
  const response = await fetch(`${base}/api/plugins`);
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
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
  const response = await fetch(`${base}/api/plugins/presets`);
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
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
  const presetList = await fetch(`${base}/api/plugins/presets`);
  const presetEnvelope = Envelope.safeParse(await presetList.json());
  if (!presetEnvelope.success || !presetEnvelope.data.ok) return assert.fail('presets envelope broken');
  const presets = PluginPresetsResponse.safeParse(presetEnvelope.data.data);
  if (!presets.success) return assert.fail('presets payload broken');
  const preset = presets.data.presets[0];
  if (!preset) return assert.fail('preset catalog must not be empty');
  const presetId = preset.id;

  const scaffold = await fetch(`${base}/api/plugins/scaffold`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: presetId, approved: true })
  });
  assert.equal(scaffold.status, 200);
  const scaffoldEnvelope = Envelope.safeParse(await scaffold.json());
  if (!scaffoldEnvelope.success || !scaffoldEnvelope.data.ok) return assert.fail('scaffold envelope broken');
  const scaffolded = PluginsListResponse.safeParse(scaffoldEnvelope.data.data);
  if (!scaffolded.success) return assert.fail('scaffold payload broken');
  assert.equal(scaffolded.data.plugins.some(plugin => plugin.id === presetId), true);

  const trust = await fetch(`${base}/api/plugins/trust`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: presetId, trusted: true })
  });
  assert.equal(trust.status, 200);
  const trustEnvelope = Envelope.safeParse(await trust.json());
  if (!trustEnvelope.success || !trustEnvelope.data.ok) return assert.fail('trust envelope broken');
  const trusted = PluginsListResponse.safeParse(trustEnvelope.data.data);
  if (!trusted.success) return assert.fail('trust payload broken');
  const trustedPlugin = trusted.data.plugins.find(plugin => plugin.id === presetId);
  assert.ok(trustedPlugin);
  assert.equal(trustedPlugin.trusted, true);
  assert.equal(trustedPlugin.executable, false);

  const execute = await fetch(`${base}/api/plugins/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: presetId, payload: {} })
  });
  assert.equal(execute.status, 400);
  const executeEnvelope = Envelope.safeParse(await execute.json());
  assert.equal(executeEnvelope.success, true);
  if (!executeEnvelope.success) return;
  assert.equal(executeEnvelope.data.ok, false);
  if (executeEnvelope.data.ok) return;
  assert.equal(executeEnvelope.data.error.code, 'BAD_REQUEST');
});

test('GET /api/replays starts empty and POST adds a metadata-only record', async () => {
  const list = await fetch(`${base}/api/replays`);
  assert.equal(list.status, 200);
  const listEnvelope = Envelope.safeParse(await list.json());
  assert.equal(listEnvelope.success, true);
  if (!listEnvelope.success) return;
  if (!listEnvelope.data.ok) return;
  const empty = ReplaysResponse.safeParse(listEnvelope.data.data);
  assert.equal(empty.success, true);
  if (!empty.success) return;
  assert.equal(empty.data.privacy, 'metadata-only');
  assert.deepEqual(empty.data.replays, []);

  const add = await fetch(`${base}/api/replays`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task_class: 'plan', model: 'arch-test', status: 'passed' })
  });
  assert.equal(add.status, 200);
  const addEnvelope = Envelope.safeParse(await add.json());
  assert.equal(addEnvelope.success, true);
  if (!addEnvelope.success) return;
  if (!addEnvelope.data.ok) return;
  const added = ReplayAddResponse.safeParse(addEnvelope.data.data);
  assert.equal(added.success, true);
  if (!added.success) return;
  assert.match(added.data.replay.id, /^replay-/);
  assert.equal(added.data.replay.task_class, 'plan');
});

test('GET /api/artifacts returns the approved evaluation exports', async () => {
  const response = await fetch(`${base}/api/artifacts`);
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success) return;
  if (!envelope.data.ok) return;
  const payload = ArtifactsResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.deepEqual(payload.data.artifacts, []);
});
