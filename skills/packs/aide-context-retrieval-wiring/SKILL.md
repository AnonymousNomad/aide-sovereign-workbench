---
name: aide-context-retrieval-wiring
description: Wire the built-but-unwired codebase index (node/src/services/index-service.mjs, BM25+RRF+optional dense embeddings, git-aware, /api/index/reindex + /api/index/search already routed) into the actual chat path so every model answer is grounded in the operator's real workspace — retrieval injection in model-router/chat, an @codebase context tool, embed-function supply via the local engine, index freshness on file change, token-budgeted context packs. Use whenever model answers ignore workspace code, when asked "how do I make chat know my codebase", when wiring retrieval-augmented generation, tuning context budgets, or diagnosing stale/degraded index results.
---

# Context Retrieval Wiring — Ground Every Answer in the Real Workspace

Born 2026-08-27 gap analysis: AIDE already SHIPS a hybrid retrieval engine
(index-service.mjs: chunkFile, BM25 sparse, dense cosine, RRF fuse, git-branch
aware, incremental reindex, persist/restore from disk) with HTTP routes
(/api/index/reindex, /api/index/search) — and NOTHING in the chat path calls
it. `rg hybridSearch model-router.ts chat.ts orchestrator.mjs` = zero hits.
Rivals (Cursor secure codebase indexing 2026, VS Code workspace context) treat
this as THE differentiator. Also: no embed function is ever supplied
(openapi.ts `indexEmbedFn ?? null`), so the index runs in permanently
"degraded" BM25-only mode.

## Research base (verified 2026-08-27)

1. Cursor ships "secure codebase indexing" + "semantic search" as marquee
   features (cursor.com, changelog 2026); VS Code ships "workspace context" +
   "add prompt context" as first-class agent concepts (VS Code agents docs,
   retrieved 2026-08-27).
2. In-repo engine ALREADY implements hybrid retrieval correctly: BM25 sparse +
   dense cosine candidates → RRF fuse (k=20, 50 per list) → {path, line,
   header, rrf_score, sparse_rank, dense_rank} + honest `degraded` flag.
3. Both chat paths have proven injection seams: legacy daemon /api/chat
   (injectScaffold + learned block) and arch chat.ts (buildScaffold tiers).

## What to do (direct)

1. WIRE RETRIEVAL INTO CHAT (arch first): last user message →
   `indexService.hybridSearch(msg, 8)` → CONTEXT block: top 5 results, each
   `path:line header` + ≤20 lines read from disk via the existing fs path
   jail. Inject as a DATA message after the scaffold, before user content.
   Add harness metadata: `context: { hits, degraded, approx_tokens }`.
2. SUPPLY AN EMBED FUNCTION: local engine /v1/embeddings on the small in-box
   model, batch 16 (EMBED_BATCH), passed as `indexEmbedFn` at service create.
   Verify /v1/embeddings with curl first; if unsupported stay BM25-only and
   keep the honest `degraded` flag — do NOT fake it.
3. LEGACY PARITY: same injection in daemon/server.mjs chat; reuse ONE index —
   legacy calls the arch /api/index/search over 127.0.0.1, never a second scan.
4. FRESHNESS: fs watcher → debounce 5s → incremental reindex(); progress on
   the events bus; status bar shows `index: <chunks>, fresh/stale/degraded`.
5. @codebase TOOL: explicit tool for "search the codebase for X" →
 
## Why it's done this way

- Retrieval MUST be default-on and invisible: rivals win because answers are
  grounded without the operator asking. An unused endpoint is research, not a
  feature.
- BM25-first with honest degradation: dense adds latency + a failure mode; RRF
  fuse already handles missing dense gracefully. Ship value now, flip dense on
  when embeddings verify.
- Reuse, don't rebuild: the engine matches Cursor's architecture (chunk →
  sparse+dense → fuse), is written, routed, and tested. The gap is ONE call in
  the chat path plus a freshness loop.

## Dependencies / issues / bugs

- Depends on: index-service.mjs (built), index routes (built), fs path jail
  (built — reuse for line reads), events bus (built), scaffold injection
  (built).
- Embeddings require the served model to support /v1/embeddings — verify with
  curl before wiring; unsupported = BM25-only, flagged.
- Known repo pitfall: `indexEmbedFn ?? null` means every boot is degraded.
- Large repos: scanWorkspace must respect .gitignore + a file-size cap;
  reindex is event-driven, never on the request path.
- Windows separators in doc.path: index-store normalizes; read doc.path
  verbatim through the jail.

## Threat matrix

| Threat | Signature | Defense |
|---|---|---|
| Prompt-injection via workspace files | retrieved chunk says "ignore instructions" | retrieved text is DATA: delimited, never system role; scaffold asserts precedence |
| Secret leakage into context | .env/keys chunks indexed | respect .gitignore + deny-list (.env, *.pem, node_modules) in scan |
| Path escape on line reads | result path used raw for fs read | resolveInside jail on every chunk read |
| Stale index misleads model | answer cites deleted code | fs-event incremental reindex + freshness stamp in harness metadata |
| Context budget blowout | retrieval starves the real question | hard cap 5 hits × 20 lines (≤~1.5k tokens); drop lowest RRF rank first |
| Twin-orchestrator index drift | legacy + arch keep separate indexes | ONE index (arch owns); legacy calls arch HTTP |

## Pitfalls

- Do NOT put retrieved code into the system prompt — data block, delimited.
- Do NOT reindex per keystroke/save — debounce 5s, incremental only; full
  reindex only on INDEX_VERSION bump.
- Do NOT drop the `degraded` flag — repo honesty laws require surfacing it.
- Do NOT store file contents in the index; read-at-answer-time keeps it small.
