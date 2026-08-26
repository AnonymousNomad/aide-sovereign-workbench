# Skill: desktop-control-trajectory-generation

# Desktop-Control Training Corpus Generation (Phase C of the Desktop-Agent Program)

## Problem It Solves

UI-TARS's hardest-won lesson applies to us: procedural action-only data produces
surface mimicry without internalized logic. This skill defines how we generate,
verify, gate, and version training trajectories for the desktop-control model —
every row carrying explicit reasoning, every row execution-verified (R3).

## Research Foundations

| Source | Fact | Rule here |
|---|---|---|
| UI-TARS 2 data flywheel | CT→SFT→RL stages; verifier V(s) routes rollouts: V=1 → SFT pool, V=0 → lower-stage pool | Same routing: PASS → sft pool, FAIL → reflection/DPO pool, never discarded silently |
| UI-TARS 1 | Reflection tuning on failure-recovery traces beats clean-only data | ~15% of rows must be recovery traces: mistake → observed consequence → corrected action |
| UI-TARS DPO | Preference pairs from same-task correct vs incorrect actions beat generic pairs | DPO pairs are SAME snapshot + different action + verified outcome delta |
| zero-dup-high-quality law (house) | No duplicate/near-dup docs; highest quality or nothing | Jaccard dedup on observation+action sequence; seed-driven diversity |
| anti-trash-data-doctrine | Generated data passes identical gates as scraped data | Verifier stamp or the row does not exist |
| trio dataset laws (aide-trio-tuning) | Assistant-only masking; structured truncation; phase gates | Same collation rules; observations are masked context, actions+thoughts are targets |

## Corpus Composition Targets (v0)

| Slice | Share | Source |
|---|---|---|
| Clean task trajectories (Thought+Action per turn to finished()) | ~55% | seeded sandbox rollouts, verifier-PASS |
| Recovery/reflection trajectories | ~15% | injected faults: wrong window focused, element disabled, typo'd value |
| Refusal-recovery (FORBIDDEN class → call_user/alternative) | ~10% | probe actions against gated targets |
| Permission-gate interactions (approve flows rendered honestly) | ~10% | WRITE/OPEN tasks incl. PENDING_APPROVAL turns |
| Idle/honest-failure endings (call_user when stuck) | ~10% | intentionally unsolvable variants |

Scale target for v0 gate: ≥800 verified multi-turn tasks (~15–25k turns), matching
trio-program scale that already proved itself on this card.

## Seed Task Design (the diversity engine)

Seeds live in `desktop_seeds/*.json`: {task, app_scope, steps_hint, assertions[],
difficulty 1-5, category}. Categories v0:
file_ops(notepad/explorer), settings_flows(calculator/browser), form_filling,
app_launch_and_navigate, cross_app_copy, browser_activated_flows.

Diversity laws:
- Evolve don't copy: each batch mutates app order, values, window counts, error
  injection points; no two seeds share >0.85 Jaccard on step skeleton
- Values randomized (names, amounts, paths from a fixture bank) so the model learns
  process, not strings
- Every seed lists its ASSERTIONS up front — written BEFORE rollout, not after

## Rollout Protocol

```
for seed in seeds:
    session = executor.new_session(scope=seed.app_scope)
    traj = record(seed, policy=current_model_or_scripted_teacher)
    verdict = assertions.check(traj.final_state)      # V(s)
    if verdict == PASS          -> sft_pool(traj)
    elif fault_was_injected     -> recovery_pool(traj)   # only intentional faults
    else                        -> dpo_candidates(traj)  # pair w/ a passing variant
    audit_log.rotate(session_end=True)
```

Two generator modes:
1. **Scripted teacher** (deterministic pywinauto scripts per seed family): writes
   gold Thought lines from templates + real snapshots. Cheap, reliable, boring —
   the backbone of v0.
2. **Model rollouts** (current checkpoint): rejection-sampled; only verifier-PASS
   rollouts enter SFT; failures feed DPO/reflection pools. Never self-training on
   unverified output (R3/STaR lesson).

## Row Format (chat template of the trio program)

system: harness scaffold (desktop tier: action-space cheat sheet + refusal law +
scope statement). Each user turn: TASK + latest numbered snapshot. Assistant turn:
`Thought: ...\nAction: ...`. Observation spans are MASKED from loss (context only);
Thought+Action lines carry loss. Final assistant turn ends with `finished(summary)`
or `call_user(reason)`.

## What NOT To Do

1. NO training rows from unverified sessions (no assertion stamp = no row).
2. NO synthetic/fabricated snapshots — snapshots come from REAL UIA renders during
   rollouts (OS-Atlas lesson: grounding data must match reality).
3. NO password fields, personal files, or real user data in any scope — fixtures
   only (E:\desktop_sandbox\fixtures).
4. NO near-dup inflation: dedup before staging (Jaccard >0.85 on step skeleton);
   report collision counts per batch.
5. NO silent schema drift: row validator checks DSL grammar against spec v1;
   rejects unknown verbs/fields loudly.

## Dependencies

- windows-desktop-sandbox-harness (executor + AssertionEngine + audit log)
- aide-desktop-agent-model-spec (DSL v1 grammar — validator generated from it)
- pilot_qlora.py recipe (consumption side), trajectory-recorder spec (record shape)
- Fixture bank under E:\desktop_sandbox\fixtures (created by this phase)

## Verification Gates (before Phase D fine-tune may start)

- [ ] ≥800 staged rows, all with PASS/recovery stamps + audit-log sha linkage
- [ ] Dedup report: 0 collisions >0.85; category coverage within ±10pp of targets
- [ ] Format validator: 100% of staged rows parse; DSL grammar violations = 0
- [ ] Held-out 40-seed eval set locked (hash-listed) BEFORE training starts
- [ ] Human spot-check: 20 random rows reviewed for Thought quality (not filler)
