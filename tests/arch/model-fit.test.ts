import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kvBytesPerToken,
  headDimFor,
  parseParameters,
  quantFromFileName,
  quantFor,
  fitModel,
  estimateQuantBytes,
  BUFFER_MARGIN_BYTES
} from '../../node/src/services/model-fit.ts';
import type { GgufInfo } from '../../node/src/services/gguf.ts';

const qwen1_5: GgufInfo = {
  version: 3,
  architecture: 'qwen2',
  name: 'Qwen2.5-Coder-1.5B-Instruct-GGUF',
  sizeLabel: '1.5B',
  fileType: 15,
  license: 'Apache-2.0',
  quantizationVersion: 2,
  contextLength: 32768,
  blockCount: 28,
  embeddingLength: 1536,
  headCount: 12,
  headCountKv: 2,
  chatTemplate: '{% for message in messages %}',
  addBosToken: false,
  bosTokenId: 151643,
  eosTokenId: 151645
};

test('kvBytesPerToken matches the verified Ollama formula', () => {
  assert.equal(kvBytesPerToken(28, 2, 128), 28 * 2 * 128 * 2 * 2);
  assert.equal(kvBytesPerToken(24, 2, 64), 12_288);
  assert.equal(kvBytesPerToken(32, 5, 64), 40_960);
});

test('headDimFor derives head dimension from embedding and head count', () => {
  assert.equal(headDimFor(qwen1_5), 128);
  assert.equal(headDimFor({ embeddingLength: 896, headCount: 14 }), 64);
  assert.equal(headDimFor({ embeddingLength: 1536, headCount: 0 }), 0);
});

test('parseParameters reads size labels', () => {
  assert.equal(parseParameters('1.5B'), 1.5e9);
  assert.equal(parseParameters('360M'), 360e6);
  assert.equal(parseParameters('0.5B'), 0.5e9);
  assert.equal(parseParameters('nonsense'), null);
});

test('quantFromFileName parses the encoding suffix', () => {
  assert.equal(quantFromFileName('qwen2.5-coder-1.5b-instruct-q4_k_m.gguf'), 'Q4_K_M');
  assert.equal(quantFromFileName('smollm2-360m-instruct-q8_0.gguf'), 'Q8_0');
  assert.equal(quantFromFileName('model-f16.gguf'), 'F16');
  assert.equal(quantFromFileName('model.gguf'), 'unknown');
});

test('quantFor falls back to the file_type coarse family for renamed files', () => {
  assert.equal(quantFor('model.gguf', 15), 'Q4_K');
  assert.equal(quantFor('model.gguf', 7), 'Q8_0');
  assert.equal(quantFor('model-q4_k_m.gguf', 7), 'Q4_K_M', 'filename suffix wins over file_type');
  assert.equal(quantFor('model.gguf', 999), 'unknown');
});

test('fitModel picks the largest context tier that fits 80% of free RAM', () => {
  const bigMachine = fitModel(qwen1_5, 1_117_320_768, 16 * 1024 ** 3);
  assert.equal(bigMachine.fits, true);
  assert.equal(bigMachine.contextLength, 32768, '16GB machine fits the full 32k ctx (1.04GB weights + 0.88GB KV + 1GB margin)');
  assert.equal(bigMachine.kvBytesPerToken, 28_672);
  assert.equal(bigMachine.recommendedQuant, 'Q8_0', '16GB free can afford Q8_0 for 1.5B');

  const midMachine = fitModel(qwen1_5, 1_117_320_768, 3.5 * 1024 ** 3);
  assert.equal(midMachine.contextLength, 16384, '3.5GB free shrinks to 16384 ctx');

  const tightMachine = fitModel(qwen1_5, 1_117_320_768, 2 * 1024 ** 3);
  assert.equal(tightMachine.contextLength, 2048);
  assert.equal(tightMachine.fits, false, '2GB free cannot fit the model plus margin');
});

test('fitModel caps context at the model maximum', () => {
  const small = fitModel({ ...qwen1_5, contextLength: 4096 }, 500_000_000, 32 * 1024 ** 3);
  assert.equal(small.contextLength, 4096, 'never exceeds the GGUF metadata context');
  assert.equal(small.maxContextLength, 4096);
});

test('estimateQuantBytes scales with bits per weight', () => {
  const q4 = estimateQuantBytes(1.5e9, 4.5)!;
  const q8 = estimateQuantBytes(1.5e9, 8)!;
  assert.ok(q8 > q4);
  assert.ok(q4 > 1.5e9 / 8 * 4);
  assert.equal(estimateQuantBytes(null, 4.5), null);
  assert.ok(BUFFER_MARGIN_BYTES === 1024 ** 3);
});
