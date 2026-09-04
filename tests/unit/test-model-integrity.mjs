import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sha256File, verifySha256 } = require('../../common/model-integrity.mjs');

function bufferHashHex(content) {
  return createHash('sha256').update(content).digest('hex');
}

test('sha256File returns the deterministic digest and caches by mtime+size', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aide-mi-'));
  try {
    const file = path.join(dir, 'blob.bin');
    await writeFile(file, 'covert-verify');
    const expected = bufferHashHex('covert-verify');
    assert.equal(await sha256File(file), expected);
    const cache = new Map();
    const first = await sha256File(file, cache);
    const second = await sha256File(file, cache);
    assert.equal(first, expected);
    assert.equal(second, expected);
    assert.equal(cache.size, 1);
    assert.equal(cache.get(file).hash, expected);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verifySha256 reports verified, checksum-mismatch, and missing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aide-mi-'));
  try {
    const file = path.join(dir, 'blob.bin');
    await writeFile(file, 'covert-verify');
    const expected = bufferHashHex('covert-verify');

    const ok = await verifySha256(file, expected);
    assert.equal(ok.status, 'verified');
    assert.equal(ok.expected, expected);
    assert.equal(ok.actual, expected);

    const wrongCase = await verifySha256(file, expected.toUpperCase());
    assert.equal(wrongCase.status, 'verified');

    const mismatch = await verifySha256(file, expected.replace(/./, '0'));
    assert.equal(mismatch.status, 'checksum-mismatch');
    assert.equal(mismatch.expected, expected.replace(/./, '0'));
    assert.equal(mismatch.actual, expected);

    const missing = await verifySha256(path.join(dir, 'absent.bin'), expected);
    assert.equal(missing.status, 'missing');
    assert.equal(missing.actual, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
