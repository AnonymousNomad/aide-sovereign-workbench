---
name: post-training-pipeline
description: Master orchestrator for the full post-pretraining pipeline (SFT, knowledge distillation, preference optimization, RLVR, closed-loop iteration) for the FSI-FELON / queen-bee-v5 small models. Use when a from-scratch pretraining run is finishing or finished and the next phase of training must be decided, sequenced, and gated. References the per-stage skills post-training-sft, post-training-distill, post-training-preference, post-training-closed-loop.
---

# Post-Training Pipeline — Big Tech Playbook (researched 8/5, applied)

This skill sequences and gates everything that happens AFTER pretraining. Each rule is grounded in the research basis table. It is the orchestrator; the four stage skills carry the executable detail for each stage. Load THIS skill first, decide the stage, then load the matching stage skill.

## Research Basis

| Source | Principle | Applied as |
|---|---|---|
| Llama 3 (Meta, HF blog 2024) | Post-training = SFT + rejection sampling + PPO + DPO over 10M human-annotated samples; rejection sampling filters SFT outputs with a reward model before preference tuning | Order: SFT -> (optionally rejection-sample the SFT outputs) -> preference. Never skip SFT before RL. |
| DeepSeek-R1 (arXiv 2501.12948) | 4-stage pipeline = 2 RL + 2 SFT; cold-start SFT data BEFORE RL prevents repetition/mixing; RL on verifiable rewards; then DISTILL reasoning into small models (800K samples beat RL-on-small) | Cold-start data first; RL/GRPO only on verifiable tasks; distillation is the cheap route to reasoning for a small model. |
| Orca 2 (Microsoft Research, Nov 2023) | Teacher traces with MULTIPLE reasoning strategies (step-by-step / recall-generate / recall-reason-generate / extract-generate / direct); the solution strategy of a big model is not the best strategy for a small model | Distillation data must carry strategy choice + explanation traces, not just correct answers. |
| Phi-3 (Microsoft, model card 2024) | Post-training = SFT + DPO; corpus = filtered web + synthetic textbook-like + chat-format supervised data; DELIBERATELY drops time-sensitive trivia to save capacity for reasoning | Small models must sacrifice memorization for reasoning; our gold docs are already reasoning-dense. |
| SmolLM (HF, 2024) | Instruct = 1 epoch SFT (WebInstructSub + StarCoder2-Self-OSS-Instruct) then 1 epoch DPO (HelpSteer / dpo-mix-7k), SFT LR 3e-4, Zephyr-Gemma recipe; trapezoidal LR with 20% cooldown at pretrain | SFT for ONE epoch, DPO for ONE epoch; low LR; small curated instruction sets beat big noisy ones. |
| Tülu 3 (Ai2, arXiv 2411.15124) | Post-training taxonomy: SFT -> DPO -> RLVR (PPO on verifiable rewards). Full PPO hyperparams released (LR 3e-7, gamma 1.0, lambda 0.95, eps 0.2, beta KL 0.05, temp 1.0, batch 224, -10 for no-EOS) | Final reasoning stage = RLVR, not open-ended RLHF, because we have verifiers (ast.parse, unit tests). |
| GRPO (DeepSeek-Math / Unsloth 2025) | GRPO: sample 8 completions/prompt, advantage = normalized reward, reverse-KL penalty beta ~0.04, no critic network | Use GRPO (not PPO) on a 16M model; no value head to train, cheaper on a GTX 1060. |
| MapCoder-Lite (EACL 2026) | Keep ONLY execution-passing trajectories; supervisor-correct then prompt-erasure (store I/O not the trace); quality > quantity | Distillation gate: a trace enters the corpus ONLY if a verifier ran it green. |
| SOL-VER (NeurIPS 2025) | Self-play solver+verifier; SFT on passing (P,C,T); DPO preference pairs; iterate; verifier lags solver so co-evolve | Closed loop must train the verifier too (see closed-loop skill). |
| Project lesson 8/3 (STaR) | Self-generated feedback WITHOUT a verification gate self-poisoned the corpus | NEVER write model output back into training data unless an external verifier passed it. |
| LIMA (Meta, 2305.11206) | ~1,000 curated examples beat 65K uncurated for style/format | Small SFT set, byte-exact formats, high curation. |
| SOD (ZJU/Tencent, arXiv 2605.07725, 2026) | Naive on-policy distillation (OPD) on agentic/TIR tasks cascades erroneous tool calls into student-teacher divergence, making teacher token supervision unreliable; SOD reweights distillation per step: w_k = min(w_1 * prod_{u=1..k-1} (d_u+eps)/(d_{u+1}+eps), 1+delta) with d_k = step-mean |log pi_student - log pi_teacher|; final loss L = L_GRPO + L_OPD^step. 0.6B student AIME2025 26.13% avg@32, +20.86% over best baseline | ANY future on-policy stage (student-generated trajectories, TIR-style web-builder loop) MUST use SOD step-wise reweighting + GRPO hybrid. Does NOT apply to our offline score-gated distill (train_distill_150.py = verifier-accepted fixed completions, plain CE — no student generation, no teacher logits); do not retrofit into it. RLVR-on-structured-tasks still deprioritized (Distil Labs 2026: -0.7pp structured). |

## The Pipeline (run in this order)

```
GATE 0  Pretraining finalization (training-from-scratch skill: G/Finalization)
            -> pick best-val checkpoint retrospectively
            -> held-out test eval + cloze suite + generation samples
            -> pass/fail note per capability (py_parse, cloze, format)
            -> build post-train base checkpoint (this is the SFT base)
            |
            v
STAGE 1  SFT / instruction tuning          -> skill: post-training-sft
            (gold docs -> (instruction, completion) pairs, 1 epoch)
            |
GATE 1   Format gate: instruction adherence, byte-exact format rate,
            cloze + py_parse must NOT regress vs base. If format fails -> more SFT data.
            |
            v
STAGE 2  Knowledge distillation            -> skill: post-training-distill
            (teacher traces w/ strategy labels, execution-verified only)
            |
GATE 2   Reasoning gate: solve-rate on verified task suite >= threshold.
            If fails -> fix distillation data (strategy variety, prompt erasure),
            NOT by tuning hyperparameters.
            |
            v
STAGE 3  Preference optimization           -> skill: post-training-preference
            DPO (1 epoch) then optional GRPO/RLVR on verifiable tasks
            |
GATE 3   Final eval: full task suite + cloze + generation quality +
            abstention/calibration check. Only then export.
            |
            v
STAGE 4  Closed-loop iteration (perpetual) -> skill: post-training-closed-loop
            eval -> collect failures -> verified re-generation -> retrain -> repeat
```

## Non-negotiable rules (violating any = redo the stage)

1. NEVER run preference/RL before a format-passing SFT. (Llama-3 order; R1 cold-start lesson.)
2. NEVER feed unverified model output into ANY training stage. (STaR lesson; MapCoder-Lite gate.)
3. ONE epoch per SFT and per DPO stage on a small model; if underfitting, fix data, not epochs. (SmolLM, Zephyr recipe.)
4. Every stage runs on a FRESH copy of the base checkpoint; each stage produces its own checkpoint lineage (sft -> distill -> dpo -> rlvr). Never overwrite the previous stage's checkpoint.
5. Verify tokens/format with tokenizer_v5 and the same special tokens as pretraining. A new chat template is introduced ONLY at SFT and must be frozen for all later stages.
6. A stage is done when its GATE passes, not when loss is low. Loss is a terrible production proxy (project lesson 8/3).
7. All stage data files are versioned under a per-stage dir (e.g. C:\trek_runtime\post_train\sft\) with a manifest; every entry records source, verifier, and pass result.
8. Keep the pretraining LR schedule knowledge: post-training uses a much smaller LR (SFT ~1e-4..3e-4 for a ~16M model; DPO ~1e-6..1e-5; RLVR ~1e-6..3e-7 scale per token count).
9. IF a future stage is on-policy (student samples the trajectory, teacher/logits supervise it — e.g. web-builder agentic loop): apply SOD step-wise divergence reweighting (row in Research Basis). NEVER run uniform-weight OPD on a multi-step tool-integrating task; it cascades errors and collapses SNR (SOD Prop. 1-2). Offline verifier-gated distill (our Stage 2) is exempt — it has no student generation.

## Hardware reality (GTX 1060, fp32, ~16M params)

- Full fine-tuning the whole model is affordable (16M params in fp32 ~= 64MB weights). Do NOT use LoRA/QLoRA here; full FT is cheaper than the plumbing.
- RL: use GRPO with small generation counts (4-8) and short responses; the cost is generation, not gradient memory.
- Every RL/GRPO task must have an O(ms) verifier (ast.parse, exact-match, unit tests). No model-based reward model on this hardware budget for stage 1.
- Keep eval batch >= train batch, step cadence, per training-from-scratch skill.

## Audit checklist (run at every stage boundary)

- [ ] Previous stage checkpoint finalized + gates met (recorded in AGENT_NOTES)
- [ ] Stage data manifest complete (source, verifier, pass result per row)
- [ ] Chat template frozen; tokenizer identical to pretrain
- [ ] Hyperparams per the stage skill; LR scaled for ~16M params
- [ ] Eval suite includes cloze + py_parse + stage-specific task suite; results logged
- [ ] NO unverified self-generated data anywhere in the stage corpus
- [ ] Checkpoint lineage preserved; stage write-up logged in AGENT_NOTES via this skill

## Reference the skill from AGENT_NOTES
Every post-training status/decision entry must name this skill (e.g. `via skill: post-training-pipeline`).

Base directory for this skill: C:\Users\Grey_\.agents\skills\post-training-pipeline
Stage skills: post-training-sft, post-training-distill, post-training-preference, post-training-closed-loop (siblings under ..\skills\)
