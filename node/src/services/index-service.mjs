import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chunkFile } from './index-chunker.mjs';
import { createBm25, rrfFuse } from './index-bm25.mjs';
import { scanWorkspace, hashFile, loadIndex, persistIndex, normalize, INDEX_VERSION } from './index-store.mjs';

const EMBED_BATCH = 16;
const CANDIDATES_PER_LIST = 50;
const RRF_K = 20;

function gitBranch(workspace) {
  return new Promise(resolve => {
    execFile('git', ['-C', workspace, 'rev-parse', '--abbrev-ref', 'HEAD'], { windowsHide: true }, (error, stdout) => {
      resolve(error ? null : String(stdout).trim() || null);
    });
  });
}

export function createIndexService(options) {
  const workspace = options.workspace;
  const embed = options.embed ?? null;
  const onEvent = options.onEvent ?? (() => {});

  let status = {
    state: 'idle',
    files_total: 0,
    files_done: 0,
    chunks: 0,
    branch: null,
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  let running = false;
  let docs = [];
  let vectors = [];
  let dim = 0;
  let bm25 = createBm25([]);
  let indexedFiles = {};
  let indexedBranch = null;

  restoreFromDisk();

  function restoreFromDisk() {
    try {
      const loaded = loadIndex(workspace);
      if (!loaded || loaded.chunks.length === 0) return;
      indexedFiles = loaded.files;
      indexedBranch = loaded.branch;
      docs = loaded.chunks.map(chunk => ({ id: chunk.id, path: chunk.path, line: chunk.line, header: chunk.header, text: `${chunk.header}\n${chunk.body}` }));
      vectors = Array.from(loaded.vectors, vec => Float32Array.from(vec));
      dim = loaded.dim;
      bm25 = createBm25(docs.map(d => d.text));
      status = { ...status, state: 'ready', chunks: docs.length, branch: indexedBranch, updated_at: new Date().toISOString() };
    } catch {
      // corrupt or missing index stays idle; next reindex rebuilds
    }
  }

  function emit(event) {
    onEvent(event);
  }

  async function reindex(force = false) {
    if (running && !force) {
      throw Object.assign(new Error('reindex already in progress'), { code: 'BUSY' });
    }
    if (running && force) {
      throw Object.assign(new Error('reindex already in progress; force requires waiting'), { code: 'BUSY' });
    }
    const sessionId = crypto.randomUUID();
    void runReindex(sessionId, force);
    return { session_id: sessionId };
  }

  async function runReindex(sessionId, force = false) {
    running = true;
    try {
      status = { ...status, state: 'scanning', last_error: null, updated_at: new Date().toISOString() };
      const branch = await gitBranch(workspace);
      const full = force || branch !== indexedBranch;
      const scanned = scanWorkspace(workspace);
      const changed = [];
      const hashes = {};
      for (const file of scanned) {
        hashes[file.rel] = hashFile(file.abs);
        if (full || indexedFiles[file.rel] !== hashes[file.rel]) changed.push(file);
      }
      status = { ...status, files_total: full ? scanned.length : changed.length, files_done: 0 };

      const removedRel = new Set(Object.keys(indexedFiles).filter(rel => !(rel in hashes)));
      if (full) for (const rel of Object.keys(indexedFiles)) removedRel.add(rel);
      dropDocsForPaths(removedRel);

      let done = 0;
      for (const file of changed) {
        if (docs.length >= 50_000) break;
        let content;
        try {
          content = fs.readFileSync(file.abs, 'utf8');
        } catch {
          continue;
        }
        dropDocsForPath(file.rel);
        const fileChunks = chunkFile(file.rel, content);
        for (const chunk of fileChunks) docs.push({ id: chunk.id, path: chunk.path, line: chunk.line, header: chunk.header, text: chunk.text });
        done += 1;
        status = { ...status, files_done: done };
        emit({ type: 'progress', session_id: sessionId, files_done: done, files_total: changed.length });
      }

      status = { ...status, state: 'embedding' };
      bm25 = createBm25(docs.map(d => d.text));
      await buildVectors(sessionId);

      persistIndex(workspace, { branch, files: hashes, chunks: docs.map(d => ({ id: d.id, path: d.path, line: d.line, header: d.header, body: d.text.slice(d.header.length + 1) })), dim, vectors });
      indexedFiles = hashes;
      indexedBranch = branch;
      status = { ...status, state: 'ready', chunks: docs.length, branch, updated_at: new Date().toISOString() };
      emit({ type: 'ready', session_id: sessionId, chunks: docs.length });
    } catch (error) {
      status = { ...status, state: 'error', last_error: String(error?.message ?? error).slice(0, 300), updated_at: new Date().toISOString() };
      emit({ type: 'error', session_id: sessionId, message: String(error?.message ?? error).slice(0, 300) });
    } finally {
      running = false;
    }
  }

  function dropDocsForPath(rel) {
    docs = docs.filter(d => d.path !== rel);
    // vectors are rebuilt wholesale below to keep alignment
  }

  function dropDocsForPaths(relSet) {
    if (relSet.size === 0) return;
    docs = docs.filter(d => !relSet.has(d.path));
  }

  async function buildVectors(sessionId) {
    vectors = [];
    if (!embed || docs.length === 0) {
      dim = 0;
      return;
    }
    const batches = [];
    for (let i = 0; i < docs.length; i += EMBED_BATCH) batches.push(docs.slice(i, i + EMBED_BATCH));
    let embedded = 0;
    for (const batch of batches) {
      const out = await embed(batch.map(d => d.text));
      if (!Array.isArray(out) || out.length !== batch.length) {
        throw new Error(`embedFn returned ${Array.isArray(out) ? out.length : typeof out} vectors for ${batch.length} texts`);
      }
      dim = out[0].length;
      for (const vec of out) vectors.push(normalize(vec));
      embedded += batch.length;
      emit({ type: 'progress', session_id: sessionId, files_done: embedded, files_total: docs.length });
    }
  }

  async function hybridSearch(queryText, limit = 10) {
    let degraded = !embed;
    const sparse = bm25.search(queryText, CANDIDATES_PER_LIST).map(hit => ({ id: docs[hit.index]?.id ?? `#${hit.index}`, source: 'sparse' }));

    let dense = [];
    if (embed && docs.length > 0 && dim > 0) {
      try {
        const [queryVec] = await embed([`search_query: ${queryText}`]);
        const qv = normalize(queryVec);
        const scored = [];
        vectors.forEach((vec, i) => {
          let dot = 0;
          for (let j = 0; j < qv.length; j++) dot += qv[j] * vec[j];
          scored.push({ index: i, score: dot });
        });
        scored.sort((a, b) => b.score - a.score);
        dense = scored.slice(0, CANDIDATES_PER_LIST).map(hit => ({ id: docs[hit.index].id, source: 'dense' }));
      } catch {
        degraded = true;
      }
    } else if (embed && dim === 0 && docs.length > 0) {
      degraded = true;
    }

    const fused = rrfFuse([sparse, dense], { k: RRF_K, limit });
    const byId = new Map(docs.map(d => [d.id, d]));
    const results = [];
    for (const entry of fused) {
      const doc = byId.get(entry.id);
      if (!doc) continue;
      results.push({
        path: doc.path,
        line: doc.line,
        header: doc.header,
        rrf_score: entry.score,
        sparse_rank: entry.ranks.sparse ?? null,
        dense_rank: entry.ranks.dense ?? null,
      });
    }
    return { results, degraded };
  }

  return {
    reindex,
    hybridSearch,
    getStatus: () => ({ ...status }),
    isRunning: () => running,
  };
}
