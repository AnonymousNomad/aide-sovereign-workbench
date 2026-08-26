---
name: aide-phase-router
description: Phase-aware model delegation for the AIDE orchestrator — detects the working phase (plan/code/debug/test/review/utility) from user text + tool-result signals, routes each phase to the engine whose measured profile fits it, hands off between phases with compressed context summaries behind approval gates, and learns model-role pair outcomes into Loop C. Build AFTER Situation Object and BENCH verdicts exist. Use when implementing phase routing, role assignment, handoff summaries, or model-outcome learning.
---

# Phase Router — Smarter Delegation of the Models You Have

Collaborator insight 2026-08-25: "Not more models. Smarter delegation of the
models you have." Research base: router-llm phase gateway (5 slots, rule-based
detection first-match-wins), CodeRouter layered detection (L1 regex ~2ms ->
L2 tool-history ~3ms -> L3 agent fingerprint -> L4 LLM fallback rare;
transparency headers X-Phase-Confidence), NeMo Switchyard stage+escalation
routers (tool activity decides capability need; session affinity), ACRouter
C-A-F loop (execution-grounded memory beats static classifiers OOD),
Feedback-Over-Form (refiner capability > generator identity).

## Local verification mandate (added 2026-08-25 — operator/collaborator law)

The cited gains are CLOUD DOLLAR-COST claims. Local translation (right model =
faster perceived tok/s + better coherence via specialization) is a HYPOTHESIS.
Before any improvement claim:
1. Paired battery runs: routed multi-engine vs single-engine baseline across
   PLAN/CODE/DEBUG/TEST tasks, same fixed task set as the harness battery.
2. Measure locally-meaningful metrics only: tok/s of chosen engine (from reply
   timings), gate pass rate, time-to-green, and coherence spot-checks.
3. Publish deltas incl. negatives in docs/evidence/. delta <= 0 -> redesign
   routing table rather than keep it.
4. Never quote cloud percentages in AIDE copy. Our numbers or silence.

## Phases

PLAN · CODE · DEBUG · TEST · REVIEW · UTILITY
Detection (cockpit-side, deterministic, <10ms):
- L1 regex on the describe/task text (plan/design/approach->PLAN;
  write/create/implement/build->CODE; why/fails/error/fix->DEBUG;
  test/pytest/assert/coverage->TEST; refactor/simplify/clean->REVIEW;
  typo/format/rename->UTILITY).
- L2 tool-result signals inside an active agent session: last tool_result
  contains error|traceback|FAIL -> DEBUG; PASS|Ran N tests -> TEST;
  repeated read_file without writes -> PLAN.
- L3 explicit operator override: phase picker chip overrides all (confidence 1.0).
Confidence stored and shown (X-Aide-Phase style transparency).

## Role mapping (uses EXISTING roles[] registry)

PHASE_ROLES = { PLAN:['planning','chat'], CODE:['coder'], DEBUG:['coder','chat'],
TEST:['chat'], REVIEW:['reviewer','chat'], UTILITY:['utility','chat'] }.
Engines declare roles via manifest/profile (`roles` field, defaults ['chat']).
Selection = routeForRole(phaseRole) filtered by served ctx fit + fastest
measured tok/s (BENCH verdicts; estimated labeled). Single-engine pools degrade
gracefully: same engine serves every role (never block work).

## Handoffs (context summary, not raw dump)

At phase boundary: H1 handoff bundle subset = {intent, phase, planSummary,
filesTouched, gateResults, openQuestions} — machine-built, <=400 tokens.
Approval gate at EVERY switch: card shows "PLAN complete on <engineA>. CODE
next on <engineB> (N t/s measured). [APPROVE HANDOFF] [STAY ON <engineA>]".
STRICT delegation adds a gate on every tool call; STANDARD gates writes only.
Thread renders engines as labeled segments — one conversation, many brains,
full attribution.

## Learning layer (Loop C integration)

Every completed phase appends to .aide/library/events.jsonl:
{phase, engineId, outcome: pass|fail|rejected, gatePenalty, durationMs}.
Distillation counts model-role pair outcomes; router prefers winning pairs
(min 5 samples, per aide-the-quad law). No cloud, no weights touched.

## Guards

- Fallback chain: requested role unavailable -> next role in map -> current
  engine -> explicit ask. Never silently downgrade capability for PLAN/REVIEW.
- Internet-return does NOT auto-switch to cloud; CLOUD chip stays informational
  until continuity slice ships opt-in handoff (Continuity Law).
- Similarity guard (R-work prevention): before applying a new proposal, diff
  against rejected proposals in events.jsonl; >80% overlap surfaces
  "You rejected this approach — proceed or revise?" (collaborator point 4).

## Pitfalls

- Regex phase detection misfires on short prompts ("fix it" -> DEBUG even when
  implementing) — require L2 confirmation when transcript exists.
- Don't switch engines mid-phase without a gate; mid-thought swaps lose
  tsserver document state (didOpen resync required on switch).
- tok/s comparisons must be same-backend (vulkan-vs-cpu numbers are not
  comparable — see backend-autoselect).
- Empty roles[] on imported fine-tunes: default ['chat'] and surface a hint to
  set roles in MODELS panel (fine-tunes may deserve coder/planner roles).

## Gates

1. Unit: detector table (text -> phase) incl. ambiguous cases returning
   fallback with low confidence; role-map resolution with missing roles.
2. Integration: two-engine pool (mock chatFn) completes a PLAN->CODE->TEST
   sequence touching both engines with handoff summaries asserted.
3. Live: real task through cockpit produces phase labels in thread, engine
   segments attributed, outcomes appended to events.jsonl.
4. Battery non-regression unchanged (routing never touches gate scoring).
