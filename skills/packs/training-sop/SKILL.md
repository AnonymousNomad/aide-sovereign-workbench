---
name: training-sop
description: The VERIFIED end-to-end Standard Operating Procedure for training a small language model from scratch on THIS machine (GTX 1060 6GB Pascal, i7-8750H, 16GB RAM, Windows) — corpus -> tokenizer -> pretrain -> SFT -> distill -> preference -> closed-loop -> quantize -> serve. Exact numbers per stage (epochs, steps, batch, LR, warmup, clip), measured on real runs, cross-checked against TinyLlama / SmolLM2 / SmolLM3 / SmolLlama / Phi-1 / Muennighoff 2023 / LIMA / Orca-2 recipes. Use BEFORE starting ANY training stage, when auditing a run, when choosing hyperparameters, or when a stage gate must be applied. This skill is the one-stop check: the detailed per-stage skills (corpus-curation, gold-training-docs, training-from-scratch, post-training-sft/-distill/-preference/-closed-loop, device-training-1060, model-scaling) remain the deep references; this SOP sequences them with battle-tested numbers.
---

# Training From Scratch — Verified End-to-End SOP (GTX 1060)

One pipeline, eight stages, five gates. Every number marked `VERIFIED` was observed on a real run on this machine (queen-bee-v5 family, fp32, GTX 1060 6GB). Every recipe was cross-checked against the cited public recipes. If a stage skill disagrees with this SOP, the SOP's numbers are the ones measured here — but re-verify before trusting either.

## 0. Device baseline (non-negotiable)

| Fact | Value | Consequence |
|---|---|---|
| GPU | GTX 1060 Mobile 6GB, Pascal CC 6.1 | NO Tensor Cores. FP32 ONLY (`AMP_DTYPE None`). Never bf16/fp16/TF32. |
| FP16 on Pascal | 1/64 of FP32 rate | FP16 math is SLOWER here — never use it. |
| VRAM | 6GB GDDR5, 192 GB/s | 150M fp32 model + optimizer ~1.6GB; activations fit at batch 8x512. |
| RAM | 16GB total | `num_workers=0` always (Windows DataLoader duplication). Watch total RAM: each model server eats 1-2GB. |
| CPU | i7-8750H 6C/12T | Thermal throttles ~9-14%; keep sustained load sensible. |
| Power | laptop battery | NEVER train on battery (GPU -53%). Plug in. |
| Windows WDDM | verified 8/6, 8/8 | OOM-retry wrapper + `torch.cuda.empty_cache()` every N steps are MANDATORY for runs >~500 steps (long-run fragmentation crashes; 15-step probes do NOT show it). |

## 1. Corpus (Stage 1)

1. **Doc format — byte-exact** (LIMA: format IS supervision; `gold-training-docs` skill): one doc = one executable topic, `Depth L2`, stdlib only, execute-then-write (numbers from a real run, never estimated). Tags in order: `<task> <guidelines> <check> <mind_spock> <mind_sheldon> <code> <execute> <observe> <mind_synthesis> <deliver>`. No generators, no strips, no filler, no emoji, no repeated boilerplate.
2. **Quality gates before staging** (5-gate pipeline, `kd-corpus-production`): executable + observed numbers + byte-exact format + single topic + uniqueness against corpus index (`zero-dup-high-quality`: NO duplicates, verified against the index before staging).
3. **Budget (Chinchilla-optimal tokens ~ 20 x params; deliberate overtraining is the Phi-1 regime, documented, not a bug):**

| Model size | Optimal tokens | This rig processes (VERIFIED pattern) | Epochs over curated corpus (VERIFIED) |
|---|---|---|---|
| 16.9M | ~340M | ~1.05B (4.5x) = 32,000 steps @ 32,768 tok/step | ~28 (Phi-1 textbook repetition; Muennighoff's 4-5-epoch ceiling applies to raw web repeats, NOT curated textbook docs) |
| 28M | ~560M | ~1.7B = ~52,000 steps | ~28 |
| 150M | ~3B | ~3B = ~92,000 steps (device ceiling — expect days, 27%-GPU-util bubble; see model-scaling) | ~8-28 depending on corpus |

4. **Mix rules** (SmolLM2: mix rebalancing beats fixed mix; ≤360M models use SINGLE-STAGE data, not multi-stage): curated docs only; levels 0(easy)->1->2(complex) are curriculum stages, never shuffled together.
5. **Tokenization**: deterministic tokenizer, verify coverage (no heavy OOV on gold docs), memmap token cache with per-level ranges + 5% per-level validation holdout. Rebuild cache ONLY when corpus changed.

## 2. Pretrain (Stage 2) — VERIFIED config (queen-bee-v5 train.py)

| Hyperparameter | Value (VERIFIED) | Source cross-check |
|---|---|---|
| Optimizer | AdamW, betas (0.9, 0.95), eps 1e-8, weight_decay 0.1 | TinyLlama (0.9/0.95, wd 0.1), SmolLM3 identical |
| LR | 5e-4 peak | TinyLlama 4e-4, SmolLM1 5e-4, SmolLM3 2e-4, SmolLlama 6e-4 — 2e-4..6e-4 is the small-model band; 5e-4 measured fine here |
| Schedule | cosine, warmup 1000 steps (~3% of 32k; research band 5-10%, acceptable — do not change mid-run) | TinyLlama 2000 warmup; SmolLM3 2000; WSD optional on next run (decay final 10%) |
| Grad clip | 5.0 (loose; drop to 1.0 only if clip fraction >20%) | GPT-3 1.0, SmolLM3 1.0 — calibrate by clip fraction |
| Batch | 8 micro x SEQ 512 x GA 8 = **32,768 tokens/step** (effective) | SmolLlama 0.5M/step at 130M; GPT-2 124M 0.5M/step — smaller model, smaller batch, same regime |
| Steps | 32,000 (1.05B tokens) | ~28 epochs of corpus |
| Precision | fp32, CUDA, deterministic seed 1 | Pascal: no AMP |
| Curriculum | level range advances by step (easy->hard) | EACL 2026: cuts steps to target loss 18-45% |

**Monitoring (every step in log line: step/loss/lr/grad/cur/speed/MEM):** loss trends down; pre-clip grad norm in a stable band (10-100x jump precedes most spikes — earliest warning); lr follows warmup->cosine or it's a bug.
**Spike detector:** rolling window W=100, flag loss > mu + 5*max(sigma, 0.05*mu) -> `[SPIKE]`.
**Clip fraction:** <5% healthy; >20-30% too aggressive.
**Param norm + grad/param ratio every 2000 steps:** ratio > 0.1 flags instability.
**Val:** 5% holdout per level, VAL_EVERY=500 steps (step cadence, never time), eval batch >= train batch.
**Task eval:** cloze suite (10 items from corpus's measured results; correct vs plausible distractor, length-normalized likelihood) is THE in-run signal; free-form generation stays ~0 at this scale — expected, not a bug.
**Checkpoints:** ckpt_latest + ckpt_best every 500 steps, model+optimizer+step together; never save a NaN step.
**Recovery playbook (in order):** spike -> check if grad spiked before loss (optimizer problem) or loss spiked with clean grads (data batch problem); rollback to best ckpt, optionally cut LR 10-20%; divergence -> LR 2-5x lower from earlier ckpt; early plateau -> LR 2-5x higher on a short probe or check data mix; NaN -> fp32 baseline rules out precision; grad-NaN-first = optimizer/backward bug, loss-NaN-with-clean-grads = forward/activation bug.
**Gate 0 (pretrain done):** best-by-val_loss checkpoint (retrospective, NOT last step), evaluated on held-out test + cloze + samples. Then export base.

## 3. SFT (Stage 3) — VERIFIED recipe

- **Data:** capacity-matched (SmolLM2: 135M/360M strip complex instructions; our 16.9M = short, simple, unambiguous pairs). 1-3K concise pairs built from gold docs (3 templates per doc: task->SOP->code/execute/observe). In-distribution = our own docs (GRAPE: up to 13.8% gain). Every completion verifiable (AST-parses or measured result).
- **Epochs: ONE.** Underfit? Add higher-quality pairs, never epochs (SmolLM2/3 SFT is 1-4 epochs with loss masking at 1.7-3B; at 16.9M one epoch is the verified choice).
- **LR: start 1e-4, probe 5e-5 on ~200 steps, pick by eval not loss.** Constant LR or short cosine — schedulers near-irrelevant (IBM Secret Recipe).
- **Batch: 32K tokens/step (same as pretrain). Warmup <=5%. Total steps = (pairs x seq)/batch — hundreds to low thousands.**
- **Full-FT, never LoRA** at this size (EMNLP 2025).
- **Forgetting guard (verified 8/6):** if cloze regresses (9/10 -> 7/10), interleave pretrain docs as causal-LM replay batches, `replay_ratio` = fraction of micro-batches (0.5 = ~33% replay; labels shifted, prompt token masked). Persistent small cloze dip despite replay = alignment tax (DTM), not failure — decide on BEST-by-format ckpt's cloze.
- **OOM hardening (MANDATORY, verified 8/8):** OOM-retry wrapper around forward/backward (catch OutOfMemoryError -> zero_grad -> empty_cache -> re-forward once -> skip micro if still failing); `empty_cache()` every 10-100 steps in-loop; `--eval-every >= 20`; `--resume + --start-step` so a crash continues the deterministic permutation (samples never re-seen).
- **Gate 1:** byte-exact format rate on held-out instruction set + cloze holds >= base. Best ckpt by GATE-1 EVAL, not loss. Keep clean ckpt for Stage 4.

## 4. Distill (Stage 4) — VERIFIED constraints

- Teacher = closed-loop verifier system (generate -> execute -> verify -> self-correct -> keep ONLY verified final traces). Stronger than copying a big model's prose: every kept trace is proven.
- **Capacity-matched trace length (critical, Yin et al. 2025):** completion budget <= ~450 tokens at SEQ 512 (prompt ~58). Long teacher CoTs IMPAIR small students. Build short (P, C, T) traces from harness sections, not 2,500-token docs.
- Strategy labeling (Orca-2): step_by_step / recall_then_generate / recall_reason_generate / extract_generate / direct; balance, small models need step-by-step most.
- On-policy rounds: sample student, run verifier, distill verified traces back (diversity-driven, MiniPLM difference-sampling).
- **Gate 2:** reasoning check on unseen verified tasks passes at the required rate; no format regression.

## 5. Preference (Stage 5) — VERIFIED recipe

- **DPO first, ONE epoch** (SmolLM: 1 epoch SFT + 1 epoch DPO). LR 1e-6..1e-5, beta ~0.1. Mask prompts; loss on completion tokens only. Watch chosen/rejected log-ratio separates; plateau = fix pairs, not LR.
- **GRPO/RLVR only for exact-verifier tasks** (DeepSeek-Math/Unsloth): 4-8 samples/prompt, advantage = (r_i - mean)/std, reverse-KL beta ~0.04, no value head. Tülu-3 grid: LR ~1e-6, gamma 1.0, lambda 0.95, eps 0.2, KL beta 0.05, temp 1.0, -10 for missing EOS, response cap ~512. Run SHORT (1-2K steps), eval every 200; stop at solve-rate plateau or repetition/language-mixing onset (R1-Zero failure mode; our cold start prevents it — SFT+distill already done).
- **Gate 3:** final eval — format + solve rate + repetition-free generation.

## 6. Closed loop (Stage 6) — perpetual

Eval -> collect failures -> verified re-generation -> feed back into the right stage -> retrain -> repeat. Every fix comes from data, never ad-hoc retraining.

## 7. Quantize + serve (Stage 7) — VERIFIED on this device

1. Export best ckpt -> GGUF (llama.cpp convert; Q8_0 for quality, Q4_K_M for size).
2. Serve with llama_cpp.server: `py -3.10 -E -m llama_cpp.server --model <file> --host 127.0.0.1 --port <p> --n_ctx <ctx> --n_gpu_layers 0 --logits_all false --alias <name>`.
   - `--n_gpu_layers 0` = CPU-only (Pascal: no Tensor Cores anyway).
   - `--logits_all false` is REQUIRED: default True allocates 2.32 GiB scores buffer per 4096-ctx model — OOM on this machine.
3. Verify: `GET /v1/models` returns OUR alias (identity check — a foreign server squatting the port must be treated as a conflict, never trusted). Then one real chat completion.
4. Client timeouts: first-request load latency 10-25s + CPU generation ~8-80 t/s depending on model — generous timeouts, honest status in UI.

## 8. Run protocol on THIS machine

- Launch/resume: `E:\felon_workspace\venv_trek\Scripts\python.exe -u <train>.py` (watchdog relaunches on crash).
- Watch: `Get-Content <run_log> -Tail 8`; health audit script before/after any change.
- NEVER plain `python` (MS Store stub), NEVER `PYTHONPATH=E:\python_packages` (cp313-only, broken) — `-E` flag or absolute `E:\Python310\python.exe`.
- Every session: log run status (step/loss/lr/val/anomalies) in AGENT_NOTES via skill: training-sop.

## 9. Verification checklist (run BEFORE claiming any stage done)

- [ ] Corpus: byte-exact doc format spot-checked; no dupes vs index; executed numbers only; level-classified; token cache rebuilt after additions
- [ ] Pretrain: AdamW(0.9,0.95), wd 0.1, LR band 2e-4-6e-4, warmup 3-10%, cosine (or WSD), clip 1-5 calibrated by clip fraction, effective batch ~32K tok/step, fp32, deterministic
- [ ] Monitoring: every-step loss/lr/grad log; val at step cadence; eval batch >= train; spike detector; clip fraction <5%; grad/param <0.1; cloze suite logging
- [ ] Checkpoints: model+optimizer+step, every 500, best by val, no NaN state saved
- [ ] Gate 0: best-val ckpt evaluated on held-out test + cloze + samples
- [ ] SFT: ONE epoch, capacity-matched pairs, LR 1e-4/5e-5 probe, 32K tok/step, full-FT, replay guard, OOM hardening active
- [ ] Gate 1: byte-exact format rate + cloze holds
- [ ] Distill: traces <= capacity budget, verifier-proven, strategy-balanced
- [ ] Gate 2: reasoning check passes
- [ ] DPO 1 epoch (LR 1e-6..1e-5, beta 0.1, prompt masked); GRPO only exact verifiers, short, repetition watch
- [ ] Gate 3: final eval passes
- [ ] Serve: GGUF, logits_all false, alias identity verified, real chat observed
- [ ] Closed loop active: failures collected, re-generated, verified, fed back

## 10. Sources (primary)

TinyLlama arXiv 2401.02385 (cosine 4e-4, 3 epochs, 2M tok/step, wd 0.1, clip 1.0, 3-stage v1.1); SmolLM2 arXiv 2502.02737 (data-centric, ~2 epochs, mix rebalancing, 4-5-epoch ceiling via Muennighoff et al. 2023, WSD 5e-4, single-stage <=360M); SmolLM3 HF blueprint (WSD 2e-4, 2.36M tok/step, 2000 warmup, decay 10%, SFT 1.8B tokens loss-masked, APO); SmolLlama (130M end-to-end: 10B tokens 3 epochs, SFT alpaca, DPO ultrafeedback, cosine 6e-4); Phi-1 (textbook repetition regime); LIMA 2305.11206; Orca-2 multi-strategy; GRAPE NeurIPS 2025; EMNLP 2025 SFT study; IBM Secret Recipe ICLR 2025; DTM alignment tax 2507.11958; Muennighoff et al. 2023 (repeated data); HF Smol Training Playbook; EACL 2026 curriculum learning.