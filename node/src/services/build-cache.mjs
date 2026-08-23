import crypto from 'node:crypto';
import fsSync from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 50;

export class BuildCache {
  constructor({ workspace, dir, maxEntries = DEFAULT_MAX_ENTRIES, maxBytes = DEFAULT_MAX_BYTES } = {}) {
    this.workspace = workspace;
    this.dir = dir ?? path.join(workspace, '.aide', 'cache', 'builds');
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.index = { entries: {}, hits: 0, misses: 0 };
    this.loadIndex();
  }

  indexPath() {
    return path.join(this.dir, 'index.json');
  }

  loadIndex() {
    try {
      const raw = fsSync.readFileSync(this.indexPath(), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.entries === 'object' && parsed.entries !== null) {
        this.index = { entries: parsed.entries, hits: parsed.hits ?? 0, misses: parsed.misses ?? 0 };
      }
    } catch {
      // no cache yet
    }
  }

  persistIndex() {
    fsSync.mkdirSync(this.dir, { recursive: true });
    fsSync.writeFileSync(this.indexPath(), JSON.stringify(this.index), 'utf8');
  }

  logPath(key) {
    return path.join(this.dir, `${key}.log`);
  }

  problemsPath(key) {
    return path.join(this.dir, `${key}.problems.json`);
  }

  has(key) {
    return Object.prototype.hasOwnProperty.call(this.index.entries, key);
  }

  async get(key) {
    const manifest = this.index.entries[key];
    if (!manifest) {
      this.index.misses += 1;
      this.persistIndex();
      return null;
    }
    let logText;
    let problems;
    try {
      logText = await fsSync.promises.readFile(this.logPath(key), 'utf8');
      problems = JSON.parse(await fsSync.promises.readFile(this.problemsPath(key), 'utf8'));
    } catch {
      delete this.index.entries[key];
      this.persistIndex();
      return null;
    }
    this.index.hits += 1;
    manifest.lastHitAt = Date.now();
    this.persistIndex();
    return { manifest, logText, problems };
  }

  async record(manifest, logText, problems) {
    fsSync.mkdirSync(this.dir, { recursive: true });
    await fsSync.promises.writeFile(this.logPath(manifest.key), logText, 'utf8');
    await fsSync.promises.writeFile(this.problemsPath(manifest.key), JSON.stringify(problems ?? []), 'utf8');
    this.index.entries[manifest.key] = { ...manifest, lastHitAt: manifest.lastHitAt ?? null };
    this.enforceEviction();
    this.persistIndex();
  }

  enforceEviction() {
    const entries = () => Object.values(this.index.entries);
    const lruKey = () => {
      let oldest = null;
      for (const entry of entries()) {
        const stamp = entry.lastHitAt ?? entry.createdAt ?? 0;
        if (oldest === null || stamp < oldest.stamp) oldest = { key: entry.key, stamp };
      }
      return oldest?.key ?? null;
    };
    while (entries().length > this.maxEntries || entries().reduce((sum, e) => sum + (e.sizeBytes ?? 0), 0) > this.maxBytes) {
      const victim = lruKey();
      if (victim === null) break;
      this.removeEntry(victim);
    }
  }

  removeEntry(key) {
    delete this.index.entries[key];
    try { fsSync.rmSync(this.logPath(key), { force: true }); } catch { /* best effort */ }
    try { fsSync.rmSync(this.problemsPath(key), { force: true }); } catch { /* best effort */ }
  }

  clear() {
    const count = Object.keys(this.index.entries).length;
    try { fsSync.rmSync(this.dir, { recursive: true, force: true }); } catch { /* best effort */ }
    this.index = { entries: {}, hits: this.index.hits, misses: this.index.misses };
    return count;
  }

  stats() {
    const entries = Object.values(this.index.entries)
      .map(entry => ({
        key: entry.key,
        label: entry.label,
        createdAt: entry.createdAt,
        lastHitAt: entry.lastHitAt ?? null,
        exitCode: entry.exitCode,
        sizeBytes: entry.sizeBytes
      }))
      .sort((a, b) => (b.lastHitAt ?? b.createdAt) - (a.lastHitAt ?? a.createdAt));
    return {
      entries,
      totalBytes: entries.reduce((sum, e) => sum + e.sizeBytes, 0),
      hits: this.index.hits,
      misses: this.index.misses
    };
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonicalize(value[k])]));
  }
  return value;
}

export function computeCacheKey(parts) {
  const canonical = JSON.stringify(canonicalize(parts));
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}
