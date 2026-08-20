import { promises as fs } from 'node:fs';

export interface GgufInfo {
  version: number;
  architecture: string;
  name: string;
  sizeLabel: string;
  fileType: number;
  license: string;
  quantizationVersion: number | null;
  contextLength: number;
  blockCount: number;
  embeddingLength: number;
  headCount: number;
  headCountKv: number;
  chatTemplate: string | null;
  addBosToken: boolean | null;
  bosTokenId: number | null;
  eosTokenId: number | null;
}

export const GGUF_V1_UNSUPPORTED = 'GGUFv1 is no longer supported';
export const GGUF_BAD_MAGIC = 'not a GGUF file (bad magic)';
export const GGUF_BAD_VERSION = 'unsupported GGUF version';

const CHUNK = 64 * 1024;
const MAX_HEADER_POS = 16 * 1024 * 1024;
const MAX_STRING = 4 * 1024 * 1024;
const ELEMENT_SIZES = [1, 1, 2, 2, 4, 4, 4, 1, 0, 0, 8, 8, 8];

function readUint64(buf: Buffer, off: number): number {
  const value = buf.readBigUInt64LE(off);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('gguf value out of range');
  return Number(value);
}

function readNumber(buf: Buffer, off: number, type: number): number {
  switch (type) {
    case 0: return buf.readUInt8(off);
    case 1: return buf.readInt8(off);
    case 2: return buf.readUInt16LE(off);
    case 3: return buf.readInt16LE(off);
    case 4: return buf.readUInt32LE(off);
    case 5: return buf.readInt32LE(off);
    case 6: return buf.readFloatLE(off);
    case 7: return buf.readUInt8(off);
    case 10: return readUint64(buf, off);
    case 11: return Number(buf.readBigInt64LE(off));
    case 12: return buf.readDoubleLE(off);
    default: return 0;
  }
}

export async function probeGguf(filePath: string): Promise<GgufInfo> {
  const handle = await fs.open(filePath, 'r');
  let pos = 0;
  let window = Buffer.alloc(0);

  const ensure = async (bytes: number): Promise<void> => {
    while (window.length < bytes) {
      if (pos + window.length >= MAX_HEADER_POS) throw new Error('gguf header exceeds limit');
      const chunk = Buffer.alloc(CHUNK);
      const { bytesRead } = await handle.read(chunk, 0, CHUNK, pos + window.length);
      if (bytesRead === 0) throw new Error('gguf file truncated');
      window = window.length === 0 ? chunk.subarray(0, bytesRead) : Buffer.concat([window, chunk.subarray(0, bytesRead)]);
    }
  };

  const take = (bytes: number): Buffer => {
    const out = window.subarray(0, bytes);
    window = window.subarray(bytes);
    pos += bytes;
    return out;
  };

  const skip = (bytes: number): void => {
    pos += bytes;
    window = Buffer.alloc(0);
  };

  try {
    await ensure(24);
    if (window.toString('utf8', 0, 4) !== 'GGUF') throw new Error(GGUF_BAD_MAGIC);
    const version = window.readUInt32LE(4);
    if (version === 1) throw new Error(GGUF_V1_UNSUPPORTED);
    if (version < 2 || version > 3) throw new Error(`${GGUF_BAD_VERSION}: v${version}`);
    const kvCount = readUint64(window, 16);
    take(24);

    let architecture = '';
    const info: Partial<GgufInfo> = { version };

    for (let i = 0; i < kvCount; i++) {
      await ensure(16);
      const keyLen = readUint64(window, 0);
      take(8);
      await ensure(keyLen + 4);
      const key = window.toString('utf8', 0, keyLen);
      take(keyLen);
      const type = window.readUInt32LE(0);
      take(4);

      if (type === 8) {
        await ensure(8);
        const valueLen = readUint64(window, 0);
        take(8);
        if (valueLen > MAX_STRING) throw new Error('gguf string value exceeds limit');
        await ensure(valueLen);
        const value = window.toString('utf8', 0, valueLen);
        take(valueLen);
        if (key === 'general.architecture') {
          architecture = value;
          info.architecture = value;
        } else if (key === 'general.name') info.name = value;
        else if (key === 'general.size_label') info.sizeLabel = value;
        else if (key === 'general.license') info.license = value;
        else if (key === 'tokenizer.chat_template') info.chatTemplate = value;
      } else if (type === 9) {
        await ensure(12);
        const elType = window.readUInt32LE(0);
        const count = readUint64(window, 4);
        take(12);
        if (elType === 8) {
          for (let j = 0; j < count; j++) {
            await ensure(8);
            const elLen = readUint64(window, 0);
            if (elLen > MAX_STRING) throw new Error('gguf array element exceeds limit');
            take(8);
            skip(elLen);
          }
        } else {
          const size = ELEMENT_SIZES[elType] ?? 0;
          skip(size * count);
        }
      } else {
        await ensure(ELEMENT_SIZES[type] ?? 0);
        const value = readNumber(window, 0, type);
        take(ELEMENT_SIZES[type] ?? 0);
        if (architecture.length > 0) {
          const prefix = `${architecture}.`;
          if (key === `${prefix}context_length`) info.contextLength = value;
          else if (key === `${prefix}block_count`) info.blockCount = value;
          else if (key === `${prefix}embedding_length`) info.embeddingLength = value;
          else if (key === `${prefix}attention.head_count`) info.headCount = value;
          else if (key === `${prefix}attention.head_count_kv`) info.headCountKv = value;
        }
        if (key === 'general.file_type') info.fileType = value;
        else if (key === 'general.quantization_version') info.quantizationVersion = value;
        else if (key === 'tokenizer.ggml.bos_token_id') info.bosTokenId = value;
        else if (key === 'tokenizer.ggml.eos_token_id') info.eosTokenId = value;
        else if (key === 'tokenizer.ggml.add_bos_token') info.addBosToken = value === 1;
      }
      if (pos > MAX_HEADER_POS) throw new Error('gguf header exceeds limit');
    }

    const result = info as GgufInfo;
    if (result.architecture === undefined) throw new Error('gguf missing general.architecture');
    result.chatTemplate = result.chatTemplate ?? null;
    result.quantizationVersion = result.quantizationVersion ?? null;
    result.addBosToken = result.addBosToken ?? null;
    result.bosTokenId = result.bosTokenId ?? null;
    result.eosTokenId = result.eosTokenId ?? null;
    return result;
  } finally {
    await handle.close();
  }
}