import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const INDEX_VERSION = 1;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_CHUNKS = 50_000;

const SKIP_DIRS = new Set(['.git', '.aide', 'node_modules', 'dist', 'out', '.venv', '__pycache__']);
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.pdf', '.zip', '.gz', '.tgz',
  '.7z', '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.gguf', '.onnx',
  '.woff', '.woff2', '.ttf', '.eot', '.otf', '.mp3', '.mp4', '.wav', '.db',
  '.sqlite', '.wasm', '.class', '.pyc', '.lock',
]);

export function indexDir(workspace) {
  return path.join(workspace, '.aide', 'index');
}

export function scanWorkspace(workspace) {
  const files = [];
  const root = path.resolve(workspace);
  const walk = dir => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(root, abs).split(path.sep).join('/');
      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXT.has(ext)) continue;
      let stat;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES || stat.size === 0) continue;
      files.push({ rel, abs });
    }
  };
  walk(root);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return files;
}

export function hashFile(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

export function loadIndex(workspace) {
  const dir = indexDir(workspace);
  const manifestPath = path.join(dir, 'manifest.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.indexVersion !== INDEX_VERSION) return null;
    const chunks = JSON.parse(fs.readFileSync(path.join(dir, 'chunks.json'), 'utf8'));
    let vectors = [];
    if (manifest.dim > 0 && chunks.length > 0) {
      const buf = fs.readFileSync(path.join(dir, 'vectors.bin'));
      const expected = chunks.length * manifest.dim * 4;
      if (buf.length !== expected) return null;
      vectors = [];
      for (let i = 0; i < chunks.length; i++) {
        vectors.push(new Float32Array(buf.buffer, buf.byteOffset + i * manifest.dim * 4, manifest.dim));
      }
    }
    return { files: manifest.files ?? {}, branch: manifest.branch ?? null, chunks, dim: manifest.dim, vectors };
  } catch {
    return null;
  }
}

export function persistIndex(workspace, { branch, files, chunks, dim, vectors }) {
  if (chunks.length > MAX_CHUNKS) throw Object.assign(new Error(`chunk cap exceeded (${chunks.length} > ${MAX_CHUNKS})`), { code: 'CAP_EXCEEDED' });
  const dir = indexDir(workspace);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = JSON.stringify({ indexVersion: INDEX_VERSION, branch, files, dim, chunks_count: chunks.length }, null, 1);
  const chunksJson = JSON.stringify(chunks);
  const vecBuf = Buffer.alloc(chunks.length * dim * 4);
  vectors.forEach((vec, i) => {
    if (vec.length !== dim) throw Object.assign(new Error(`vector ${i} dim ${vec.length} != ${dim}`), { code: 'DIM_MISMATCH' });
    vecBuf.set(Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength), i * dim * 4);
  });
  writeAtomic(path.join(dir, 'manifest.json'), manifest);
  writeAtomic(path.join(dir, 'chunks.json'), chunksJson);
  writeAtomic(path.join(dir, 'vectors.bin'), vecBuf);
}

function writeAtomic(target, data) {
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, target);
}

export function normalize(vec) {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return Float32Array.from(vec);
  return Float32Array.from(vec, v => v / norm);
}
