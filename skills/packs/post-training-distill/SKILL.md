---
name: post-training-distill
description: Stage 2 of post-training — knowledge distillation for a small from-scratch model (queen-bee-v5). Use when the SFT checkpoint passes Gate 1 and the model must learn reasoning and verified problem-solving from a stronger teacher. Governs teacher-trace data construction (multi-strategy, execution-verified only, prompt erasure) and the Gate 2 reasoning check.
---

# Post-Training Stage 2 — Knowledge Distillation

Grounded in: Orca/Orca-2 (teacher explanation traces + strategy variety), DeepSeek-R1 (distillation of reasoning beats RL-on-small for small models; 800K samples), MapCoder-Lite (keep only execution-passing trajectories, prompt-erasure), SOL-VER (SFT on passing (P,C,T)).

## Trace LENGTH is capacity-matched (VERIFIED 2026-08-07)
- DeepSeek-R1 recipe: students are 1.5B-70B; their config caps completion at 2048 tokens (`max_prompt_length: 512, max_completion_length: 2048`) — the student is NEVER trained to reproduce the teacher's 32K-token CoTs.
- Yin et al. (Mar 2025), cited in the R1-distill literature: "Plain SFT on distilled LONG CoTs can IMPAIR solution rates in small models" — small students overthink/hallucinate on excessively long or formalistic teacher traces. Length MUST be matched to student capacity, not copied from the teacher.
- Rule for queen-bee-v5 (16.9M, SEQ_LEN 512, prompt ~58 tok): completion budget <= ~450 tokens. Do NOT chunk a long doc and call it distillation — that is continuation-LM, not reasoning trace distillation, and it reproduces the long-trace impairment. Build SHORT (P,C,T) traces from the kd_tests harness SECTIONS (self-contained, verifier-proven), not the 2,500-token long-form docs.

## What "teacher" means for this project
There is no 100B teacher on hand. The teacher is the CLOSED-LOOP VERIFIER SYSTEM: generate candidate solution -> execute -> verify -> self-correct -> keep ONLY the verified final trace. This is teacher distillation from a deterministic critic (the AST parse + unit-test harness + measured-result checks built during corpus production). It is strictly stronger than copying a big model's prose because every kept trace is proven.

## When to run (Gate 1 must be satisfied)
- SFT checkpoint `posttrain_sft.pt` passes the format gate.
- Model can already follow instructions; this stage teaches it to REASON through verified steps.

## On-policy distillation (OPD) — research addition 2026-08-08
- Distilling the CURRENT (student) model's own rollouts from a teacher, with higher
  reward for out-of-distribution examples, beats strong baselines (matched a full
  1T-token teacher). Do NOT distil only from a fixed offline teacher corpus — include
  on-policy rounds: sample the student, run through the closed-loop verifier, distill
  back the verified traces. This is Stage-2's version of our closed-loop doctrine.
- Also: keep distillation corpora DIVERSITY-driven (MiniPLM difference-sampling logic:
  diverse > voluminous at small scale). Repetition of one teacher style collapses
  generalization.

## How to build the distillation corpus
1. Take the kd_tests harness backlog (E:\pip_temp\opencode\kd_tests*.py) — it already contains generate->execute->verify cycles with real caught bugs and corrected solutions. Replay those as (P, C, T): Prompt (task), Completion (the corrected verified solution), Test (the harness assertions that prove it).
2. New traces: for each SFT-era task, sample N candidate completions from the current model, run them through the verifier, keep ONLY the passing ones. Record failures separately (they become preference data in Stage 3, and are NEVER training completions).
3. Strategy labeling (Orca-2): tag each trace with its reasoning strategy — step_by_step, recall_then_generate, recall_reason_generate, extract_generate, direct. Balance the mix; small models need step-by-step most.
4. Prompt erasure (MapCoder-Lite): if a trace was produced by iterating on verifier feedback, strip the intermediate feedback; store only (task -> final verified solution). The student must learn to produce the correct trace directly, not mimic the debug loop.
5. Multiple teacher calls for hard tasks (Orca-2): if a task fails verification, regenerate with the failure message as new instruction, but the STORED trace is only the final passing one.

### Distillation corpus rules
- Quality gate: a trace enters ONLY if the verifier returned PASS (skipped=0 style, same discipline as gold docs).
- One epoch. If the reasoning gate fails, fix the trace data (more strategy variety, harder tasks), not the epoch count.
- Difficulty ramp: easy (single-step, exact-match verifier) -> hard (multi-step, unit-test verifier). Curate the mix.
- Keep measured results in the traces (numbers the model can reproduce), consistent with gold-doc discipline.

## Training recipe
- Same as SFT (LR 1e-4..3e-4, wd 0.01, clip 1.0, one epoch, prompt labels masked), start from `posttrain_sft.pt`.
- DeepSeek-R1 distillation fact: reasoning traces distilled into a small model outperform the same model trained with RL on its own reasoning — so distillation comes BEFORE preference/RL.
- Optionally mix in a small slice (10-20%) of the pretraining gold docs to avoid catastrophic forgetting of the base corpus.

## Gate 2 — reasoning gate
1. Solve-rate on a HELD-OUT verified task suite (unit-test pass@1 on tasks never in the distillation set) >= threshold recorded at Gate 0 (start with the observed base rate; demand an absolute improvement, e.g. +20 pts).
2. Strategy coverage: the model uses step-by-step for hard prompts (sample-level inspection).
3. No regression on format gate or cloze.
If the gate fails: analyze failure mode — wrong strategy choice (add strategy diversity) vs trace overfit (add harder/held-out-style tasks). Never "fix" by more epochs or higher LR.

## Deliverables
- Distillation corpus manifest (task -> strategy tag -> verifier PASS id)
- Checkpoint `posttrain_distill.pt` + reasoning eval report
- Gate 2 pass/fail note; failures logged for Stage 3 preference data

## Audit checklist
- [ ] Every trace execution-verified; failures routed to Stage 3, never into completions
- [ ] Strategy labels present and balanced; prompt erasure applied
- [ ] One epoch, LR 1e-4..3e-4, from posttrain_sft.pt
- [ ] Held-out task suite solve-rate recorded and improved vs base
- [ ] Checkpoint lineage: posttrain_distill.pt is the Stage 3 base
