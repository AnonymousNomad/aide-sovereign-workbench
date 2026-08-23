---
name: aide-unified-diff-repair
description: SOP for fixing the README scorecard blocker — bundled models pass function/planning smoke tests but FAIL strict unified-diff formatting. Covers the two-sided fix (harness-side tolerance+repair loop in the agent-loop parser, and model-side data/training fix via format-targeted post-training), decision rules for which side to fix, and the verification battery that proves the scorecard claim changes honestly. Use when working on diff/SEARCH-REPLACE parsing, when smoke tests fail on formatting, when planning the next post-training round, or before updating README claims.
---

# Unified Diff Repair — making strict formatting pass HONESTLY

## Verified problem statement
README/model scorecard (as of 2026-08-24): all three bundled models PASS function-call and planning smoke tests, FAIL strict unified-diff formatting. The agent loop already tolerates CRLF + loose-indent + multi-block SEARCH/REPLACE (tests/unit/test-a1-agent.mjs covers exact/CRLF/loose-indent/two-blocks/NO_MATCH-quality) — so failures are about models emitting malformed or non-canonical blocks under strict-mode evals, not total incapacity. Two root causes possible per model: (a) format knowledge gap → data/training fix; (b) format drift under long context → harness reminder fix.

## Research base
1. Project doctrine already in place: RESEARCH_LOG.md "Unified Diff Reliability" entry (2026-08-12); docs/evidence/dap-wire-sequence.json unrelated; a1 parser tests = current tolerance surface; multi-format-retention-repair skill governs fixing one format WITHOUT regressing others; post-training-closed-loop skill governs eval→regenerate→retrain cycle; pipeline-phase-9 no-vacuous-pass laws apply to any "fixed" claim.
2. Industry practice: OpenAI/Claude code-edit agents converge on constrained structured edits (search/replace blocks over raw unified diffs) because token-level diff syntax (line counts, @@ hunks) is brittle for small models; strict unified diff is a HIGH-burden format — line-count arithmetic errors are the classic failure.
3. IFScale/adherence research (see aide-harness-prompt-scaffolding): format contracts belong in the shortest possible L1 layer with an example — one canonical example beats paragraphs of rules.

## Decision rule — WHICH side to fix first
1. Reproduce failing case → classify error: WRONG-HUNK-COUNTS (unified-diff arithmetic), MALFORMED-MARKERS (unclosed/garbled fences), SEMANTIC-DRIFT (right shape, wrong content), CONTEXT-DRIFT (correct at turn 1, degrades by turn 6+).
2. MARKER/MALFORMED + CONTEXT-DRIFT → HARNESS fix (scaffold example re-injection, mid-conversation reminder hook). Cheapest, zero training cost.
3. WRONG-HUNK-COUNTS on small models → prefer SWITCHING the contract: our SEARCH/REPLACE grammar avoids hunk arithmetic entirely; if the failing eval demands literal `diff --git` output, either (a) generate it deterministically FROM accepted SEARCH/REPLACE edits (harness synthesizes valid hunks — counts computed by code, never by the model) or (b) accept that sub-1B/3B-class models should not be judged on raw unified diffs and FIX THE SCORECARD definition instead (claim honesty > forcing format).
4. SEMANTIC-DRIFT / persistent MALFORMED across fresh sessions → DATA fix: closed-loop regeneration of verified examples targeting ONLY the failing pattern (multi-format-retention-repair rules: never regress other formats; replay mix mandatory).

## Harness-side implementation plan (Phase D1)
1. Extract canonical EXAMPLE into scaffold L1 (aide-harness-prompt-scaffolding): one byte-exact well-formed block per task_family, versioned.
2. Parser repair ladder (agent-loop, BEFORE failing): trim leading whitespace-only lines around markers → normalize CRLF → close unclosed trailing marker if file-end unambiguous → NO silent content guessing beyond existing loose-indent rules (each repair step increments session.repair_count).
3. Repair-loop gate: if repair_count ≥2 in one session → inject mid-conversation format reminder (L0+L1 re-injection hook from scaffolding skill); ≥4 → typed failure surfaced to user with the model's raw block attached for debugging (never silently swallow).
4. Diff synthesizer (new pure module): accepted SEARCH/REPLACE edit + current file bytes → VALID unified diff with computed counts (this makes "strict unified diff" outputs always-arithmetic-correct regardless of model). Unit-test against git apply --check as oracle.

## Model-side plan (Phase D2, only after D1 metrics)
- Closed-loop: collect failing generations (with scaffold_version tags) → regenerate with stronger teacher within kd-teacher-strengths envelope → AST/parse-verify → near-dup check vs corpus index (zero-dup law) → SFT top-up mix ≤10% new data, ≥90% replay (retention doctrine).
- Gate: strict-format pass rate improves WITHOUT function/planning regression (paired CI stats, fresh-normalizer rule from pipeline-phase-9).

## Pitfalls / bugs watch-list
1. Repair masking capability loss: repair_count telemetry must be visible in eval reports — a model "passing" only via aggressive repair is NOT passing strict mode; report both numbers.
2. Diff synthesizer correctness edge cases: CRLF files, no-trailing-newline files ("\ No newline at end of file" marker), binary-ish content, unicode — each needs a unit fixture; wrong synthesized diffs corrupt user files worse than model errors.
3. Scorecard honesty: changing the eval definition (decision-rule 3b) requires updating README text in the SAME commit with explicit note "eval now measures X" — never let old claims stand next to new definitions.
4. Retention risk when fine-tuning format: SEARCH/REPLACE quality is load-bearing for the whole product — every D2 run re-runs the FULL a1 parser suite + web/env floors (collapse precedents documented in pipeline-phase-8).
5. Long-context drift recurs AFTER scaffold fix? Verify reminder hook actually fires (log assertion), then consider transcript compaction instead of more reminders.

## Threat matrix
| Threat | Control |
|---|---|
| Overfitting to the 20-task battery | battery rotates from a private pool; eval prompts never enter training data (contamination scan) |
| Repair ladder corrupting user files | repairs only touch whitespace/markers around blocks; original raw block preserved in session log for undo/audit |
| Silent format regression in other families | multi-format retention suite gates EVERY change (web/env/envelope floors) |
| Claim inflation in README | scorecard numbers regenerated by CI-verifiable script run; manual edits to scorecard blocked by review checklist |

## Verification battery
1. Unit: parser repair-ladder table-driven tests (input variant → expected normalized block + repair_count); synthesizer vs `git apply --check` oracle across 15+ fixtures incl. no-newline/CRLF/unicode.
2. Integration: scripted-chatFn e2e where model emits broken-then-fixed block → assert single reminder injection + successful write + repair telemetry.
3. Eval honesty run: full smoke battery × 3 seeds, report {strict_pass_raw, strict_pass_repaired} per model into docs/evidence/diff-repair-report.json + README scorecard update ONLY from that artifact.
4. Standard chain: tsc x2, eslint, arch suite, veritas PASS, CI green, journal entry with before/after numbers.
