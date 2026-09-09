---
name: aide-helix-memory
description: The Helix Memory subsystem — AIDE's deterministic, model-free 30-day project memory (up to 1 year+ with retention rollups). X1 event spine (memory-spine.mjs), X2 semantic join (helix-join.mjs patterns.jsonl + [learned] injection), X3 retention rollup (helix-retention.mjs months/years). Wired into the daemon via routes/memory.ts refresh-on-read cascade and surfaced by the system-map helix_memory card. Use when wiring, debugging, or extending project memory, when the system-map helix card reports offline, when [learned] lines are missing from chat, when patterns.jsonl never appears, or when adding any new work-event source to memory.
---

# AIDE Helix Memory

Deterministic project memory built from event sources AIDE ALREADY captures (the
cipher-state bus + ships.log). ZERO model involvement, zero new deps, single
source of truth shared between the legacy daemon and the TS arch server.

## Architecture (three tiers)

- **X1 spine** — `harness/memory-spine.mjs`. Merges `.aide/cipher-state.jsonl`
  (ship/approval/rejection/abort) + `.aide/metrics/ships.log` (ship_intent) into
  one chronological event stream, rolls up per-LOCAL-calendar-day digests under
  `.aide/memory/days/YYYY-MM-DD.json`. Bucketing uses LOCAL date of the event
  timestamp (NOT ISO/UTC — tests that build events with `toISOString()` misdate
  by timezone). Digest counts ships/files_touched/approvals/rejections/aborts/
  ship_intents, sums tools_used per tool, caps highlights at 10 x 220 chars.
- **X2 join** — `harness/helix-join.mjs`. Reads day digests, extracts pattern-
  candidates, writes `.aide/memory/patterns.jsonl`. Extraction rules require
  EVIDENCE: P1 tool affinity needs >= 3 uses AND >= 60% approval; P2 file
  affinity needs the file in >= 3 different days' highlights; P3 recurring
  highlight needs >= 2 different days. Lifecycle: >= 3 rejections (most recent)
  -> demoted; last_seen > 30 days ago -> archived. Exports `refresh()`,
  `listActive()` (returns `[learned] ...` lines for chat injection),
  `recordFeedback()`, `status()`. IMPORTANT: `refresh()` on thin/empty data is
  CORRECT to return 0 patterns — that is honest, not a bug. Patterns only
  materialize once the evidence thresholds are crossed.
- **X3 retention** — `harness/helix-retention.mjs`. Idempotent additive rollup.
  A month earns `.aide/memory/months/YYYY-MM.json` once the month is > 30 days
  old; a year earns `.aide/memory/years/YYYY.json` once > 365 days old. Day
  digests are never deleted; summaries redrive from them. Exports `rollup()`,
  `readSummary(kind, key)`, `status()`. rollup() is idempotent — running twice
  yields identical written lists.

## Wired paths (VERIFIED 2026-09-10 — do not regress)

- **Refresh cascade lives in the memory route** — `node/src/routes/memory.ts`
  `createMemoryService().listDigests()` refresh-on-read:
  1. `spine.refreshDayDigests()` (X1, bounded to requested window)
  2. fire-and-forget `runHelixCascade()` (X2 `helixJoin.refresh()` then
     X3 `helixRetention.rollup()`) — best-effort, 1.5s timeout per step, a
     failing stage is logged and never blocks the digest response (armor:
     component isolation).
  The route is registered via `routesForMemory(createMemoryService(workspace))`
  in `node/src/openapi.ts` and exposed through the production facade
  (`common/facade-route-map.json` `/api/memory -> ts`).
- **System-map helix card** — `node/src/services/system-map.mjs` `probeHelixMemory()`
  reads the REAL artifacts: counts `.aide/memory/days/*.json`, `months/*.json`,
  `years/*.json` and lines in `patterns.jsonl`. Reports `live` when any exist.

## Traps / dead paths (already fixed — never reintroduce)

- **NO `.aide/memory/helix.jsonl`** exists and nothing ever writes it. The
  historical probe-reading it could never report live. Fixed 2026-09-10.
- **`signals.json` is NOT an expert**. `node/src/services/system-map.mjs`
  `probeMicroExperts()` must exclude `.aide/experts/signals.json` (the
  signal-intensity cache) from the manifest count. Fixed 2026-09-10.
- **NO `.aide/logs/agent-events.jsonl`** exists. `probeAgentLoop()` reads the
  REAL artifact: `.aide/agent-loop-sessions/*.json` (written by routes/agent.ts).
  Fixed 2026-09-10.
- **X3 was a stub** (defined helpers, exported nothing) before 2026-09-10. If a
  `helix_retention` subsystem ever has zero exports again, that is the stub
  resurfacing.
- **Tests**: `tests/unit/test-helix-cascade.mjs` (unit), `tests/arch/
  helix-wiring-runtime.test.ts` (full server end-to-end: digit read drives
  X1+X2+X3, system-map cards live, read-only probe assertions).
- **TS7016**: tests importing harness `.mjs` modules must use
  `createRequire` (like tests/arch/helix-wiring-runtime.test.ts), not a
  bare ESM import with a `typeof import(...)` cast.

## Adding a new work-event source

1. Normalize it in `memory-spine.mjs` `readWorkEvents()` into `{at, kind,
   detail}` (kind in ship|approval|rejection|abort|ship_intent).
2. Add the source file read side-by-side in the `Promise.all` there.
3. If the new kind needs counting, extend `buildDayDigest()`.
4. Follow the X2/X3 cascade automatically (they consume day digests).
5. Prove: run `node --test tests/unit/test-memory-spine.mjs tests/unit/
   test-helix-cascade.mjs tests/arch/helix-wiring-runtime.test.ts`.

## Manual live probe

Drive the cascade directly against a workspace (no server needed):

```js
const { refresh } = await import('./harness/helix-join.mjs');
const { rollup, status } = await import('./harness/helix-retention.mjs');
const ws = 'E:\\aide-sovereign-workbench';
console.log(await refresh(ws));
console.log(await rollup(ws));
console.log(await status(ws));
```

system-map card check (real workspace):

```js
const { createSystemMapService } = await import('./node/src/services/system-map.mjs');
const snap = await createSystemMapService({ workspace: 'E:\\aide-sovereign-workbench' }).getSnapshot();
console.log(snap.subsystems.find(s => s.id === 'helix_memory'));
```