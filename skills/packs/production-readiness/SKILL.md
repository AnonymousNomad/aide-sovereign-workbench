---
name: production-readiness
description: Master roadmap for taking the FSI_Trek / queen-bee-v5 pretraining baseline (16.9M params) from Gate 0 to a production-ready, state-of-the-art-for-its-class model. Use when pretraining is finished and the next path forward must be decided — it sequences the post-training stages (via post-training-pipeline and its four stage skills), adds the 2026 small-model research decision-rules, defines the honest evaluation harness, and covers the production/deployment layer (quantization, serving, monitoring). Load this first to decide the next step, then load the matching stage skill.
---

# Production Readiness & SOTA Roadmap — queen-bee-v5 (16.9M)

The top-level "what next" for a finished pretraining baseline. Everything here is grounded in the 2026 research table. The four post-training stage skills carry executable detail; THIS skill is the decision layer + production layer on top.

## Baseline (frozen 2026-08-05, `E:\queen-bee-v5\baseline\`)

- FSI_Trek Dual-Mind, **16,920,512 params** (~16.9M), fp32 = 64.5MB, vocab tokenizer_v5.json
- Pretraining: 32,000 steps, 38.7M tokens, 3-level curriculum; ckpt_best step 30,001
- Held-out eval (per level — this is the TRUE picture, NOT the trainer's logged 0.0304):
  | level | val_loss | PPL |
  |---|---|---|
  | simple | 0.358 | 1.43 |
  | medium | 0.098 | 1.10 |
  | **complex** | **2.714** | **15.1** |
  | overall | 1.057 | 2.88 |
- Cloze 9/10 (margin +0.19); py_parse **0/4** (no parseable code yet); decode 20.8 tok/s fp32 GPU
- Gaps: (1) complex-bucket PPL 15, (2) generation not parseable. These two define the post-training job.

## What "state of the art" means for this class

- HONEST framing (never in public READMEs as a claim): a 16.9M model competes within its class — tokens-per-param efficiency, domain capability on its verified task suite, and edge deployability. Reference points from 2026 research: L20-Edu-135M (RLVR without cold-start hurt GSM8K; a full 135M single-GPU pipeline is an auditable benchmark), SOD/OPD students (0.6B reaching AIME 26% via on-policy distillation — the mechanism we can emulate at 16.9M, not the absolute score).
- "SOTA-for-class" targets for queen-bee-v5: (a) byte-exact doc/chat format rate >= 0.95, (b) py_parse code-gen >= 0.75, (c) solve-rate on its OWN verified task suite (the qwen35 code tests + gold-doc probes) >= 0.8, (d) complex val PPL within ~2x of simple, (e) edge footprint < 25MB quantized.
- Bench against FLOOR hardware, not ideal hardware (loco-bench principle): if it runs on GTX 1060 6GB / Pi-class, it runs anywhere.

## 2026 Research Decision-Rules (this is the "next path" logic)

| Source (2026) | Finding | Rule applied to queen-bee-v5 |
|---|---|---|
| Distil Labs RLVR study | RL helps open-ended/generative tasks (+2.0pp), NOT constrained/structured tasks (-0.7pp, zero-gradient problem) | RLVR/GRPO ONLY for open-ended code-gen and free-form generation. For structured outputs (format envelopes, classification) SFT is the entire fix — do NOT RL them. |
| arXiv 2603.20100 (SFT-DPO) | Full-parameter FT beats LoRA at small scale; LoRA no wall-clock win | Full FT always (pipeline rule, reconfirmed). DPO = small task-dependent gains; stage it, measure, keep only if Gate 3 improves. |
| arXiv 2605.22731 (state-distribution) | Mild SFT = gains w/o forgetting; stress SFT = retention loss; on-policy distillation (OPD) can beat its own teacher | SFT is ONE epoch, modest LR. The complex-gap fix belongs to KD/OPD, not a second SFT. |
| SOD arXiv 2605.07725 (ACL) | Step-wise on-policy distillation: dense token-level teacher supervision, divergence-modulated reweighting; beats SFT AND GRPO at small scale for reasoning | STAGE 2 preferred method = OPD-style (on-policy, trajectory-level), not pure off-policy teacher traces alone. Ground in post-training-distill. |
| Direct-OPD arXiv 2607.05394 | Distill the teacher's RL-induced policy shift (pre/post-RL checkpoint pair) as implicit reward → weak-to-strong | If we ever RL a small model and want to reuse it into a bigger stage: use Direct-OPD, not imitation. |
| Robust RL for SLMs arXiv 2607.25091 | Capacity-headroom: RL works only when base is fluent (PPL < 20) + reward is discriminative. Failure modes: LoRA freezing, bf16 overflow (use fp32), reward-model error | Gate for any RL stage: base PPL < 20 (we are 2.88 overall — PASS, but complex is 15, so run RL on tasks, not corpus-wide). fp32 only. Whitened rewards, importance-ratio guard, weight rollback. |
| L20-Edu-135M arXiv 2606.22189 | Direct GRPO without cold-start hurt a 135M model (sparse-reward cold-start) | NEVER run RL before a format-passing SFT + a solve-rate distillation (pipeline Gates 1 & 2). Cold-start is mandatory. |
| Quant benchmarks 2026 (Presenc AI, CoderCops) | Q4_K_M = production sweet spot: 1-2% PPL loss, ~3.5-3.8x speedup, ~4x memory. Below Q4 (Q3/Q2) shows real reasoning regression | Export quantization target = Q4_K_M (or Q5_K_M if reasoning-critical). Never ship Q3 or below. |
| TinyBench / edge 2026 | Thermal + sustained load, not peak compute, is the binding constraint; CI must gate latency/memory/size per release | Build a CI microbenchmark gate (size, first-token, steady-state tok/s, RSS) before every deployment; test sustained, not single-shot. |

## The Roadmap (stages in order; each ends with a GATE)

```
GATE 0  (DONE 8/5) Pretraining finalization
        -> baseline frozen + eval_baseline.json + BASELINE.md
        |
        v
OPTIONAL 0.5  Complex-bucket close-out  [only if complex PPL stays >> simple after SFT data is built]
        -> continued pretraining on the complex token range ONLY (0..val_holdout[2][0])
        -> gate: complex val PPL cut >= 50% without simple/medium regression

        *** EMPIRICAL RESULT (2026-08-06, RUN AND FAILED — DO NOT REPEAT) ***
        6,000 complex-only steps at LR 3.4e-5 from step 30,001 (TREK_COMPLEX_ONLY=1):
        complex PPL 15.095 -> 14.857 (best) -> 16.961 (final). Gate FAILED (+12% at
        final). Simple regressed 1.43 -> 2.94, cloze 9/10 -> 7/10, medium 1.10 -> 1.28.
        Diagnosis: complex TRAIN loss was already ~0.35 while val was ~2.7 (PPL 15) —
        the model memorizes complex training tokens but cannot generalize to the
        complex holdout. This is a capacity/generalization gap, NOT an exposure gap;
        more fitting of the same distribution cannot fix it and actively unlearns
        simple/medium (skewed-subset catastrophic regression). COMPLEX GAP FIX BELONGS
        IN STAGE 1-2 (SFT + distillation), not in more pretraining. Baseline step 30,001
        remains the best all-around checkpoint and the Stage 1 base.
        Tool: E:\queen-bee-v5\eval_stage05.py (3-checkpoint per-level audit);
        results E:\queen-bee-v5\eval_stage05.json + stage05_ckpts\.
        |
        v
STAGE 1  SFT / instruction tuning (skill: post-training-sft)   [LR 1e-4..3e-4, ONE epoch, full FT]
        -> (gold_doc, format-envelope) pairs; target byte-exact <task>..<deliver> format
        -> data: gold_* docs + gold_qwen35_code_* + kd_* — this is where py_parse must turn positive
GATE 1  format rate >= 0.9 on held-out docs; py_parse >= 0.5 (from 0/4);
        cloze NOT regressed; complex val not exploded by stress-SFT
        |
        v
STAGE 2  Knowledge distillation (skill: post-training-distill)  [teacher = Qwen3.5-4B, exec-verified only]
        -> code traces + reasoning traces; PREFER OPD-style on-policy + divergence reweighting (SOD)
        -> prompt-erasure, multi-strategy, execution gate (MapCoder-Lite rule)
GATE 2  solve-rate on verified task suite (qwen35 tests + gold probes) >= 0.6 baseline -> 0.8 target
        |
        v
STAGE 3  Preference (skill: post-training-preference)   [DPO 1 epoch, LR 1e-6..1e-5]
        -> build (pass, fail) pairs ONLY from verifier results (exec pass vs exec fail)
        -> optional RLVR/GRPO on OPEN-ENDED code-gen ONLY (Distil Labs rule), cold-start satisfied,
           fp32, whitened rewards, importance-ratio guard, rollback, small rollouts (4-8)
        -> skip RL on any structured/constrained task (zero-gradient, L20-Edu negative result)
GATE 3  final suite: solve-rate + format + cloze + py_parse + abstention/calibration; export
        |
        v
STAGE 4  Closed-loop (skill: post-training-closed-loop) — perpetual: eval -> failures -> verified
        re-generation -> retrain -> repeat. Never feed unverified output into any stage (STaR lesson).
        |
        v
PRODUCTION  Deploy (below)
```

## Production Layer (2026 practice)

1. **Checkpoint lineage**: sft -> distill -> dpo -> rlvr, each on a fresh base copy; never overwrite. Export the model that passes GATE 3.
2. **Quantize**: target Q4_K_M (~16-20MB from 64.5MB fp32) via GGUF (llama.cpp) or ONNX Runtime Mobile; Q5_K_M if reasoning-critical; NEVER Q3/Q2.
3. **Serve**: GTX 1060 6GB (full offload, fp32 20.8 tok/s today → Q4 faster) AND edge targets (CPU-only / browser WASM / phone). GGUF+llama.cpp for portability; ONNX RT Mobile for C++/container services.
4. **CI gates per release** (TinyBench/edge lesson): model file size, first-token latency, steady-state tok/s, RSS — tested SUSTAINED (warm), on the floor hardware. Fail the release on regression.
5. **Monitoring**: latency, memory, thermal, throughput; fallback-to-cloud for out-of-scope queries; caching/prompt-dedup.
6. **Model card + honest metrics**: report per-level val (never the old single "val_loss 0.03" artifact — it sampled only level-0), cloze, py_parse, format rate, solve-rate, speed, size. Public README = pure technical description (novel arch, from scratch, solo dev, 16.9M params).

## The Honest-Eval Harness (maintained through all stages)

- Per-level held-out val (simple/medium/complex) — rebuild from token_curriculum_cache.pkl with fixed seed 42, ALWAYS.
- Cloze 10-item suite; py_parse 4-prompt; format-adherence on held-out docs; verified task suite (qwen35 tests).
- Tool: `E:\queen-bee-v5\eval_final.py` (mirrors trainer evals + per-level + speed). Baseline in `E:\queen-bee-v5\baseline\eval_baseline.json`.
- Every stage boundary: rerun full harness, log every number in AGENT_NOTES. Never claim improvement on a single metric alone.

## Non-negotiable (all inherited + this layer)

1. Never RL before format-passing SFT + solve-rate distill (cold-start; L20-Edu lesson).
2. Never RL structured/constrained tasks (Distil Labs zero-gradient).
3. fp32 only on Pascal; no LoRA; one epoch per SFT/DPO; full-FT.
4. Unverified self-generated data NEVER enters any stage (STaR).
5. Report per-level val; never the level-0-only artifact.
6. Public-facing text stays technical-only.

## Reference the skill from AGENT_NOTES

Every status/decision entry names this skill (`via skill: production-readiness`) and the active stage skill.

Base dir: C:\Users\Grey_\.agents\skills\production-readiness
Stage skills: post-training-sft, post-training-distill, post-training-preference, post-training-closed-loop (siblings); orchestrator: post-training-pipeline.
