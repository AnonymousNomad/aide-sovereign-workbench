import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, createBm25, rrfFuse } from '../../node/src/services/index-bm25.mjs';
import { chunkFile } from '../../node/src/services/index-chunker.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

function mkWs() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aide-idx-'));
}
function write(ws, rel, content) {
  const abs = path.join(ws, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

test('tokenizer keeps code symbols and drops stopwords', () => {
  const t = tokenize('The validate_payment(user_id) returns $total');
  assert.ok(t.includes('validate_payment'));
  assert.ok(t.includes('user_id'));
  assert.ok(t.includes('$total'));
  assert.ok(!t.includes('the'));
});

test('bm25 ranks exact symbol match above generic prose', () => {
  const docs = [
    'function refundPayment(order) { return gateway.refund(order); }',
    'The system handles payments and orders in a general way for users.',
    'function parseConfig(file) { return JSON.parse(file); }',
  ];
  const bm25 = createBm25(docs);
  const hits = bm25.search('refundPayment');
  assert.equal(hits[0].index, 0);
  assert.equal(hits.length, 1);
});

test('zero-score docs are excluded from search results', () => {
  const bm25 = createBm25(['alpha beta gamma', 'delta epsilon']);
  const hits = bm25.search('unrelated query words zeta');
  assert.equal(hits.length, 0);
});

test('rrf fuses lists with known-answer ordering and k spread', () => {
  const a = [{ id: 'd1', source: 'sparse' }, { id: 'd2', source: 'sparse' }];
  const b = [{ id: 'd1', source: 'dense' }, { id: 'd3', source: 'dense' }];
  const fused = rrfFuse([a, b], { k: 20, limit: 10 });
  assert.equal(fused[0].id, 'd1');
  assert.equal(fused[0].ranks.sparse, 1);
  assert.equal(fused[0].ranks.dense, 1);
  const kSmall = rrfFuse([[{ id: 'x', source: 's' }, { id: 'y', source: 's' }]], { k: 10, limit: 2 });
  const kBig = rrfFuse([[{ id: 'x', source: 's' }, { id: 'y', source: 's' }]], { k: 60, limit: 2 });
  assert.ok(kSmall[0].score - kSmall[1].score > kBig[0].score - kBig[1].score);
});

const fixtureTs = [
  'import fs from "node:fs";',
  '',
  'export function alpha() {',
  ...Array.from({ length: 20 }, (_, i) => `  x(${i});`),
  '}',
  '',
  'export function beta() {',
  '  return "beta";',
  '}',
  '',
  'class Gamma {',
  '  run() { return 1; }',
  '}',
].join('\n');

test('chunker packs whole units, never cuts mid-unit, enriches headers', () => {
  const chunks = chunkFile('src/fixture.ts', fixtureTs);
  assert.ok(chunks.length >= 1);
  const all = chunks.map(c => c.body).join('\n');
  assert.ok(all.includes('x(19);') && all.includes('}'), 'alpha body intact');
  assert.ok(all.includes('run() { return 1; }'), 'Gamma method intact');
  const betaChunk = chunks.find(c => c.body.includes('function beta'));
  assert.ok(betaChunk.body.includes('return "beta";'), 'beta kept whole');
});

test('chunker splits at unit boundary when packing would exceed budget', () => {
  const bigFnA = ['function bigA() {', ...Array.from({ length: 90 }, (_, i) => `  callOne(${i});`), '}'];
  const bigFnB = ['function bigB() {', ...Array.from({ length: 90 }, (_, i) => `  callTwo(${i});`), '}'];
  const src = [...bigFnA, '', ...bigFnB].join('\n');
  const chunks = chunkFile('src/big.js', src);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks[0].body.includes('callOne(59);'), 'first unit complete');
  assert.ok(!chunks[0].body.includes('bigB'), 'boundary respected: A does not bleed into B');
  assert.ok(chunks[chunks.length - 1].body.includes('callTwo(59);'));
});

test('chunker sub-splits oversized unit on blank lines', () => {
  const bigFn = [
    'function huge() {',
    ...Array.from({ length: 200 }, (_, i) => (i % 10 === 9 ? '' : `    deepCall(${i});`)),
    '}',
  ].join('\n');
  const chunks = chunkFile('big.py', bigFn);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(c => nonWs(c.text) <= 1800));
});

function nonWs(s) {
  return s.replace(/\s+/g, '').length;
}

test('stable ids are deterministic across re-chunk', () => {
  const a = chunkFile('src/a.ts', fixtureTs).map(c => c.id);
  const b = chunkFile('src/a.ts', fixtureTs).map(c => c.id);
  assert.deepEqual(a, b);
});

// --- index-store tests ---
import { scanWorkspace, hashFile, persistIndex, loadIndex, normalize, INDEX_VERSION } from '../../node/src/services/index-store.mjs';

test('store: scan skips ignore dirs, binaries and oversized files', () => {
  const ws = mkWs();
  write(ws, 'src/a.ts', 'export const a = 1;\n');
  write(ws, 'node_modules/pkg/index.js', 'module.exports = 1;\n');
  write(ws, '.aide/index/manifest.json', '{}');
  write(ws, 'logo.png', Buffer.from([0x89, 0x50]).toString('binary'));
  fs.mkdirSync(path.join(ws, 'big.bin'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'huge.ts'), 'x'.repeat(600 * 1024));
  const files = scanWorkspace(ws).map(f => f.rel);
  assert.deepEqual(files, ['src/a.ts']);
});

test('store: persist/load roundtrip preserves chunks and vectors', () => {
  const ws = mkWs();
  const dim = 4;
  const vecs = [Float32Array.from([1, 0, 0, 0]), Float32Array.from([0, 1, 0, 0])];
  persistIndex(ws, {
    branch: 'main',
    files: { 'a.ts': 'h1' },
    chunks: [
      { id: 'a.ts#0', path: 'a.ts', line: 1, header: 'a.ts | x', body: 'body one' },
      { id: 'a.ts#1', path: 'a.ts', line: 5, header: 'a.ts | y', body: 'body two' },
    ],
    dim,
    vectors: vecs,
  });
  const loaded = loadIndex(ws);
  assert.ok(loaded);
  assert.equal(loaded.branch, 'main');
  assert.equal(loaded.chunks.length, 2);
  assert.equal(loaded.dim, dim);
  assert.deepEqual([...loaded.vectors[1]], [0, 1, 0, 0]);
});

test('store: normalize yields unit norm', () => {
  const v = normalize([3, 4]);
  assert.ok(Math.abs(Math.hypot(v[0], v[1]) - 1) < 1e-6);
});

test('store: hashFile is stable sha256', () => {
  const ws = mkWs();
  write(ws, 'f.txt', 'hello');
  const h = hashFile(path.join(ws, 'f.txt'));
  assert.equal(h.length, 64);
  assert.equal(hashFile(path.join(ws, 'f.txt')), h);
});

// --- index-service e2e ---
import { createIndexService } from '../../node/src/services/index-service.mjs';

function fakeEmbed(texts) {
  const dim = 8;
  const out = [];
  for (const text of texts) {
    const vec = new Array(dim).fill(0);
    for (const word of text.toLowerCase().split(/[^a-z0-9_$]+/).filter(Boolean)) {
      let h = 0;
      for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      vec[h % dim] += 1;
    }
    out.push(vec);
  }
  return Promise.resolve(out);
}

async function waitFor(predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise(r => setTimeout(r, 25));
  }
  return true;
}

test('service e2e: reindex -> ready -> hybrid ranks exact symbol first', async () => {
  const ws = mkWs();
  write(ws, 'src/pay.ts', 'export function refundPayment(order) {\n  return gateway.refund(order);\n}\n');
  write(ws, 'src/cfg.ts', 'function parseConfig(file) {\n  return JSON.parse(file);\n}\n');
  const events = [];
  const service = createIndexService({ workspace: ws, embed: fakeEmbed, onEvent: e => events.push(e) });
  const started = await service.reindex();
  assert.ok(started.session_id.length > 10);
  assert.ok(await waitFor(() => service.getStatus().state === 'ready'), `state=${JSON.stringify(service.getStatus())}`);
  const st = service.getStatus();
  assert.equal(st.chunks, 2);
  assert.equal(st.branch, null);
  assert.equal(st.files_total, 2);

  const out = await service.hybridSearch('refundPayment', 5);
  assert.equal(out.degraded, false);
  assert.ok(out.results.length >= 1);
  assert.equal(out.results[0].path, 'src/pay.ts');

  const kinds = new Set(events.map(e => e.type));
  assert.ok(kinds.has('progress'));
  assert.ok(kinds.has('ready'));
  assert.ok(events.every(e => e.session_id === started.session_id));
});

test('service: no embed configured -> BM25-only with degraded flag', async () => {
  const ws = mkWs();
  write(ws, 'a.ts', 'function alphaOnly() { return 1; }\n');
  const service = createIndexService({ workspace: ws });
  await service.reindex();
  assert.ok(await waitFor(() => service.getStatus().state === 'ready'));
  const out = await service.hybridSearch('alphaOnly', 5);
  assert.equal(out.degraded, true);
  assert.equal(out.results[0].path, 'a.ts');
});

test('service: failing embedder surfaces honest error state', async () => {
  const ws = mkWs();
  write(ws, 'b.ts', 'function betaFn() { return 2; }\n');
  const events = [];
  const service = createIndexService({
    workspace: ws,
    embed: () => Promise.reject(new Error('embed server down')),
    onEvent: e => events.push(e),
  });
  await service.reindex();
  assert.ok(await waitFor(() => service.getStatus().state === 'error'));
  const st = service.getStatus();
  assert.match(String(st.last_error), /embed server down/);
  assert.ok(events.some(e => e.type === 'error'));
});

test('service: second reindex with no changes touches zero files', async () => {
  const ws = mkWs();
  write(ws, 'c.ts', 'function gammaFn() { return 3; }\n');
  const service = createIndexService({ workspace: ws, embed: fakeEmbed });
  await service.reindex();
  assert.ok(await waitFor(() => service.getStatus().state === 'ready'));
  const chunksBefore = service.getStatus().chunks;
  await service.reindex();
  assert.ok(await waitFor(() => service.getStatus().state === 'ready' && !service.isRunning()));
  assert.equal(service.getStatus().files_total, 0);
  assert.equal(service.getStatus().chunks, chunksBefore);
});

test('service: busy guard rejects concurrent reindex', async () => {
  const ws = mkWs();
  write(ws, 'd.ts', 'function deltaFn() { return 4; }\n'.repeat(200));
  let gate;
  const gatePromise = new Promise(resolve => { gate = resolve; });
  const slowEmbed = texts => gatePromise.then(() => fakeEmbed(texts));
  const service = createIndexService({ workspace: ws, embed: slowEmbed });
  await service.reindex();
  await assert.rejects(() => service.reindex(), err => err.code === 'BUSY');
  gate();
  assert.ok(await waitFor(() => service.getStatus().state === 'ready' && !service.isRunning()));
});
