import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-m-arch-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;

function u32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value);
  return buf;
}

function u64(value: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

function str(value: string): Buffer {
  return Buffer.concat([u64(Buffer.byteLength(value)), Buffer.from(value, 'utf8')]);
}

const TYPE_UINT32 = 4;
const TYPE_STRING = 8;

function kv(key: string, type: number, value: string | number): Buffer {
  if (type === TYPE_STRING) return Buffer.concat([str(key), u32(TYPE_STRING), str(String(value))]);
  return Buffer.concat([str(key), u32(type), u32(Number(value))]);
}

function synthesizeGguf(): Buffer {
  const kvs = [
    kv('general.architecture', TYPE_STRING, 'llama'),
    kv('general.name', TYPE_STRING, 'arch-test'),
    kv('general.file_type', TYPE_UINT32, 1),
    kv('llama.block_count', TYPE_UINT32, 1),
    kv('llama.context_length', TYPE_UINT32, 256)
  ];
  const header = Buffer.concat([Buffer.from('GGUF', 'utf8'), u32(3), u64(0), u64(kvs.length), ...kvs]);
  return Buffer.concat([header, Buffer.alloc(512, 3)]);
}

before(async () => {
  await fs.mkdir(path.join(workspace, 'models'), { recursive: true });
  server = new ArchServer(workspace, path.join(workspace, 'arch-m.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const routes = await buildRoutes(workspace, 'test', {});
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
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

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

async function post<T>(pathName: string, payload: unknown): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${base}${pathName}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function get<T>(pathName: string): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${base}${pathName}`);
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

test('m arch: search enforces strict query contract without network', async () => {
  const missingQ = await get('/api/modelhub/search');
  assert.equal(missingQ.status, 400);
  assert.equal(missingQ.body.ok, false);
  assert.ok(missingQ.body.error);

  const emptyQ = await get('/api/modelhub/search?q=');
  assert.equal(emptyQ.status, 400);

  const badSort = await get('/api/modelhub/search?q=tiny&sort=stars');
  assert.equal(badSort.status, 400);
});

test('m arch: download rejects traversal and malformed repo_id via contract', async () => {
  const traversal = await post('/api/modelhub/download', { repo_id: 'org/repo', filename: '../evil.bin' });
  assert.equal(traversal.status, 400);
  assert.ok(traversal.body.error);

  const badRepo = await post('/api/modelhub/download', { repo_id: 'no-slash', filename: 'model.gguf' });
  assert.equal(badRepo.status, 400);
});

test('m arch: downloads list starts empty and holds shape', async () => {
  const list = await get<{ jobs: Array<{ job_id: string; status: string; bytes_done: number; bytes_total: number | null; error: string | null }> }>('/api/modelhub/downloads');
  assert.equal(list.status, 200);
  assert.equal(list.body.ok, true);
  assert.deepEqual(list.body.data?.jobs, []);
});

test('m arch: cancel of unknown job returns cancelled:false envelope', async () => {
  const result = await post<{ cancelled: boolean }>('/api/modelhub/downloads/cancel', { job_id: 'does-not-exist' });
  assert.equal(result.status, 200);
  assert.equal(result.body.data?.cancelled, false);
});

test('m arch: import e2e copies valid gguf and writes manual manifest', async () => {
  const src = path.join(workspace, 'outside.gguf');
  await fs.writeFile(src, synthesizeGguf());
  const imported = await post<{ manifest: { source: string; status: string; architecture: string; size_bytes: number } }>('/api/models/import', { path: src });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.ok, true);
  assert.equal(imported.body.data?.manifest.source, 'manual');
  assert.equal(imported.body.data?.manifest.status, 'ready');
  assert.equal(imported.body.data?.manifest.architecture, 'llama');

  const manifestOnDisk = JSON.parse(await fs.readFile(path.join(workspace, 'models', 'outside.gguf.manifest.json'), 'utf8'));
  assert.equal(manifestOnDisk.repo_id, 'local-import');

  const bad = path.join(workspace, 'bad.gguf');
  await fs.writeFile(bad, Buffer.from('NOTGGUF!', 'utf8'));
  const rejected = await post('/api/models/import', { path: bad });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error?.code, 'BAD_REQUEST');
});
