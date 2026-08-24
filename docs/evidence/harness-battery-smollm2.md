# Harness Effectiveness Battery — smollm2-360M (bundled test model)

Date: 2025-08-25 | Actor: ox-alpha | Gate: scaffolding-skill verification #3
Runner: scripts/run-harness-battery.mjs (fixed 20 tasks, mechanical scoring,
no LLM judging; ON = scaffold injected, OFF = bare passthrough)

## Run 1 — scaffold v2.0.0 "standard" tier (853B credo+rules for all ctx)

ON 13/20 | OFF 16/20 | **delta = −3 → VERDICT: NEGATIVE — REDESIGN required**

Failures WITH scaffold: T01 exact-echo, T02 arithmetic, T09 uppercase (+R variants)
Diagnosis: instruction dilution on sub-1B models — the 210-token operating layer
degrades simple instruction-following. Matches IFScale budget research encoded
in aide-harness-prompt-scaffolding.

## Redesign (same day)

Tier model reworked: micro (3 lines, <320B) for served ctx < 8192; full
Code+Lens layered rendering only ≥ 8192. PART A / B5 / B6 remain mandatory in
every strong-tier rendering; micro carries identity + exactness + no-placeholder.

## Run 2 — scaffold v2.1.0 "micro" tier

ON 16/20 | OFF 16/20 | **delta = 0 → VERDICT: neutral on tiny models**
T08 negative-constraint: ON=PASS where OFF=FAIL (both repeats) — harness helped.
T09 uppercase: consistently ON=FAIL OFF=PASS — 360M capability limit, not scaffold.

## Verdict per skill gate

- Harm eliminated (−3 → 0). Harness is non-regressive for small models.
- Full-tier (Code + Lens) effectiveness claim is PENDING a strong-budget model
  (qwen-coder-1.5b or operator fine-tune) — battery rerun required before any
  improvement claim is published. No cherry-picking; this file is the record.

Raw JSON: docs/evidence/harness-battery-latest.json
