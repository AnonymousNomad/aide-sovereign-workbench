---
name: post-training-sft
description: Stage 1 of post-training — supervised fine-tuning / instruction tuning for a small from-scratch model (queen-bee-v5). Use when the pretraining base checkpoint is finalized (Gate 0) and the model must learn to follow instructions and emit the byte-exact doc/chat format. Governs SFT data construction from the gold docs, one-epoch training, and the Gate 1 format check.
---

# Post-Training Stage 1 — SFT / Instruction Tuning

Grounded in: SmolLM2/3 (HF, 135M-3B, capacity-matched SFT data + DPO), IBM ICLR 2025 "Secret Recipe" (batch/LR scale), EMNLP 2025 massive SFT study (PPL-compatibility predictor, full-FT vs LoRA), GRAPE NeurIPS 2025 (in-distribution supervision), LIMA (curation > volume), Orca 2 (strategy variety), Llama 3 (SFT→RS→DPO, data quality is king).

## When to run (Gate 0 must be satisfied)
- Pretraining finalized: best-val checkpoint chosen retrospectively, eval note written (training-from-scratch skill).
- Base checkpoint is a fresh copy; this stage writes `posttrain_sft` checkpoint lineage.
- Input: the same gold docs used for pretraining (E:\queen-bee-v5\training_curated\) — they ARE the instruction data source.

## Big-tech research decision-rules (2025-2026, verify BEFORE changing recipe)
| Source | Finding | Rule for queen-bee-v5 |
|---|---|---|
| SmolLM2-135M/360M (HF) | For SMALL models, SFT data must be CAPACITY-MATCHED: they stripped complex instruction-following + function calling from SmolTalk for the 135M/360M | Our 16.9M model: short, simple, unambiguous instruction pairs only. NO complex multi-step function calling. Every unnecessary token = wasted capacity. |
| GRAPE (NeurIPS 2025) | SFT supervision aligned to the target model's pretrained distribution beats "best teacher" distillation by up to 13.8%; PPL/low-probability responses are worse | Our gold docs ARE our pretraining corpus = maximally in-distribution. This is WHY we SFT on our own docs (not imported generic data). Add nothing that is far out of distribution. |
| EMNLP 2025 massive SFT study | Base-model perplexity of the data is the strongest predictor of SFT gain (not topical similarity or length); 1k curated samples often ~ 20k; full-FT > LoRA on reasoning-heavy tasks | Prefer pairs our base already "understands" (low PPL). Target 1-3K concise pairs. Full-FT, never LoRA at 16.9M. |
| IBM "Secret Recipe" (ICLR 2025) | Larger effective batch + LOWER LR wins; warmup/cosine schedulers have minimal impact; early low grad-norm + higher loss predicts good final runs (early-terminate bad ones) | Effective batch 32K tokens (keep pretrain pattern). LR toward the LOW end (1e-4 start; probe 5e-5). Constant LR acceptable. Watch grad norm from step ~50 for a kill signal. |
| Llama 3 herd (Meta) | "Data quality is king"; post-train loop = SFT → rejection sampling → PPO/DPO, several rounds; best SFT ckpt is NOT always the best RL base | SFT is the format+behavior stage; do NOT chase SFT loss. Save best by GATE-1 eval, not loss. Keep a clean ckpt for Stage 2. |
| Call-for-Rigor (ACL 2025) | Arbitrary hyperparameters can reverse data-quality conclusions | Record EVERY HP (LR/batch/epochs/seq) alongside format rate. Never claim data quality without reporting the training config. |
| Bethune et al. (ICML 2025) | Injecting as little as ~1% pretraining data into the finetuning mix prevents catastrophic forgetting; 10-20% is a better safety margin | If pure-SFT retrain shows cloze/val regression, replay pretrain docs in the mix. Start conservative (0.5 ratio = ~33% replay micro-batches), prefer 10-20% data share on the next run. |
| DTM "alignment tax" (arXiv 2507.11958) | Some benchmark drop during SFT is data-bias fitting, NOT reversible forgetting — even 1:1 replay "can hardly remove" it | A small persistent cloze drop (e.g. 9/10 -> 7/10) despite replay = alignment tax, not replay failure. Final decision uses the BEST-by-format ckpt's cloze; if it holds >= base, Gate 1 passes even if mid-run probes dip. Document the tradeoff. |

## How to build the SFT corpus (from gold docs)
Convert each gold doc's intrinsic structure into an instruction-response pair. A gold doc already carries the shape: <task> (instruction) -> <guidelines>/SOP -> <code>/<execute>/<observe>. Build 3 pair templates per doc so the model learns format AND content:
1. Direct: task text -> the doc's answer (the verified content, byte-exact tags).
2. SOP: "Follow the SOP for <domain>/<topic>" -> the SOP + verification gate lines.
3. Closed-loop: task + a wrong first attempt -> the corrected verified version (from the kd_tests harness history).
Keep the tokenizer_v5 special tokens; introduce the CHAT TEMPLATE here (system/user/assistant roles) and freeze it forever.
SmolLM: SFT on a permissive instruction subset + code instruct. For us: the gold docs are already permissive (our own generated content).

### SFT corpus rules (SmolLM capacity-matching + LIMA + Phi-3 + GRAPE)
- ONE epoch. Underfit? Add higher-quality pairs, do not add epochs.
- CAPACITY-MATCH every pair to a 16.9M model: prompt short and realistic; completion concise and unambiguous; skip complex function-calling and hard multi-step reasoning.
- Quality gate before training: every pair's completion must be verifiable (AST-parses, or references a measured result already verified in the corpus).
- Curation: a few thousand high-quality pairs beat 100K noisy scrapes. Target ~1-3K concise pairs from the 1,391 gold docs (curate, don't dump all 3 templates per doc blindly).
- Keep time-sensitive trivia OUT (Phi-3 lesson: it costs capacity the model needs for reasoning).
- Diversity of strategies (Orca-2): step-by-step, recall-then-generate, extract-generate, direct. Do not let one style dominate.
- In-distribution bias (GRAPE): prefer pairs whose completion is low-perplexity for the BASE model — our own docs qualify; imported generic SFT data does not.

## Training recipe (queen-bee-v5 scale, GTX 1060, fp32)
- **Replay mixing (forgetting guard, verified live 8/6):** when a pure-SFT retrain regresses cloze/val (base cloze 9/10 -> 7/10 after SFT), interleave pretrain-corpus docs as full-doc causal-LM batches (`replay_ratio` = fraction of micro-batches, 0.5 = ~33% replay; labels shift, prompt token masked via labels[0]=PAD/ignore). Prevents pretrain-knowledge drift while format still climbs. On this rig a 107-step run reached strict 0.84 with loss 1.36 while cloze held 9/10 through step 10 then dipped 7/10 (alignment tax, see table). Raise ratio toward 10-20% data share (ICML 2025) if format underperforms.
- Full fine-tuning of the ~16M model (no LoRA needed at this size; EMNLP 2025 confirms full-FT > LoRA on reasoning).
- LR: start 1e-4; probe 5e-5 on a 200-step run and pick the one with better eval, not loss (SmolLM3-3B guide starts 5e-5; IBM found 2e-5 best at 3B; our 16.9M sits below both — 1e-4 is the upper bound, watch for instability).
- AdamW betas (0.9, 0.95), weight decay 0.01 (lower than pretrain — it is a short run), grad clip 1.0.
- Constant LR OR short cosine — IBM found schedulers near-irrelevant; do NOT over-engineer the schedule.
- Warmup small (5% or less); total steps = (pairs x seq) / effective batch; expect a SHORT run (hundreds to low thousands of steps).
- Sequence packing: use the chat template for every sample; do not pack across samples with loss on the prompt — mask prompt tokens (labels=-100) so loss is computed only on completions (MANDATORY; TRL DataCollatorForCompletionOnlyLM pattern).
- Effective batch ~32K tokens/step (same as pretrain).
- Save ckpt every eval cadence; best by the Gate 1 metric, NOT by loss.
- Monitor from early steps: low grad norm + high early loss = healthy-sign run (IBM); kill and re-tune otherwise.
- **OOM hardening (MANDATORY on GTX 1060, verified 8/6 pretrain + 8/8 SFT):** WDDM host-memory/VRAM fragmentation crashes the run at an unpredictable step (pretrain died at step ~800; SFT full run died at step 461/772 in loss.backward() even though 15-step probes never OOM'd — the leak builds over hundreds of steps). A trainer that runs probes/evals every ~5 steps will NOT crash but a long run at eval-every 20 WILL. Every long training loop MUST mirror train_150.py: (1) OOM-retry wrapper around the forward/backward micro-batch (catch torch.cuda.OutOfMemoryError -> zero_grad -> torch.cuda.empty_cache() -> re-forward once -> skip that micro if still failing); (2) torch.cuda.empty_cache() every N steps (N=10-100) in the training loop, NOT only after evals; (3) run with --eval-every >= 20 to reduce eval overhead but keep the in-loop empty_cache. Also add --resume + --start-step so a crash can continue the deterministic sample permutation at the same global step index (samples seen are never re-seen; the epoch is not corrupted).

## Gate 1 — format & instruction gate (this stage is done when these pass)
1. Format rate: model completes a held-out sample of instruction prompts and reproduces the byte-exact tag chain / chat format >= ~80% exact-structure rate (measure structural match, not tokens).
2. No regression: cloze_eval and py_parse scores >= base checkpoint scores.
3. Generation sanity: sampled completions are coherent, follow the instruction, do not repeat (repetition death check like 8/3).
If format fails: add more curated pairs targeting the failing structure, re-run. Do not raise epochs.

## Deliverables (write to AGENT_NOTES via skill: post-training-pipeline)
- SFT corpus manifest (source doc -> pair template -> verifier result)
- Checkpoint `posttrain_sft.pt` + eval report (format rate, cloze, py_parse)
- Gate 1 pass/fail note + recommendation for Stage 2

## Audit checklist
- [ ] One epoch; labels masked on prompts; chat template frozen
- [ ] LR in 1e-4..3e-4, wd 0.01, clip 1.0, warmup 5-10%
- [ ] Every completion verifiable; no unverified content
- [ ] Format rate, cloze, py_parse recorded; no regression vs base
- [ ] Checkpoint lineage: posttrain_sft.pt is the Stage 2 base
