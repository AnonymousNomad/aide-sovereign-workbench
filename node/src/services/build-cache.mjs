import crypto from 'node:crypto';
import fsSync from 'node:fs';
import path from 'node:path';
import { AuthorityError } from './execution-authority.mjs';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 50;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class CacheBoundaryError extends Error {
  constructor(message, detail = {}) {
    super(message); this.name = 'CacheBoundaryError'; this.code = 'CACHE_BOUNDARY'; this.detail = detail;
  }
}
function keyValid(key) {
  // Canonical ASCII identifiers preserve existing k1-style keys and generated
  // hashes. No path syntax, encoding, ADS, trailing dot/space or DOS devices.
  if (typeof key !== 'string' || !/^[a-z0-9_-]{1,128}$/.test(key) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
    throw new CacheBoundaryError('invalid canonical cache key');
  }
  return key;
}
function inside(root, target) {
  const rel = path.relative(root, target);
  return rel !== '' && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep);
}
function statMaybe(file) {
  try { return fsSync.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function identity(stat) { return stat ? { dev: stat.dev, ino: stat.ino } : null; }

export class BuildCache {
  #workspace; #root; #authority; #index = { entries: {}, hits: 0, misses: 0 };
  #loadError = null; #limits; #rootIdentity = null;
  constructor({ workspace, dir, authority, maxEntries = DEFAULT_MAX_ENTRIES, maxBytes = DEFAULT_MAX_BYTES } = {}) {
    if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw new CacheBoundaryError('absolute application workspace required');
    this.#workspace = path.resolve(workspace);
    const container = path.join(this.#workspace, '.aide', 'cache');
    this.#root = path.resolve(dir ?? path.join(container, 'builds'));
    if (!inside(container, this.#root)) throw new CacheBoundaryError('cache root must be a dedicated application cache directory');
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new CacheBoundaryError('invalid cache limits');
    this.#limits = Object.freeze({ maxEntries, maxBytes }); this.#authority = authority;
    try {
      this.#checkRoot();
      const file = this.#target('index.json');
      if (statMaybe(file)) {
        const parsed = JSON.parse(fsSync.readFileSync(file, 'utf8'));
        this.#validateIndex(parsed);
        this.#index = structuredClone(parsed);
      }
    } catch (error) {
      // Keep construction non-mutating/compatible. A corrupt cache is NOT an
      // empty cache: every subsequent operation exposes this exact failure.
      this.#loadError = error;
    }
  }
  get workspace() { return this.#workspace; }
  get dir() { return this.#root; }

  #checkRoot() {
    if (fsSync.realpathSync(this.#workspace) !== this.#workspace) throw new CacheBoundaryError('workspace must be canonical and non-redirected');
    const parts = path.relative(this.#workspace, this.#root).split(path.sep);
    const chain = [];
    let cursor = this.#workspace;
    for (const part of parts) {
      cursor = path.join(cursor, part);
      const stat = statMaybe(cursor);
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink() || fsSync.realpathSync(cursor) !== cursor)) {
        throw new CacheBoundaryError('cache ancestor is redirected or not a directory', { path: cursor });
      }
      chain.push({ path: cursor, identity: identity(stat) });
    }
    const rootId = identity(statMaybe(this.#root));
    if (this.#rootIdentity && JSON.stringify(rootId) !== JSON.stringify(this.#rootIdentity)) throw new CacheBoundaryError('cache root identity changed');
    if (rootId) this.#rootIdentity = rootId;
    return chain;
  }
  #target(name) {
    this.#checkRoot();
    if (name !== 'index.json') {
      const match = /^(.+)(\.log|\.problems\.json)$/.exec(name);
      if (!match) throw new CacheBoundaryError('unknown cache artifact');
      keyValid(match[1]);
    }
    const target = path.resolve(this.#root, name);
    if (!inside(this.#root, target) || path.dirname(target) !== this.#root) throw new CacheBoundaryError('cache target escaped its root');
    const stat = statMaybe(target);
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || fsSync.realpathSync(target) !== target)) {
      throw new CacheBoundaryError('cache target is redirected, linked or not a regular file', { target });
    }
    return target;
  }
  #validateIndex(index) {
    if (!index || typeof index !== 'object' || !index.entries || Array.isArray(index.entries) ||
        typeof index.entries !== 'object' || !Number.isSafeInteger(index.hits) || index.hits < 0 ||
        !Number.isSafeInteger(index.misses) || index.misses < 0) throw new CacheBoundaryError('invalid persisted cache index');
    for (const [key, item] of Object.entries(index.entries)) {
      keyValid(key);
      if (!item || item.key !== key || typeof item.label !== 'string' ||
          !Number.isFinite(item.createdAt) || !Number.isFinite(item.sizeBytes) || item.sizeBytes < 0 ||
          !Number.isInteger(item.exitCode) || (item.lastHitAt != null && !Number.isFinite(item.lastHitAt))) {
        throw new CacheBoundaryError('invalid cache manifest');
      }
    }
  }
  #ready() {
    if (this.#loadError) throw this.#loadError;
    this.#checkRoot(); this.#validateIndex(this.#index);
  }
  #plan(action, payload) {
    this.#ready();
    const next = structuredClone(this.#index);
    let victims = [];
    let names = ['index.json'];
    if (action === 'record') {
      const manifest = payload?.manifest;
      keyValid(manifest?.key);
      this.#validateIndex({ entries: { [manifest.key]: manifest }, hits: 0, misses: 0 });
      next.entries[manifest.key] = { ...manifest, lastHitAt: manifest.lastHitAt ?? null };
      const entries = () => Object.values(next.entries);
      while (entries().length > this.#limits.maxEntries || entries().reduce((sum, e) => sum + e.sizeBytes, 0) > this.#limits.maxBytes) {
        const oldest = entries().sort((a, b) => (a.lastHitAt ?? a.createdAt) - (b.lastHitAt ?? b.createdAt))[0];
        victims.push(oldest.key); delete next.entries[oldest.key];
      }
      names.push(manifest.key + '.log', manifest.key + '.problems.json');
    } else if (action === 'get') {
      keyValid(payload?.key);
      names.push(payload.key + '.log', payload.key + '.problems.json');
    } else if (action === 'clear') {
      names = statMaybe(this.#root) ? fsSync.readdirSync(this.#root) : [];
      // Never recursively delete a root/unknown directory, even when clearing.
      victims = Object.keys(next.entries);
    } else throw new CacheBoundaryError('unknown cache mutation');
    if (action === 'record') for (const key of victims) names.push(key + '.log', key + '.problems.json');
    const targets = [...new Set(names)].sort().map(name => {
      const target = this.#target(name), stat = statMaybe(target);
      return { path: target, identity: identity(stat), size: stat?.size ?? null, mtime: stat?.mtimeMs ?? null };
    });
    return { next, victims, body: { action, root: this.#root, root_chain: this.#checkRoot(), targets,
      index_digest: digest(this.#index), payload_digest: digest(payload), limits: this.#limits } };
  }
  describe(action, payload, taskId) {
    return { workspace: this.#workspace, kind: 'cache.mutate', taskId, args: { body: this.#plan(action, payload).body } };
  }
  #mutate(action, payload, execution, fn) {
    const plan = this.#plan(action, payload); // confinement checked even without authority
    if (!this.#authority) throw new AuthorityError('FORBIDDEN', 'cache execution authority required');
    const context = this.#authority.assertExecution(execution, 'cache.mutate', plan.body);
    if (context.operation.workspace !== this.#workspace) throw new AuthorityError('FORBIDDEN', 'cache workspace mismatch');
    this.#authority.claimExecution(execution, 'cache.mutate', plan.body);
    const completed = [];
    const guard = () => {
      this.#authority.assertExecution(execution, 'cache.mutate', plan.body);
      this.#checkRoot();
    };
    const write = (name, text) => {
      guard();
      fsSync.mkdirSync(this.#root, { recursive: true }); this.#checkRoot();
      const target = this.#target(name), existing = statMaybe(target);
      const flags = existing ? fsSync.constants.O_RDWR : fsSync.constants.O_WRONLY | fsSync.constants.O_CREAT | fsSync.constants.O_EXCL;
      const fd = fsSync.openSync(target, flags | (fsSync.constants.O_NOFOLLOW ?? 0), 0o600);
      try {
        const opened = fsSync.fstatSync(fd);
        if (!opened.isFile() || opened.nlink !== 1 || (existing && JSON.stringify(identity(opened)) !== JSON.stringify(identity(existing)))) throw new CacheBoundaryError('cache write identity changed');
        fsSync.ftruncateSync(fd, 0); fsSync.writeFileSync(fd, text); fsSync.fsyncSync(fd);
        completed.push(target);
      } finally { fsSync.closeSync(fd); }
    };
    const remove = target => {
      guard();
      const checked = this.#target(path.basename(target));
      if (checked !== target || !plan.body.targets.some(item => item.path === target)) throw new CacheBoundaryError('unbound cache deletion target');
      if (statMaybe(target)) { fsSync.unlinkSync(target); completed.push(target); }
    };
    try { return fn(plan, write, remove); }
    catch (error) {
      if (error instanceof AuthorityError) throw error;
      throw new CacheBoundaryError('cache mutation failed', { completed, cause: String(error.message), outcome: completed.length ? 'partial' : 'failed' });
    }
  }
  has(key) { this.#ready(); return Object.hasOwn(this.#index.entries, keyValid(key)); }
  async get(key, execution) {
    return this.#mutate('get', { key }, execution, (_plan, write) => {
      const next = structuredClone(this.#index), manifest = next.entries[key];
      let result = null;
      if (manifest) {
        try {
          const logText = fsSync.readFileSync(this.#target(key + '.log'), 'utf8');
          const problems = JSON.parse(fsSync.readFileSync(this.#target(key + '.problems.json'), 'utf8'));
          next.hits++; manifest.lastHitAt = Date.now();
          result = { manifest, logText, problems };
        } catch (error) {
          if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
          delete next.entries[key]; next.misses++;
        }
      } else next.misses++;
      write('index.json', JSON.stringify(next)); this.#index = next; return result;
    });
  }
  async record(manifest, logText, problems, execution) {
    return this.#mutate('record', { manifest, logText, problems }, execution, (plan, write, remove) => {
      write(manifest.key + '.log', logText);
      write(manifest.key + '.problems.json', JSON.stringify(problems ?? []));
      for (const key of plan.victims) {
        remove(this.#target(key + '.log')); remove(this.#target(key + '.problems.json'));
      }
      write('index.json', JSON.stringify(plan.next)); this.#index = plan.next;
    });
  }
  clear(execution) {
    return this.#mutate('clear', {}, execution, (plan, _write, remove) => {
      for (const target of plan.body.targets) remove(target.path);
      const count = Object.keys(this.#index.entries).length;
      this.#index = { entries: {}, hits: this.#index.hits, misses: this.#index.misses };
      return count;
    });
  }
  stats() {
    this.#ready();
    const entries = Object.values(this.#index.entries).map(entry => ({ key: entry.key, label: entry.label,
      createdAt: entry.createdAt, lastHitAt: entry.lastHitAt ?? null, exitCode: entry.exitCode, sizeBytes: entry.sizeBytes }))
      .sort((a, b) => (b.lastHitAt ?? b.createdAt) - (a.lastHitAt ?? a.createdAt));
    return { entries, totalBytes: entries.reduce((sum, e) => sum + e.sizeBytes, 0), hits: this.#index.hits, misses: this.#index.misses };
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
