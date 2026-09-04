---
name: aide-context-retrieval-wiring
description: Verify and extend the codebase context index (node/src/services/index-service.mjs, BM25+RRF+optional dense embeddings, git-aware, /api/index/reindex + /api/index/search) in the actual chat path so model answers can be grounded in the operator's real workspace. Use when model answers ignore workspace code, when asked "how do I make chat know my codebase", when wiring retrieval-augmented generation, tuning context budgets, or diagnosing stale/degraded index results.
---

# Context Retrieval Wiring — Ground Every Answer in the Real Workspace

Born 2026-08-27 as a gap analysis: AIDE already ships a hybrid retrieval engine
(index-service.mjs: chunkFile, BM25 sparse, dense cosine, RRF fuse, git-branch
aware, incremental reindex, persist/restore from disk) with HTTP routes
(/api/index/reindex, /api/index/search). The original audit found no chat call.

Rechecked 2026-09-03: the TS chat path receives the shared index service from
openapi.ts, calls `hybridSearch()` in `node/src/routes/chat.ts`, reads bounded
snippets through the workspace path jail, injects a context block, and reports
context metadata. The remaining work is verification and parity, not rebuilding
the index: no route test proves chat injection, legacy chat does not share this
path, and the current context block uses a `system` message role despite being
labelled DATA. Resolve that role boundary with research and a regression test;
never relabel degraded BM25-only retrieval as dense retrieval.

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
4. OpenAI Chat Completions defines system/developer messages as developer
   instructions and user messages as prompts or additional context:
   https://platform.openai.com/docs/api-reference/chat/create.
5. OWASP LLM01:2025 requires external/RAG content to be segregated and clearly
   identified because retrieval does not eliminate indirect prompt injection:
   https://genai.owasp.org/llmrisk/llm01-prompt-injection/.

## Original implementation plan (historical)

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
5. @codebase TOOL: explicit tool for "search the codebase for X".

The original plan above is superseded by the implementation-truth and security
gates below. Do not rebuild the already-wired TS retrieval path before checking
the route battery and the legacy parity boundary.

## Current execution order

1. Keep the real HTTP `tests/arch/chat-context.test.ts` green. It proves the
   shared index seam, bounded read-at-answer-time snippets, path jail, and
   degraded metadata.
2. Keep all dynamic workspace, memory, and retrieval content in labelled user
   DATA messages. Only the scaffold/credo belongs in the system instruction.
3. Verify the embedding endpoint before enabling dense vectors; degraded BM25
   is an honest supported state.
4. Add legacy parity through one shared index or document the compatibility
   boundary with a route-level test.
5. Add freshness and real-model grounded-chat probes before publishing any
   universal grounded-answer claim.

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

## Implementation truth audit (2026-09-03)

- `node/src/routes/chat.ts:67-96` already performs bounded workspace retrieval
  through `indexService.hybridSearch()` and `resolveInsideWorkspace()`.
- `node/src/routes/chat.ts:138-146` injects the context block and
  `:195-206` reports context hit/degraded/token metadata.
- `/api/chat/stream` now calls the same `prepareChatMessages()` path as
  non-stream chat and includes the preparation metadata in its final SSE event.
  `tests/arch/chat-context.test.ts` covers both paths and passed `2/2` on
  2026-09-03.
- Dynamic learned context, pinned memory, workspace retrieval, and recalled
  session memory are inserted as labelled `user` DATA messages; the scaffold
  remains the system instruction. This follows the provider authority boundary
  and the OWASP segregation requirement.
- `node/src/openapi.ts:432` supplies the shared index service to the route.
- `tests/arch/chat-context.test.ts` now proves bounded valid-snippet injection,
  traversal/missing-file rejection, degraded metadata, and final-user ordering
  over real HTTP with stubbed index/router seams. It passed `1/1` on 2026-09-03.
- The first test exposed a real strict-contract drift: chat returned
  `memory_recall_hits`, `memory_recall_tokens`, and `memory_recall_degraded`
  without declaring them in `common/contracts/chat.ts`. Those optional fields
  are now declared and OpenAPI was regenerated; `openapi-drift.test.ts` passed
  `2/2`.
- `tests/arch/chat-context.test.ts` asserts the retrieved block has role `user`
  and that the first system message does not contain retrieved file content.
  The non-stream and SSE route battery passed after the role-boundary fix on
  2026-09-03.
- `daemon/server.mjs` has no equivalent verified hybrid retrieval path; legacy
  parity is open.
- `daemon/server.mjs` has no equivalent verified hybrid retrieval path; legacy
  parity and real-model grounded-chat remain open.
- The next gate is the researched message-role decision, followed by legacy
  parity and a real-model grounded chat probe. Do not claim universal grounded
  chat yet.
