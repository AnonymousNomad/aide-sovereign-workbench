import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MIN_SAMPLE_CHARS = 10;
const MAX_SAMPLE_CHARS = 32768;

function normalizeSample(sample) {
  if (sample === null || typeof sample !== 'object' || Array.isArray(sample)) return null;
  const text = typeof sample.text === 'string' ? sample.text : null;
  const input = typeof sample.input === 'string' ? sample.input : null;
  const output = typeof sample.output === 'string' ? sample.output : null;
  if (text !== null && input === null && output === null) return { text: text.trim() };
  if (input !== null && output !== null) return { input: input.trim(), output: output.trim() };
  return null;
}

export class DatasetStore {
  constructor({ rootDir }) {
    this.rootDir = rootDir;
    this.index = { schema_version: 1, datasets: {} };
  }

  async load() {
    await fs.mkdir(this.rootDir, { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(this.rootDir, 'index.json'), 'utf8'));
      if (parsed?.schema_version !== 1 || typeof parsed.datasets !== 'object') throw new Error('bad shape');
      this.index = parsed;
    } catch {
      this.index = { schema_version: 1, datasets: {} };
    }
    return this.list();
  }

  #saveIndex() {
    const temp = path.join(this.rootDir, 'index.json.tmp');
    return fs.writeFile(temp, JSON.stringify(this.index, null, 2)).then(() => fs.rename(temp, path.join(this.rootDir, 'index.json')));
  }

  list() {
    return Object.values(this.index.datasets).map(({ hashes, ...meta }) => meta);
  }

  get(id) {
    const entry = this.index.datasets[id];
    if (!entry) return null;
    const { hashes, ...meta } = entry;
    return meta;
  }

  async create(name) {
    const clean = String(name ?? '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{2,63}$/.test(clean)) throw new Error('dataset name must be 3-64 chars: letters, digits, space, _ or -');
    const id = `${clean.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
    if (Object.values(this.index.datasets).some(entry => entry.name === clean)) throw new Error(`dataset name already exists: ${clean}`);
    const now = new Date().toISOString();
    this.index.datasets[id] = { id, name: clean, count: 0, bytes: 0, dup_skipped: 0, created_at: now, updated_at: now, hashes: {} };
    await this.#saveIndex();
    await fs.writeFile(this.jsonlPath(id), '', 'utf8');
    return this.get(id);
  }

  jsonlPath(id) {
    return path.join(this.rootDir, `${id}.jsonl`);
  }

  validateSample(normalized) {
    if (!normalized) return 'sample must be {text} or {input, output} with string fields';
    const joined = 'text' in normalized ? normalized.text : `${normalized.input}\n${normalized.output}`;
    if (joined.length < MIN_SAMPLE_CHARS) return `sample too short (<${MIN_SAMPLE_CHARS} chars)`;
    if (joined.length > MAX_SAMPLE_CHARS) return `sample too long (>${MAX_SAMPLE_CHARS} chars)`;
    return null;
  }

  async append(id, samples) {
    const entry = this.index.datasets[id];
    if (!entry) return { error: 'NOT_FOUND' };
    if (!Array.isArray(samples) || samples.length === 0) return { error: 'BAD_REQUEST', message: 'samples must be a non-empty array' };
    if (entry.count + samples.length > 200000) return { error: 'PAYLOAD_TOO_LARGE', message: 'dataset cap is 200000 samples' };
    const lines = [];
    let accepted = 0;
    let rejectedDupes = 0;
    let rejectedInvalid = 0;
    const errors = [];
    for (const [position, raw] of samples.entries()) {
      const normalized = normalizeSample(raw);
      const problem = this.validateSample(normalized);
      if (problem) {
        rejectedInvalid += 1;
        if (errors.length < 10) errors.push(`#${position}: ${problem}`);
        continue;
      }
      const hash = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
      if (entry.hashes[hash]) {
        rejectedDupes += 1;
        continue;
      }
      entry.hashes[hash] = 1;
      lines.push(JSON.stringify({ ...normalized, hash }));
      accepted += 1;
    }
    if (lines.length > 0) {
      await fs.appendFile(this.jsonlPath(id), `${lines.join('\n')}\n`, 'utf8');
      entry.count += accepted;
      entry.dup_skipped += rejectedDupes;
      entry.bytes = (await fs.stat(this.jsonlPath(id))).size;
      entry.updated_at = new Date().toISOString();
      await this.#saveIndex();
    }
    return { accepted, rejected_dupes: rejectedDupes, rejected_invalid: rejectedInvalid, errors };
  }

  async read(id, { offset = 0, limit = 50 } = {}) {
    const entry = this.index.datasets[id];
    if (!entry) return { error: 'NOT_FOUND' };
    const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
    const safeLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 50));
    const content = await fs.readFile(this.jsonlPath(id), 'utf8');
    const all = content.split('\n').filter(Boolean);
    return {
      total: all.length,
      offset: safeOffset,
      samples: all.slice(safeOffset, safeOffset + safeLimit).map(line => JSON.parse(line))
    };
  }

  async delete(id) {
    const entry = this.index.datasets[id];
    if (!entry) return false;
    delete this.index.datasets[id];
    await fs.rm(this.jsonlPath(id), { force: true });
    await this.#saveIndex();
    return true;
  }
}
