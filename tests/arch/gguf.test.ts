import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  probeGguf,
  GGUF_V1_UNSUPPORTED,
  GGUF_BAD_MAGIC
} from '../../node/src/services/gguf.ts';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');

function v1File(): Buffer {
  const buf = Buffer.alloc(24);
  buf.write('GGUF', 0, 'utf8');
  buf.writeUInt32LE(1, 4);
  buf.writeBigUInt64LE(0n, 8);
  buf.writeBigUInt64LE(0n, 16);
  return buf;
}

function v3FileWithKeys(kv: Array<{ key: string; value: string }>): Buffer {
  let size = 24;
  const chunks: Buffer[] = [];
  const header = Buffer.alloc(24);
  header.write('GGUF', 0, 'utf8');
  header.writeUInt32LE(3, 4);
  header.writeBigUInt64LE(0n, 8);
  header.writeBigUInt64LE(BigInt(kv.length), 16);
  chunks.push(header);
  for (const { key, value } of kv) {
    const keyBuf = Buffer.from(key, 'utf8');
    const valueBuf = Buffer.from(value, 'utf8');
    const part = Buffer.alloc(8 + keyBuf.length + 4 + 8 + valueBuf.length);
    let off = 0;
    part.writeBigUInt64LE(BigInt(keyBuf.length), off); off += 8;
    keyBuf.copy(part, off); off += keyBuf.length;
    part.writeUInt32LE(8, off); off += 4;
    part.writeBigUInt64LE(BigInt(valueBuf.length), off); off += 8;
    valueBuf.copy(part, off);
    chunks.push(part);
    size += part.length;
  }
  const padding = 32 - (size % 32);
  if (padding < 32) chunks.push(Buffer.alloc(padding));
  return Buffer.concat(chunks);
}

const QWEN_GGUF = path.join(REPO_ROOT, 'models', 'qwen2.5-coder-0.5b-instruct-q4_k_m.gguf');
const SMOLLM_GGUF = path.join(REPO_ROOT, 'models', 'smollm2-360m-instruct-q8_0.gguf');

test('probeGguf reads the real bundled models metadata', async t => {
  if (!existsSync(QWEN_GGUF) || !existsSync(SMOLLM_GGUF)) {
    t.skip('bundled GGUF artifacts are not present in this checkout (models/*.gguf are not committed)');
    return;
  }
  const info = await probeGguf(QWEN_GGUF);
  assert.equal(info.architecture, 'qwen2');
  assert.equal(info.version, 3);
  assert.ok(info.contextLength >= 2048);
  assert.ok(info.blockCount > 0);
  assert.ok(info.embeddingLength > 0);
  assert.ok(info.headCount > 0);
  assert.ok(info.headCountKv > 0);
  assert.ok(info.chatTemplate !== null, 'bundled model must carry a chat template');
  assert.equal(info.fileType, 15);

  const smollm = await probeGguf(SMOLLM_GGUF);
  assert.equal(smollm.architecture, 'llama');
  assert.ok(smollm.chatTemplate !== null);
});

test('probeGguf rejects GGUFv1 files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-gguf-'));
  try {
    const p = path.join(dir, 'v1.gguf');
    await fs.writeFile(p, v1File());
    await assert.rejects(() => probeGguf(p), (error: Error) => error.message === GGUF_V1_UNSUPPORTED);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('probeGguf rejects bad magic and truncated files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-gguf-'));
  try {
    const bad = path.join(dir, 'bad.gguf');
    await fs.writeFile(bad, Buffer.from('XXXX not a model at all, padded long'));
    await assert.rejects(() => probeGguf(bad), (error: Error) => error.message === GGUF_BAD_MAGIC);

    const truncated = path.join(dir, 'trunc.gguf');
    await fs.writeFile(truncated, Buffer.from('GGUF'));
    await assert.rejects(() => probeGguf(truncated), /truncated/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('probeGguf detects a GGUF with no chat template', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-gguf-'));
  try {
    const p = path.join(dir, 'notemplate.gguf');
    await fs.writeFile(p, v3FileWithKeys([
      { key: 'general.architecture', value: 'llama' },
      { key: 'general.name', value: 'no-template-test' }
    ]));
    const info = await probeGguf(p);
    assert.equal(info.architecture, 'llama');
    assert.equal(info.chatTemplate, null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});