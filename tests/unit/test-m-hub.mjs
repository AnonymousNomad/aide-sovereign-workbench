import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHubService } from '../../node/src/services/modelhub.mjs';
import { logEgress } from '../../node/src/services/egress-journal.mjs';
import { probeGguf } from '../../node/src/services/gguf.ts';

let tmpRoot;
let ws;
let modelsDir;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-m-hub-'));
  ws = path.join(tmpRoot, 'ws');
  modelsDir = path.join(ws, 'models');
  await fs.mkdir(modelsDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function u32(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value);
  return buf;
}

function u64(value) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

function str(value) {
  return Buffer.concat([u64(Buffer.byteLength(value)), Buffer.from(value, 'utf8')]);
}

const TYPE_UINT32 = 4;
const TYPE_STRING = 8;

function kv(key, type, value) {
  if (type === TYPE_STRING) return Buffer.concat([str(key), u32(TYPE_STRING), str(value)]);
  return Buffer.concat([str(key), u32(type), u32(value)]);
}

function synthesizeGguf({ architecture = 'llama', blockCount = 2 } = {}) {
  const kvs = [
    kv('general.architecture', TYPE_STRING, architecture),
    kv('general.name', TYPE_STRING, 'tiny-test'),
    kv('general.file_type', TYPE_UINT32, 1)
  ];
  if (architecture === 'llama') {
    kvs.push(kv(`${architecture}.block_count`, TYPE_UINT32, blockCount));
    kvs.push(kv(`${architecture}.context_length`, TYPE_UINT32, 512));
  }
  const header = Buffer.concat([
    Buffer.from('GGUF', 'utf8'),
    u32(3),
    u64(0),
    u64(kvs.length),
    ...kvs
  ]);
  return Buffer.concat([header, Buffer.alloc(1024, 7)]);
}

const HF_FIXTURE = [
  { id: 'testorg/tiny-gguf', downloads: 12345, likes: 42, tags: ['gguf', 'llama'] },
  { id: 'otherorg/small-gguf', downloads: 999, likes: 7, tags: ['gguf'] }
];

test('m1: search maps HF fixture through injectable fetcher and journals egress before call', async () => {
  let called = false;
  const hub = createHubService({
    workspace: ws,
    modelsDir,
    fetchImpl: async () => {
      called = true;
      return {
        ok: true,
        status: 200,
        json: async () => HF_FIXTURE
      };
    }
  });
  const result = await hub.search('tiny', 'downloads', 20);
  assert.equal(called, true);
  assert.deepEqual(result.models.map(m => m.repo_id).sort(), ['otherorg/small-gguf', 'testorg/tiny-gguf']);
  assert.equal(result.models[0].downloads >= result.models[1].downloads, true);
  const journalPath = path.join(ws, '.aide', 'egress', 'journal.jsonl');
  const journal = await fs.readFile(journalPath, 'utf8');
  assert.match(journal, /huggingface\.co\/api\/models/);
});

test('m1: happy-path download streams to final file with manifest and no .part left', { timeout: 15000 }, async () => {
  const payload = Buffer.alloc(64 * 1024, 0xAB);
  const server = http.createServer((_req, res) => {
    res.setHeader('content-length', String(payload.length));
    res.setHeader('etag', '"abc123"');
    res.end(payload);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const hub = createHubService({
    workspace: ws,
    modelsDir,
    fetchImpl: (url, options) => fetch(url, options)
  });
  try {
    await hub.startDownload({
      repo_id: 'testorg/tiny-gguf',
      filename: 'tiny-q4.gguf',
      quant_label: 'Q4_K_M',
      urlTemplate: `http://127.0.0.1:${port}/resolve/main/{filename}`
    });
    const doneEvent = hub.listEvents().find(event => event.event === 'done');
    assert.ok(doneEvent, 'expected a done event');
    assert.equal(doneEvent.bytes_total, payload.length);

    const saved = await fs.readFile(path.join(modelsDir, 'tiny-q4.gguf'));
    assert.equal(saved.equals(payload), true);
    await assert.rejects(() => fs.access(path.join(modelsDir, 'tiny-q4.gguf.part')));

    const manifest = JSON.parse(await fs.readFile(path.join(modelsDir, 'tiny-q4.gguf.manifest.json'), 'utf8'));
    assert.equal(manifest.repo_id, 'testorg/tiny-gguf');
    assert.equal(manifest.size_bytes, payload.length);
    assert.equal(manifest.source, 'hf');
    assert.equal(manifest.status, 'ready');
    assert.equal(manifest.etag, '"abc123"');

    const jobs = hub.listDownloads();
    assert.equal(jobs[0].status, 'done');
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

test('m1: interrupted download auto-resumes via Range request and completes', { timeout: 20000 }, async () => {
  const payload = Buffer.alloc(48 * 1024, 0xCD);
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    if (requests === 1) {
      res.setHeader('content-length', String(payload.length));
      res.write(payload.subarray(0, 16 * 1024));
      setTimeout(() => res.destroy(), 50);
    } else {
      const match = /bytes=(\d+)-/.exec(req.headers.range ?? '');
      const start = match ? Number(match[1]) : 0;
      if (start === 0) {
        res.statusCode = 416;
        res.end();
        return;
      }
      res.statusCode = 206;
      res.setHeader('content-length', String(payload.length - start));
      res.end(payload.subarray(start));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const hub = createHubService({
    workspace: ws,
    modelsDir,
    fetchImpl: (url, options) => fetch(url, options)
  });
  try {
    await hub.startDownload({
      repo_id: 'testorg/resume',
      filename: 'resume.bin',
      quant_label: null,
      urlTemplate: `http://127.0.0.1:${port}/resolve/main/{filename}`
    });
    const doneEvent = hub.listEvents().find(event => event.event === 'done');
    assert.ok(doneEvent, 'expected done after resume');
    assert.equal(doneEvent.bytes_total, payload.length);
    const saved = await fs.readFile(path.join(modelsDir, 'resume.bin'));
    assert.equal(saved.equals(payload), true);
    assert.equal(requests >= 2, true, 'expected at least two HTTP requests');
    const errorEvents = hub.listEvents().filter(event => event.event === 'error');
    assert.equal(errorEvents.length >= 1, true, 'the interruption should surface as an error event before recovery');
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

test('m1: cancel aborts mid-stream, deletes .part, emits cancelled and never done', { timeout: 12000 }, async () => {
  const server = http.createServer((_req, res) => {
    res.setHeader('content-length', String(10 * 1024 * 1024));
    const timer = setInterval(() => res.write(Buffer.alloc(64 * 1024, 0x11)), 20);
    res.on('close', () => clearInterval(timer));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const hub = createHubService({
    workspace: ws,
    modelsDir,
    fetchImpl: (url, options) => fetch(url, options)
  });
  try {
    const jobPromise = hub.startDownload({
      repo_id: 'testorg/slow',
      filename: 'slow.bin',
      quant_label: null,
      urlTemplate: `http://127.0.0.1:${port}/resolve/main/{filename}`
    });
    jobPromise.catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 400));
    const running = hub.listDownloads().find(job => job.status === 'running');
    assert.ok(running, 'expected a running download');
    const cancelled = await hub.cancel(running.job_id);
    assert.equal(cancelled.cancelled, true);
    await jobPromise;
    await new Promise(resolve => setTimeout(resolve, 200));
    await assert.rejects(() => fs.access(path.join(modelsDir, 'slow.bin.part')));
    await assert.rejects(() => fs.access(path.join(modelsDir, 'slow.bin')));
    const events = hub.listEvents();
    assert.equal(events.some(event => event.event === 'cancelled'), true);
    assert.equal(events.some(event => event.event === 'done'), false);
    assert.equal(hub.listDownloads()[0].status, 'cancelled');
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

test('m3: import valid gguf copies into models dir; invalid rejects; unsupported arch flagged', async () => {
  const src = path.join(tmpRoot, 'outside.gguf');
  await fs.writeFile(src, synthesizeGguf());
  const hub = createHubService({ workspace: ws, modelsDir });

  const imported = await hub.importFromPath(src);
  assert.equal(imported.manifest.source, 'manual');
  assert.equal(imported.manifest.status, 'ready');
  assert.equal(imported.manifest.architecture, 'llama');
  const copied = await fs.readFile(path.join(modelsDir, 'outside.gguf'));
  const original = await fs.readFile(src);
  assert.equal(copied.equals(original), true);

  const bad = path.join(tmpRoot, 'bad.gguf');
  await fs.writeFile(bad, Buffer.from('NOTGGUFL!', 'utf8'));
  await assert.rejects(
    () => hub.importFromPath(bad),
    error => error != null && typeof error === 'object' && error.code === 'IMPORT_INVALID'
  );

  const weird = path.join(tmpRoot, 'weird.gguf');
  await fs.writeFile(weird, synthesizeGguf({ architecture: 'madeupspec' }));
  const flagged = await hub.importFromPath(weird);
  assert.equal(flagged.manifest.status, 'unsupported-runtime');

  const parsed = await probeGguf(path.join(modelsDir, 'outside.gguf'));
  assert.equal(parsed.blockCount, 2);
});

test('egress journal appends structured entries', async () => {
  logEgress(ws, { action: 'modelhub.search', url: 'https://example.test/x' });
  logEgress(ws, { action: 'modelhub.download', url: 'https://example.test/y' });
  const lines = (await fs.readFile(path.join(ws, '.aide', 'egress', 'journal.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  const entry = JSON.parse(lines[1]);
  assert.equal(entry.action, 'modelhub.download');
  assert.equal(typeof entry.ts, 'string');
});
