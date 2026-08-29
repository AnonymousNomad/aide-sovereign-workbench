# Overflow-Resilient Chat — Competitiveness Push #1

**Date**: 2026-08-29 · **Status**: implemented + verified · **Actor**: Cline

## The competitive gap (evidence: capability-audit-router.md, 2026-08-28)

The harness-ON audit view hard-failed 4/23 tasks with **zero output** —
`B3`/`G1` (HTTP 400: "local runtime returned HTTP 400") and `C1`/`D1`
(60 s aborts with 0 bytes). Cursor/Windsurf/VS Code degrade gracefully on
long prompts; AIDE died. Root cause chain (verified in code):

1. `model-router.ts` fit history against the **manifest-declared**
   `context_tokens`, while the engine serves a **clamped** window
   (`getEffectiveContext` existed but was never consulted at chat time).
2. When prompt + `max_tokens` exceed the served window, llama.cpp returns
   **HTTP 400**; `model-runtime.ts` surfaced it as `CHILD_FAILED` → HTTP 504
   with empty output.

## What changed

- **`node/src/services/model-runtime.ts`** — new `getEffectiveBudget()`
  (served window minus completion reserve; fallback to declared) and
  `refitForOverflow()` (newest turn preserved; oldest history dropped;
  oversized single turns head-trimmed). `chat()`/`chatStream()` now rescue an
  HTTP-400 overflow with **one** refit retry instead of throwing empty-output
  504s.
- **`node/src/services/model-router.ts`** — `fitForRoute()` fits history
  against the **effective served window** (not declared); `overflowTrimmed`
  is surfaced in `RouteChatResult` so the UI can say "history trimmed to fit
  the model's window" the way commercial agents do.
- **`tests/arch/context-overflow-rescue.test.ts`** — stub llama.cpp engine
  returning 400 over threshold, `/props` n_ctx, streaming + non-streaming
  paths, negative case.

## Verification (all live, this machine)

| Check | Result |
|---|---|
| `tsc --noEmit -p tsconfig.node.json` | **TSC_EXIT_0** |
| `tests/arch/model-router.test.ts` | **13/13 PASS** (3 new) |
| `tests/arch/context-overflow-rescue.test.ts` | **3/3 PASS** |
| `tests/arch/model-runtime.test.ts` | **9 pass / 0 fail / 1 env-skip** (MRT_EXIT_0, includes real llama-server spawn + teardown, 405 s) |
| Full arch sweep (`scripts/run-arch.mjs`, 311 tests) | 308 pass; the single fail was **openapi contract drift** (yesterday's chat-meta edit without regeneration) — fixed by `npm run contracts` (`CONTRACTS_EXIT_0`), drift test now **2/2** |

## Traceability

- Audit artifacts: `docs/evidence/capability-audit-{summary,router,cipher-4b}.md`
- Fixes audit tasks B3, G1, C1, D1 root cause class.
- Improves the "harness hurts" delta (0.698 raw vs 0.563 harness): overflow
  hard-fails were 4 of the 10 harness FAILs.
