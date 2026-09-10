import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import type http from 'node:http';
import { ArchServer } from '../../node/src/server.ts';
import { ModelRuntime, ModelRuntimeError } from '../../node/src/services/model-runtime.ts';
import { routeForModelReady, routeForModelRegister, routeForModelProfile } from '../../node/src/routes/models.ts';
import { Envelope } from '../../common/errors.ts';

let dir: string;
let modelDir: string;
let runtime: ModelRuntime;
let server: ArchServer;
let httpServer: http.Server;
let base: string;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-model-register-'));
  modelDir = path.join(dir, 'models');
  await fs.mkdir(modelDir, { recursive: true });
  await fs.mkdir(path.join(dir, '.aide'), { recursive: true });
  await fs.writeFile(path.join(modelDir, 'manifest.json'), JSON.stringify({ models: [] }), 'utf8');
  await fs.writeFile(path.join(modelDir, 'fantom-4b.gguf'), Buffer.from('4447475546010001f6766f00000000', 'hex'), 'utf8');

  runtime = new ModelRuntime({
    workspace: dir,
    manifestPath: path.join(modelDir, 'manifest.json'),
    ingestedPath: path.join(dir, '.aide', 'ingested-models.json'),
    modelDir
  });
  await runtime.load();

  server = new ArchServer(dir, path.join(dir, '.aide', 'arch-model-register.log'));
  server
    .route(routeForModelReady(runtime))
    .route(routeForModelRegister(runtime))
    .route(routeForModelProfile(runtime));
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.events.close();
  await server.logger.flush();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

function okData(body: unknown): unknown {
  const parsed = Envelope.safeParse(body);
  assert.ok(parsed.success, 'envelope must parse');
  assert.ok(parsed.data.ok, 'envelope must be ok');
  return parsed.data.data;
}

function errorCode(body: unknown): string {
  const parsed = Envelope.safeParse(body);
  assert.ok(parsed.success, 'envelope must parse');
  assert.ok(!parsed.data.ok, 'envelope must be an error');
  return parsed.data.error.code;
}

async function post(pathname: string, body: unknown): Promise<Response> {
  return fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

test('POST /api/models/register adds a gguf engine and is idempotent', async () => {
  const first = await post('/api/models/register', { filename: 'fantom-4b.gguf', repo_id: 'fantom/org', quant_label: 'Q4_K_M', context_tokens: 4096 });
  assert.equal(first.status, 200);
  const firstData = okData(await first.json()) as { id: string; status: string; endpoint: string };
  assert.equal(firstData.id, 'fantom-4b');
  assert.equal(firstData.status, 'ready');
  assert.ok(firstData.endpoint.startsWith('http://127.0.0.1:809'));

  const second = await post('/api/models/register', { filename: 'fantom-4b.gguf' });
  assert.equal(second.status, 200);
  const secondData = okData(await second.json()) as { id: string; status: string; endpoint: string };
  assert.equal(secondData.id, 'fantom-4b');
  assert.equal(secondData.endpoint, firstData.endpoint);
});

test('POST /api/models/register rejects non-gguf and escaping filenames', async () => {
  const nonGguf = await post('/api/models/register', { filename: 'notes.txt' });
  assert.equal(nonGguf.status, 400);
  assert.equal(errorCode(await nonGguf.json()), 'BAD_REQUEST');

  await assert.rejects(
    runtime.register({ filename: '..\\..\\evil.gguf' }),
    (error: unknown) => error instanceof ModelRuntimeError && error.code === 'BAD_REQUEST'
  );
  await assert.rejects(
    runtime.register({ filename: 'missing.gguf' }),
    (error: unknown) => error instanceof ModelRuntimeError && error.code === 'BAD_REQUEST' && error.message.includes('artifact not found')
  );
});

test('POST /api/models/profile applies a preset and writes the sidecar', async () => {
  const res = await post('/api/models/profile', { id: 'fantom-4b', preset: 'balanced' });
  assert.equal(res.status, 200);
  const data = okData(await res.json()) as { id: string; preset: string; saved: boolean };
  assert.equal(data.id, 'fantom-4b');
  assert.equal(data.preset, 'balanced');
  assert.equal(data.saved, true);

  const sidecarPath = path.join(modelDir, 'fantom-4b.gguf.profile.json');
  const sidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf8')) as { preset?: string; samplers?: Record<string, number> };
  assert.equal(sidecar.preset, 'balanced');
  assert.equal(sidecar.samplers?.temperature, 0.7);
});

test('POST /api/models/profile rejects unknown presets and sampler keys', async () => {
  const badPreset = await post('/api/models/profile', { id: 'fantom-4b', preset: 'wildcard' });
  assert.equal(badPreset.status, 400);
  assert.equal(errorCode(await badPreset.json()), 'BAD_REQUEST');

  const badSampler = await post('/api/models/profile', { id: 'fantom-4b', samplers: { temperature: 0.7, do_a_barrel_roll: 1 }, preset: 'custom' });
  assert.equal(badSampler.status, 400);
  assert.equal(errorCode(await badSampler.json()), 'BAD_REQUEST');
});

test('GET /api/model/ready reports not-ready without a server and 400 without id', async () => {
  const res = await fetch(`${base}/api/model/ready?id=fantom-4b`);
  assert.equal(res.status, 200);
  const data = okData(await res.json()) as { id: string; ready: boolean; status: string; endpoint: string };
  assert.equal(data.id, 'fantom-4b');
  assert.equal(data.ready, false);
  assert.ok(data.status === 'not-ready' || data.status === 'conflict', `unexpected status ${data.status}`);
  assert.ok(data.endpoint.startsWith('http://127.0.0.1:809'));

  const noId = await fetch(`${base}/api/model/ready`);
  assert.equal(noId.status, 400);
  assert.equal(errorCode(await noId.json()), 'BAD_REQUEST');
});

test('GET /api/model/ready reports not-ready and an allowlist error for an unknown model', async () => {
  const res = await fetch(`${base}/api/model/ready?id=nope`);
  assert.equal(res.status, 200);
  const data = okData(await res.json()) as { id: string; ready: boolean; status: string; endpoint: string; error?: string };
  assert.equal(data.id, 'nope');
  assert.equal(data.ready, false);
  assert.equal(data.status, 'not-ready');
  assert.equal(data.endpoint, '');
  assert.match(data.error ?? '', /allowlist/);
});