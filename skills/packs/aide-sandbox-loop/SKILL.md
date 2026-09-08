---
name: aide-sandbox-loop
description: SOP for the Sandbox Execution Loop — model proposals are written to an isolated scratch copy, tests/lint run against the SCRATCH, only verified diffs reach the user, failures auto-feed error context back for bounded retries. The single differentiator vs Cursor/Windsurf (they show diffs and hope). Use when building or extending proposal verification anywhere in AIDE.
---

# Sandbox Execution Loop

## WHY THIS EXISTS (the differentiation thesis)

Cursor/Windsurf/Copilot: propose diff → human reviews → hope it works → human runs tests.
AIDE: propose → **scratch copy** → **tests execute before human review** → green checkmark +
verified diff reaches the user, or the failure auto-feeds back to the model (bounded retries).
The user's review happens on PRE-VERIFIED changes. This inverts the trust problem and is the
single most demoable, star-worthy behavior AIDE owns. Research alignment:
- Feedback-Over-Form (2604.21950): execution-feedback refinement >4σ improvement BUT bounded
  iterations mandatory (forced extra iterations NET-NEGATIVE) → max 3 retries, early-stop on pass.
- SWE-agent/aider practice: retry-with-error-context beats retry-blind.
- Our own post-training-closed-loop doctrine: generate → AST/exec verify → self-correct → confidence.

## ARCHITECTURE (all local, reuses shipped infrastructure)

```
model proposes patch (SEARCH/REPLACE blocks or unified diff)
  ↓ daemon validates syntax (patch.mjs — SHIPPED)
  ↓ materialize SCRATCH: copy each target file to .aide/scratch/<sessionId>/
    preserving relative paths (only touched files + their package.json chain)
  ↓ APPLY patch to scratch copies (in-memory strings written to scratch)
  ↓ RUN VERIFY COMMANDS via task-service (SHIPPED B1) with cwd=<scratch-root>
    default ladder: detected package manager test script → lint → build
    config: .aide/sandbox.json {commands[], timeout_ms} overridable per project
  ├─ ALL PASS  → verdict card: "✓ verified (N tests)" + diff preview
  │              human approves → atomic apply to REAL files (temp-write+rename)
  └─ ANY FAIL  → stderr/test-report tail (<2KB) appended to retry prompt
                 retry ≤3 total attempts (configurable), then show BEST attempt
                 marked "✗ failed verification — review carefully"
  ↓ every attempt: memory-spine event {kind:'sandbox', attempt, passed, duration_ms}
  ↓ final applied-or-rejected outcome: trajectory row (training stock)
```

## KEY DESIGN LAWS

1. **Scratch is disposable**: `.aide/scratch/` wiped at session end + on boot (stale
   scratch = stale verdicts). Never git-tracked. Never executed outside cwd jail.
2. **Verify commands come from PROJECT CONFIG, never from the model.** The model may
   SUGGEST a command; the human's `.aide/sandbox.json` decides what runs. (Prompt-
   injection law: model output is data.)
3. **Apply is atomic**: write temp file + rename per file; partial-failure stops and
   reports exactly which files applied (hot-exit recovery pattern reuse).
4. **Timeouts bound everything**: per-command timeout_ms (default 120s), whole-loop
   wall clock cap 10min. Hung tests = failed verification with timeout reason.
5. **No network during verify** unless explicitly enabled in sandbox.json
   (`allow_network:false` default — matches orchestrator policy).
6. **Token budget**: error-tail truncation to <2KB per retry; full logs stay on disk
   (.aide/scratch/<sid>/last-run.log) linked in the card.
7. **Advisory micro-expert hook**: diff-risk-gate score attaches to the verdict card
   (advisory chip only — approval hierarchy unchanged).

## WHAT CODE TO WRITE

- `harness/sandbox.mjs` (~200 lines, matching CIPHER-ARCHITECTURE estimate):
  - `materializeScratch(workspace, sessionId, targets[])` → scratch root path
  - `applyToScratch(scratchRoot, patches[])` → per-file results (reuse
    parseSearchReplaceBlocks/applySearchReplace from agent-tools.mjs — SAME grammar,
    single implementation law)
  - `runVerification(scratchRoot, commands[], {timeout})` → {passed, report_tail}
    via execFile per command, sequential, stop-on-first-fail, capture combined output
  - `cleanupScratch(sessionId)`
- Route extension: `POST /api/workflow/plan` gains `sandbox:true` mode OR new sibling
  `/api/workflow/propose-verified` — response adds `{verified:bool, attempts:[], report_tail}`
  (contract-first, regen LAST per route-slice SOP).
- Cockpit: verdict card variant on existing plan/approve cards (green checkmark + test
  count, or red fail + retry count); APPROVE applies atomically (existing apply route).
- Retry loop lives DAEMON-side inside the propose handler (model calls stay server-side).

## PITFALLS / THREATS

| Threat | Mitigation |
|---|---|
| Model-suggested test command executes arbitrary code | Commands ONLY from sandbox.json/package-scripts; model suggestions rendered as text for human opt-in |
| Scratch escape via `../` in target paths | Reuse resolveInsideWorkspace on every target BEFORE copy; absolute/.. rejected |
| Huge repos make copies expensive | Only TOUCHED files + package.json chain copied (not whole tree); node_modules never copied — deps resolved from REAL workspace via cwd trick (run commands with NODE_PATH or run in real dir against scratch-applied CONTENT via temp overlay only if same-volume rename possible; v1 simplification: copy touched files into real workspace under `.aide/scratch-apply/` staging INSIDE repo so relative imports/tests resolve, then clean) |
| Flaky tests poison verdicts | One automatic rerun of failing suite before declaring FAIL (flake guard), both results journaled |
| Test side-effects corrupt real files | Tests run against scratch copies; any tool that writes outside scratch fails path-jail in v1 — document limitation |
| Retry loops burn tokens | Hard cap 3 attempts + wall clock; early-stop on pass (research law) |

## DEPENDENCIES

None new. Uses: patch.mjs + agent-tools grammar (shipped), task-service execFile
pattern (shipped), memory-spine (shipped), micro-expert advisory (shipped).

## VERIFICATION BATTERY (`scripts/sandbox-battery.mjs`)

Fixture project in temp dir: tiny JS lib + passing test file + deliberately broken
function. Probes:
1. PASS path: valid fix proposed → scratch verify passes → verified=true, tests ran
   (assert report contains test-runner signature), real file UNTOUCHED before approval.
2. FAIL→retry: broken fix attempt 1 (fails test) → error tail returned as retry
   context → attempt 2 correct → verified. Assert attempts.length==2, spine rows ==2.
3. Cap: 3 always-failing attempts → verified=false, best-attempt flagged honestly.
4. Path escape: target `../../real-file` rejected pre-copy.
5. Atomicity: force mid-apply failure (read-only target) → partial report accurate.
6. Timeout: infinite-loop command → timeout verdict ≤ configured bound.
7. Flake guard: fail-then-pass suite → rerun engaged, journaled, verdict per policy.
Gate: all green + LIVE demo through :4777 on the REAL workbench fixture (this repo's
own test file) — the demo-GIF shot.

## SEQUENCING NOTE

Build AFTER nothing — this is the next slice per collaborator ranking + operator
confirmation. Demo GIF immediately after battery green (record the live :4777 loop).
