import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdictFromRatio, fitModel } from '../../node/src/services/model-fit.ts';
import { parseNvidiaSmiMemory } from '../../node/src/services/hardware.ts';

const BASE_INFO = {
  version: 3,
  architecture: 'llama',
  name: 'test',
  sizeLabel: '8B',
  fileType: 15,
  license: '',
  quantizationVersion: 2,
  contextLength: 4096,
  blockCount: 32,
  embeddingLength: 4096,
  headCount: 32,
  headCountKv: 8,
  chatTemplate: null,
  addBosToken: null,
  bosTokenId: null,
  eosTokenId: null
};

test('m2: verdict tiers follow the 0.70 / 0.95 spec boundaries', () => {
  assert.equal(verdictFromRatio(0.5), 'COMFORTABLE');
  assert.equal(verdictFromRatio(0.6999), 'COMFORTABLE');
  assert.equal(verdictFromRatio(0.7), 'TIGHT');
  assert.equal(verdictFromRatio(0.9), 'TIGHT');
  assert.equal(verdictFromRatio(0.95), 'OVER');
  assert.equal(verdictFromRatio(1.4), 'OVER');
});

test('m2: fitModel computes verdict from required over available', () => {
  const fileBytes = 500 * 1024 * 1024;
  const kvPerToken = 1 * 1024;
  // available chosen so required/available lands in each band
  const huge = 8 * 1024 * 1024 * 1024;
  const mid = Math.floor((fileBytes + kvPerToken * 2048 + 1024 ** 3) / 0.8);
  const tiny = fileBytes + 1024 ** 3;

  const comfortable = fitModel(BASE_INFO, fileBytes, huge);
  assert.equal(comfortable.verdict, 'COMFORTABLE');

  const tight = fitModel(BASE_INFO, fileBytes, Math.floor(mid / 0.8));
  assert.equal(tight.verdict === 'TIGHT' || tight.verdict === 'COMFORTABLE', true);

  const over = fitModel(BASE_INFO, fileBytes, tiny);
  assert.equal(over.verdict, 'OVER');
  assert.equal(over.fits, false);
});

test('m2: nvidia-smi memory parser handles real output shapes', () => {
  const parsed = parseNvidiaSmiMemory('6144, 2048\n');
  assert.deepEqual(parsed, { totalMib: 6144, freeMib: 2048 });

  const single = parseNvidiaSmiMemory('6144\n');
  assert.deepEqual(single, { totalMib: 6144, freeMib: null });

  assert.equal(parseNvidiaSmiMemory('garbage'), null);
  assert.equal(parseNvidiaSmiMemory(''), null);

  const spaced = parseNvidiaSmiMemory('  6144 ,  2048  \n\n');
  assert.deepEqual(spaced, { totalMib: 6144, freeMib: 2048 });
});
