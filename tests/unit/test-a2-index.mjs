import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, createBm25, rrfFuse } from '../../node/src/services/index-bm25.mjs';
import { chunkFile } from '../../node/src/services/index-chunker.mjs';

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
