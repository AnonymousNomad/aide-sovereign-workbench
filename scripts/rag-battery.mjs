#!/usr/bin/env node
/**
 * RAG / context intelligence battery — verifies hybrid search pipeline exists and is wired.
 */
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
const total = 6;

function probe(name, fn) {
  const ok = fn();
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}`); }
}

const idxService = readFileSync('node/src/services/index-service.mjs', 'utf8');
const idxRoutes = readFileSync('node/src/routes/index.ts', 'utf8');
const has = (src, pattern) => new RegExp(pattern).test(src);

probe('bm25-import', () => has(idxService, 'createBm25'));
probe('rrf-fuse', () => has(idxService, 'rrfFuse'));
probe('vector-search', () => has(idxService, 'Float32Array'));
probe('reindex-route', () => has(idxRoutes, '/api/index/reindex'));
probe('hybrid-search-route', () => has(idxRoutes, 'hybridSearch'));
probe('rrf-k-constant', () => has(idxService, 'RRF_K'));

console.log(`\nBATTERY: ${pass}/${total} passed`);
process.exit(fail > 0 ? 1 : 0);
