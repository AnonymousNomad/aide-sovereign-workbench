import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { ModelRuntime } from '../../node/src/services/model-runtime.ts';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const MANIFEST = path.join(REPO_ROOT, 'models', 'manifest.json');
const MODEL_DIR = path.join(REPO_ROOT, 'models');
const SMALL_MODEL = path.join(MODEL_DIR, 'qwen2.5-coder-0.5b-instruct-q4_k_m.gguf');
const BUNDLED_MODEL_PRESENT = existsSync(SMALL_MODEL);
const BUNDLED_SKIP_REASON = 'bundled GGUF artifacts are not present in this checkout (models/*.gguf are not committed)';

let dir: string;
let runtime: ModelRuntime;
let pythonReady = false;
const statusEvents: Array<{ id: string; status: string }> = [];

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-mrt-'));
  runtime = new ModelRuntime({
    workspace: dir,
    manifestPath: MANIFEST,
    ingestedPath: path.join(dir, '.aide', 'ingested-models.json'),
    modelDir: MODEL_DIR,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {}
    },
    onStatusChange: (id, status) => statusEvents.push({ id, status })
  });
  await runtime.load();
  pythonReady = await runtime.probePython();
});

after(async () => {
  await runtime.stopAll();
  await fs.rm(dir, { recursive: true, force: true });
});

test('status lists bundled manifest models with runtime flags', async t => {
  if (!BUNDLED_MODEL_PRESENT) {
    t.skip(BUNDLED_SKIP_REASON);
    return;
  }
  const status = await runtime.status();
  assert.ok(Array.isArray(status.models));
  assert.ok(status.models.length >= 3);
  const qwen = status.models.find(entry => entry.id === 'qwen-coder-0.5b-q4');
  assert.ok(qwen, 'bundled qwen 0.5B must be listed');
  assert.equal(qwen.artifact_available, true);
  assert.equal(qwen.ingested, false);
});

test('python runtime probes successfully on this machine', async t => {
  if (!pythonReady) {
    t.skip('python runtime (llama-cpp-python) is not available on this machine');
    return;
  }
  const ready = await runtime.probePython();
  assert.equal(ready, true);
});

test('ingest rejects non-gguf and missing files', async () => {
  await assert.rejects(() => runtime.ingest(path.join(dir, 'missing.gguf')), /not found/);
  const txt = path.join(dir, 'notes.txt');
  await fs.writeFile(txt, 'not a model');
  await assert.rejects(() => runtime.ingest(txt), /only \.gguf/);
});

test('ingest rejects a GGUF without a chat template', async () => {
  const header = Buffer.alloc(24);
  header.write('GGUF', 0, 'utf8');
  header.writeUInt32LE(3, 4);
  header.writeBigUInt64LE(0n, 8);
  header.writeBigUInt64LE(1n, 16);
  const key = Buffer.from('general.architecture', 'utf8');
  const value = Buffer.from('llama', 'utf8');
  const part = Buffer.alloc(8 + key.length + 4 + 8 + value.length);
  let off = 0;
  part.writeBigUInt64LE(BigInt(key.length), off); off += 8;
  key.copy(part, off); off += key.length;
  part.writeUInt32LE(8, off); off += 4;
  part.writeBigUInt64LE(BigInt(value.length), off); off += 8;
  value.copy(part, off);
  const padding = Buffer.alloc(32 - ((24 + part.length) % 32));
  const p = path.join(dir, 'no-template.gguf');
  await fs.writeFile(p, Buffer.concat([header, part, padding]));
  await assert.rejects(() => runtime.ingest(p), /chat_template/);
});

test('ingest registers a real GGUF with a device fit report', async t => {
  if (!BUNDLED_MODEL_PRESENT) {
    t.skip(BUNDLED_SKIP_REASON);
    return;
  }
  const copy = path.join(dir, 'copy-0.5b.gguf');
  await fs.copyFile(SMALL_MODEL, copy);
  const result = await runtime.ingest(copy);
  assert.ok(result.id.length > 0);
  assert.equal(result.quant, 'Q4_K', 'renamed copy falls back to the file_type coarse family');
  assert.ok(result.context_tokens >= 2048);
  assert.ok(result.fit.fileBytes === (await fs.stat(copy)).size);
  assert.ok(result.sha256.length === 64);
  assert.ok(result.endpoint.startsWith('http://127.0.0.1:'));
  const status = (await runtime.status()).models.find(entry => entry.id === result.id);
  assert.ok(status, 'ingested model must appear in status');
  assert.equal(status.ingested, true);
  assert.equal(status.artifact_available, true);
});

test('ingest is idempotent for the same file', async t => {
  if (!BUNDLED_MODEL_PRESENT) {
    t.skip(BUNDLED_SKIP_REASON);
    return;
  }
  const first = await runtime.ingest(path.join(dir, 'copy-0.5b.gguf'));
  const second = await runtime.ingest(path.join(dir, 'copy-0.5b.gguf'));
  assert.equal(first.id, second.id);
  assert.equal(first.endpoint, second.endpoint);
});

test('start rejects an unallowlisted model id', async () => {
  await assert.rejects(() => runtime.start('not-a-model'), /not allowlisted/);
});

test('start refuses an ingested model whose file changed after ingestion', async t => {
  if (!BUNDLED_MODEL_PRESENT) {
    t.skip(BUNDLED_SKIP_REASON);
    return;
  }
  const target = path.join(dir, 'swap-guard.gguf');
  await fs.copyFile(SMALL_MODEL, target);
  const result = await runtime.ingest(target);
  await fs.appendFile(target, Buffer.from('x'));
  await assert.rejects(() => runtime.start(result.id), /hash mismatch/);
});

test('start relocates to a free port when a foreign server squats the endpoint', async t => {
  if (!BUNDLED_MODEL_PRESENT) {
    t.skip(BUNDLED_SKIP_REASON);
    return;
  }
  const target = path.join(dir, 'squat-test.gguf');
  await fs.copyFile(SMALL_MODEL, target);
  const result = await runtime.ingest(target);
  const modelPort = Number(new URL(result.endpoint).port);
  const squatter = await new Promise<{ close: () => Promise<void> }>((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'foreign-model', object: 'model' }] }));
    });
    server.once('error', reject);
    server.listen(modelPort, '127.0.0.1', () => {
      resolve({ close: () => new Promise<void>(done => server.close(() => done())) });
    });
  });
  const started = await runtime.start(result.id);
  assert.equal(started.status, 'starting');
  const entry = runtime.get(result.id);
  assert.ok(entry, 'model must exist');
  assert.notEqual(entry.endpoint, result.endpoint, 'endpoint must relocate away from the squatter');
  const ready = await runtime.waitReady(result.id, 90_000);
  assert.equal(ready, true);
  await runtime.stop(result.id);
  await squatter.close();
});

test('start serves the ingested model for real and stop tears it down', async t => {
  if (!BUNDLED_MODEL_PRESENT) {
    t.skip(BUNDLED_SKIP_REASON);
    return;
  }
  const ingested = await runtime.ingest(path.join(dir, 'copy-0.5b.gguf'));
  const started = await runtime.start(ingested.id);
  assert.equal(started.status, 'starting');
  const ready = await runtime.waitReady(ingested.id, 90_000);
  assert.equal(ready, true);
  const verified = await runtime.verifyEndpointModel(ingested.id);
  assert.equal(verified.ready, true, 'identity check must match the served model');
  const running = (await runtime.status()).models.find(entry => entry.id === ingested.id);
  assert.equal(running?.status, 'running');
  const stopped = await runtime.stop(ingested.id);
  assert.equal(stopped.status, 'stopped');
  const after = (await runtime.status()).models.find(entry => entry.id === ingested.id);
  assert.notEqual(after?.status, 'running');
});
