---
name: aide-offline-rag
description: A2 phase SOP for the AIDE offline-first IDE — workspace indexing and hybrid retrieval (BM25 + dense vectors + RRF) with ZERO new native deps. Pure-JS structure-aware chunking, in-memory Float32 vector search persisted under .aide/index/, injectable embedFn (local llama_cpp.server /v1/embeddings with nomic prefixes), incremental content-hash reindexing, contract-first routes + WS channel. Research-grounded. Use whenever building/debugging the indexer, chunker, BM25/vector search, hybrid query path, or index routes/UI in aide-sovereign-workbench.
---

# A2 — Workspace Indexing (Offline RAG)

## Mission
Give any local model (and the IDE UI) semantic workspace retrieval without a single byte of egress and without adding native dependencies. The repo's dependency surface stays exactly: zod, ws, monaco-editor, typescript toolchain.

## Hard constraints (from verified repo reality)
- **No sqlite, no tree-sitter native bindings** (package.json deps are final: zod/ws/monaco/ts only). Everything is pure JS: in-memory indexes, JSON + binary persistence under `<workspace>/.aide/index/`.
- **Node 26 runtime**, type-stripping (.mjs services may import .ts specifiers), zod v4 strict, router has NO path params (body/query based), RouteError codes fixed union, openapi regenerated via `npm run contracts`.
- **Injectable seams pattern**: every external effect gets a constructor-injected function so CI never touches a model or network — `embedFn` here, exactly like `fetchImpl` (modelhub) and `agentChatFn` (agent loop).
- Model serving chain (verified daemon/model-manager.mjs): `python -m llama_cpp.server --model <gguf> --port N --n_ctx .. --n_gpu_layers 0 --logits_all false`. Embeddings = same server family with `--embedding`; dedicated embedder process on its own port (8088+ doctrine), never sharing the chat model's process.

## Research base (what the evidence actually says)
1. **arXiv 2605.04763 (controlled study, 864 settings)**: FUNCTION-per-chunk is the WORST strategy (-3.57..-5.64pp, Cliff's delta -1.0 — discards module-level code, underfills budget). Sliding-window and cAST-style AST-packing dominate the Pareto front. **Cross-file context length dominates all other levers** (+4.2pp from 2k to 8k tokens). Chunk size itself is weak/non-monotonic (~2000 non-whitespace chars fine).
2. **cAST (EMNLP 2025 Findings)**: recursively split large AST nodes, greedily MERGE adjacent sibling units up to a size budget — chunks end on unit boundaries, never mid-statement. Recall@5 +4.3 RepoEval.
3. **CatnipCoder symbol-granular analysis**: fixed-size windows cause silent quality rot (correct result at rank 4-7; duplicate copies of one method via overlap). Fixes that transfer without tree-sitter: **enrichment headers** (path + enclosing symbol prepended before embedding), **stable IDs** (reindex overwrites same row, no ghost vectors), **asymmetric embed prefixes** (Nomic: `search_document: ` on chunks, `search_query: ` on queries — wrong prefix silently drops points).
4. **RRF literature**: score = SUM 1/(k + rank_i(d)); k=60 tuned for million-doc corpora — **use k=10-20 at workspace scale (<10k chunks)**. Never feed BM25 zero-score rows into fusion (noise doc at sparse rank 0 beats real dense hit at rank 5). retrieval_k per retriever > final top_k (50 candidates each). Vectors must be L2-normalized so dot == cosine.
5. **llama.cpp server embeddings (verified docs)**: start `-m embed.gguf --embedding --pooling mean --alias local-embed`; OpenAI-compatible POST /v1/embeddings {model, input:[...]} returns normalized vectors; /health 503 until ready; batch input arrays supported.

## Architecture (daemon-side v1)
```
services/index-chunker.mjs    structure-aware heuristic splitter (no AST parser):
                              top-level unit detection per language family via regex anchors
                              (function/class/def/export/import/markdown headings),
                              greedy sibling packing into CHUNK_BUDGET (1800 non-ws chars),
                              oversized single units sub-split on blank lines,
                              NEVER cut mid-unit when the unit fits;
                              enrichment header = "<relPath> | <signature line>";
                              stable id = relPath + '#' + unitIndex
services/index-bm25.mjs       pure-JS Okapi BM25 (k1=1.2, b=0.75); tokenizer keeps code
                              symbols (split non-alphanum, keep _ and $ inside tokens),
                              lowercase, tiny English stopword set;
                              scores below epsilon dropped BEFORE fusion
services/index-store.mjs      .aide/index/{manifest.json, chunks.json, vectors.bin};
                              Float32Array rows, dot-product search (normalized);
                              incremental diff by per-file sha256: unchanged skipped,
                              changed rows overwritten by stable id, deleted purged;
                              atomic write (tmp+rename); caps: skip files >512KB /
                              binary ext / node_modules/.git/.aide; total chunk cap 50k
services/index-service.mjs    orchestrator: scan -> diff -> chunk -> embed(embedFn) ->
                              persist -> ready; debounced reindex coalescing;
                              status state machine idle|scanning|embedding|ready|error;
                              hybridSearch(query, limit): BM25 top50 (zero-filtered)
                              + dense top50 (query embedded w/ search_query prefix)
                              -> RRF(k=20) -> results w/ rrf_score + per-list ranks
routes/index.ts               POST /api/index/reindex {force?: boolean}
                              GET  /api/index/status
                              GET  /api/search/hybrid?query=&limit=   (query-param route;
                              matches router query support; empty results are valid)
events.ts                     ChannelName += 'index'; IndexStreamEvent union
                              (progress {files_done,files_total}|ready|error)
openapi.ts                    createIndexService({workspace, embedFn?, watcher}) wired after
                              rgService; default embedFn = POST http://127.0.0.1:<embedPort>
                              /v1/embeddings with prefixes baked in;
                              BuildRoutesOptions.indexEmbedFn? injection seam for CI
```

## Threats and honest limits (T-surface for A2)
- Index reads go through the SAME workspace jail patterns — no symlink escape via indexed paths.
- Embedder is localhost-only by construction (127.0.0.1, spawned locally, offline law). Hybrid search MUST work with embedFn unavailable: degrade to BM25-only with `degraded: true` in response (honest, no fake semantic results).
- Ignore-list enforcement (node_modules/.git/.aide/binaries/large files) prevents index poisoning and keeps memory bounded on 16GB.
- Branch-awareness v1: manifest records HEAD branch; on change full rebuild (cheap, honest). No cross-branch ghost vectors.

## Tests FIRST (write before implementations)
1. tests/unit/test-a2-index.mjs:
   - tokenizer keeps symbols (parse_tokens, _$ preserved); BM25 ranks exact-symbol match above generic prose on fixture corpus; zero-score filtering drops no-overlap docs.
   - RRF known-answer merge: doc ranked 1st in both lists wins; k=20 vs k=60 spread behavior; zero-score sparse list does not poison fusion.
   - chunker: packs units whole (fixture where a naive window would cut mid-function); oversized unit sub-split on blank lines; enrichment header present; stable IDs identical across no-op re-chunk; markdown heading units.
   - store: incremental diff — unchanged file skipped, changed file rows overwritten by id (no ghosts), deleted file purged; atomic write leaves valid index; caps enforced.
   - cosine/dot ranking sanity on hand-made normalized vectors; degraded mode returns BM25-only + degraded:true when embedFn throws/unavailable.
   - service e2e with fake embedFn: reindex -> ready status -> hybrid query returns expected file first.
2. tests/arch/index-routes.test.ts: strict contract shapes (bad body 400, unknown query params rejected), status envelope, hybrid search over HTTP with injected embedFn returning deterministic vectors, WS 'index' channel events observed, openapi documented paths.

## Pitfalls (from this repo's history)
- zod v4 strict: every route schema .strict(), error envelopes via existing translateError map.
- Windows paths: always path.win32-aware rel/abs via existing helpers; never string-replace backslashes ad hoc.
- Float32Array serialization: write raw buffer (Buffer.from(f32.buffer)), read with fixed dim from manifest; version the manifest (indexVersion) and rebuild on mismatch.
- Debounce reindex requests (watcher storms); coalesce to single run; never two concurrent embed batches against one llama server instance (it will OOM on 6GB).
- Embedding batch size cap (~16 texts/request) — llama_cpp.server on GTX 1060 chokes on large batches.
- RouteError NOT_READY while first reindex still running; BUSY semantics = 409 CONFLICT if force reindex requested mid-run.

## Gate
Unit + arch green locally (real node --test-force-exit) and CI green. Manual live smoke queued: spawn local embedding GGUF via llama_cpp.server --embedding, index this repo, run 3 real queries, evidence in docs/evidence/. Journal AGENT_NOTES + roadmap DONE entry. Queued UI pass: A2b search palette wiring hybrid results into existing search UI (legacy-wiring pattern).

## SHIPPED daemon-side (commit 4e5595a, CI green 2026-08-23) — verified lessons

- **Prefix-route collision**: `/api/search` is registered `prefix: true` in fs.ts routes — it silently swallows `/api/search/hybrid` (router find() takes FIRST match). Hybrid lives at `/api/index/search`. Law: new GET routes must not live under an existing prefix:true path; grep routes for prefix:true before naming.
- **Arch WS tests need the hub injected**: ArchServer owns its own EventHub (`server.events`); buildRoutes only forwards events if you pass `events: server.events` in options. Without it, route publishes vanish (agent-routes.test.ts never asserted delivery for exactly this reason).
- **Query params arrive as strings**: router builds Record<string,string> from URLSearchParams → numeric query contract fields need `z.coerce.number()` or every request 400s.
- **reindex force bug class**: fire-and-forget runners must receive ALL parameters through the void call (`void runReindex(sessionId, force)`) — first draft read `force` inside runReindex where it was undefined, silently forcing full rebuilds to no-op into incremental mode.
- **Greedy packing test semantics**: small sibling units legitimately merge into one chunk (cAST behavior). Assert unit-boundary integrity + budget-triggered splits with ~1200-char fixtures, never chunk counts on tiny files.
- **Toy hashing embedder**: dense similarity is nonzero even for garbage queries (shared buckets) — "no results" assertions must target BM25 zero-score filtering, not dense.
- **Full-suite transient cancel**: one full check:arch run cancelled 1 test and a rerun hung >15min (known OPEN ISSUE); components verified separately (tsc x2, eslint, arch file standalone 3/3) then full suite passed 251/251 clean. CI arbitrates when local flakes.
- **noUncheckedIndexedAccess**: `vec[i] += 1` needs `(vec[i] ?? 0) + 1`; Record<string,string>→typed cast needs `as unknown as`.
