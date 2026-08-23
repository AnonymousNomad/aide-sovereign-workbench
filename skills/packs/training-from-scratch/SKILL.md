---
name: training-from-scratch
description: Canonical pretraining pipeline for small models trained from scratch — data curriculum, hyperparameters, monitoring, spike recovery, validation, cloze evals, checkpointing, finalization — grounded in Big Tech practice (Hugging Face Smol Training Playbook, Google deep-learning tuning playbook, W&B LLM training white paper, Axolotl/LightlyTrain stability guides, EACL 2026 curriculum learning, DataDecide 2025). Use when setting up a training run, auditing training health, changing hyperparameters, adding evals, or deciding checkpoint/final model selection for queen-bee-v5 or any other from-scratch model project.
---

# Training From Scratch — Big Tech Pipeline (researched, applied)

Every rule below is grounded in a cited source. Audit any training run against the checklist at the end. This skill governs the PIPELINE; `gold-training-docs` governs the corpus content.

## Research Basis

| Source | Principle | Applied as |
|---|---|---|
| Hugging Face Smol Training Playbook (2025) | Ablations at small scale predict large scale; if something hurts at small scale, rule it out at large scale; something that helps must be trained long enough to trust it | Before any full run: validate architecture/data changes on a short run; keep the training recipe frozen during the full run |
| HF SmolLM3 config | AdamW, betas (0.9, 0.95), eps 1e-8, weight decay 0.1, grad clip 1.0, linear warmup ~2000 steps, cosine decay to 10% of max LR | Canonical hyperparameters; clip 1.0-5.0 both used in industry (GPT-3: 1.0); calibrate via clip fraction (below) |
| Google deep-learning tuning playbook | Periodic evals at step cadence (never time cadence); eval batch >= train batch; retrospective best-checkpoint selection on separate validation set; keep N best checkpoints; track best-val + config per run | VAL_EVERY=500 steps, 5% holdout per curriculum level, ckpt_latest + ckpt_best saved every 500 steps with model+optimizer+step |
| EACL 2026 (Curriculum Learning for LLM pretraining, 200+ models) | Curriculum (easy->hard) cuts steps to target loss by 18-45%; as a warmup before random sampling gives sustained gains up to 3.5% | Corpus is classified into 3 levels (0/1/2) and trained in order with the level range advancing by step (get_curriculum_range) |
| Microsoft Phi-1 (Textbooks Are All You Need) | Textbook-quality data beats raw web at any scale; deliberate repetition of curated data is a feature, not a bug | Gold docs are executable textbook-grade artifacts; ~28 epochs over a 37.7M-token curated corpus is acceptable in this regime |
| LIMA (Meta, 2305.11206) | 1,000 curated examples beat 65K uncurated; style/format carry the supervision | Byte-exact doc format (gold-training-docs skill); training_quarantine/ holds rejected corpus material |
| DataDecide (MLR 2025) | Continuous likelihood metrics make downstream benchmarks >80% predictable at target scale with 0.01% of the compute | Cloze (CF) likelihood evals are the primary in-run task signal — see Eval section |
| Smol Playbook eval principles (FineTasks) | Good eval tasks: monotone with training, low noise across seeds, above random early, stable ranking; use CF (cloze) for small models — MCF later, FG too hard early | Cloze eval suite scores likelihood of correct vs distractor continuations, length-normalized |
| Axolotl / LightlyTrain / Brenndoerfer stability guides | Monitor loss + pre-clip grad norm + LR every step; rolling-baseline spike detection (W=50-200, k=4-5 sigma); clip calibration (<5% steps clipped healthy, >20-30% too aggressive); NaN: forward vs backward diagnosis; rollback must include optimizer state | Log line already carries loss/lr/grad; spike detector + clip fraction + param norms added by this skill's application |
| W&B LLM training white paper | LR too high -> oscillation/divergence; recover by lowering LR and resuming from earlier checkpoint; mid-flight LR changes are normal practice | Recovery playbook below |

## Pipeline Stages

### A. Data
- Corpus lives in `E:\queen-bee-v5\training_curated\` (only verified gold docs; staging in `training\`, rejects in `training_quarantine\`).
- Every doc: executable, measured numbers, level-2 (gold-training-docs skill rules; classify_file() assigns level by filename).
- Order = curriculum: level 0 (easy) -> 1 -> 2 (complex), advancing by step via get_curriculum_range(). Do NOT shuffle levels together.
- Tokenization: tokenize_corpus_curriculum() -> memmapped token_ids_u32.dat, 3 level ranges, 5% of each level reserved as validation holdout. Cache rebuild after ANY corpus addition.

### B. Tokenizer
- After adding corpus files, verify tokenizer coverage (no heavy OOV on gold docs) before training; rebuild token cache with the exact same tokenizer_v5 (deterministic; special tokens preserved).

### C. Hyperparameters (current run, queen-bee-v5 train.py)
- AdamW betas (0.9, 0.95), eps default, weight_decay 0.1, LR 5e-4, warmup 1000 steps, cosine decay, GRAD_CLIP 5.0, BATCH 8 x SEQ 512 x GA 8 (eff 32,768 tok/step), MAX_STEPS 32000, fp32 CPU (AMP_DTYPE None), deterministic seed 1.
- Sanity checks vs research: warmup 1000/32000 = 3.1% of steps (recommended 5-10% — acceptable, do not change mid-run); cosine decays to ~0 (a 10% floor is more common; consider on next run); clip 5.0 (loose vs 1.0; keep unless clip fraction >20%).
- Chinchilla sanity: 11.6M params ~ 230M optimal tokens; run processes 1.05B (4.5x) — deliberate textbook repetition (Phi-1 regime), documented, not a bug.

### D. Monitoring (every step in the log line: step/loss/lr/grad/cur/speed/MEM)
- loss: should trend down; noise is normal.
- grad (pre-clip norm): stable band; a 10-100x jump precedes most loss spikes — the earliest warning.
- lr: must follow warmup->cosine; deviation = bug.
- Spike detector (added by this skill): rolling window W=100, flag loss > mu + 5*max(sigma, 0.05*mu) -> log `[SPIKE]` with step; then decide rollback (recovery playbook).
- Clip fraction: steps where pre-clip grad norm > GRAD_CLIP, reported every 1000 steps; <5% healthy, >20-30% too aggressive (lower clip, or LR).
- Param norm + grad/param ratio every 2000 steps: ratio > 0.1 flags instability risk.

### E. Validation
- 5% holdout per level (never trained on); VAL_EVERY=500 steps (step cadence — correct); eval batch 10 >= train 8 (correct); val tracked per run; best checkpoint by val_loss (retrospective selection — correct); save model+optimizer+step together (correct — momentum must be consistent with params).

### F. Task Eval (cloze/CF — the primary signal at this scale)
- Free-form generation (py_parse) is expected to stay ~0 at pretraining scale on a small model (Smol Playbook: FG too hard early). Do not panic; do not remove — it is the production signal.
- The in-run signal is the CLOZE suite (added by this skill): 10 items drawn from the corpus's key measured results; score = fraction of items where length-normalized log-likelihood of the correct suffix beats the distractor. Above random early, monotone, low noise. Logged at every VAL_EVERY checkpoint.
- Rules for future cloze items: one clear correct continuation + one plausible wrong one; both suffix lengths similar (normalize by length anyway); draw from measured doc results (BS=8.0214, Kelly 0.2, octile admissible, etc.), never from material that was NOT in the corpus.

### G. Checkpointing & Resume
- ckpt_latest.pt every 500 steps + ckpt_best.pt on improvement; resume = re-execute train.py (reads ckpt, optimizer state, resets val baseline for new corpus); NaN recovery reloads best checkpoint and rebuilds the optimizer.
- Never save a NaN step's state; never truncate/rebuild the log.

### H. Finalization
- Choose the checkpoint with best val_loss retrospectively (NOT the last step).
- Final eval on a held-out test slice + the cloze suite + generation samples; only then export.

## Recovery Playbook (in order)
1. Loss spike / grad spike: check whether grad norm spiked BEFORE loss (optimizer/update problem) or loss spiked with clean grads (data batch problem). Locate the batch in the log range.
2. Recover: rollback to last clean checkpoint (reload best), optionally cut LR 10-20% for re-entry, resume. The reload machinery in train.py does this on NaN; manual rollback = copy ckpt_latest.pt over current state and relaunch.
3. Divergence: lower LR 2-5x, resume from earlier checkpoint.
4. Plateau early: LR too low (raise 2-5x on a short probe run), warmup too short, or data issue (verify labels/level mix on tokenized samples).
5. NaN: if grad norm went NaN first -> backward/optimizer problem; if loss NaN with fine grads -> forward/activation problem; fp32 (AMP_DTYPE None) is the diagnostic baseline — never go bf16/fp16 for a CPU run.
6. STaR/self-generated feedback: DISABLED (8/3) — self-poisoning; only re-enable behind a generation quality gate.

## Audit Checklist (apply to ANY project's training)
- [ ] Data: curated, verified, deduped, quarantined, level-classified; token cache rebuilt after additions
- [ ] Optimizer: AdamW (0.9, 0.95), wd ~0.1, clip 1-5, warmup 5-10% of steps, cosine decay (floor or to 0)
- [ ] Seeds deterministic; resume path carries model+optimizer+step
- [ ] Log every step: loss, lr, pre-clip grad norm; val at step cadence with held-out set; eval batch >= train batch
- [ ] Spike detector active (W=100, k=5); clip fraction <5%; param norms periodic; grad/param ratio < 0.1
- [ ] Cloze eval suite present and logging; FG eval present but not trusted early
- [ ] Best-checkpoint retrospective selection; N best kept; no state saved on NaN steps
- [ ] Recovery playbook rehearsed (rollback + LR cut path verified)
- [ ] Final: best-val checkpoint exported, evaluated on held-out test, then deployed

## Run Protocol (queen-bee-v5)
- Launch/resume: `E:\felon_workspace\venv_trek\Scripts\python.exe -u E:\queen-bee-v5\train.py` (watchdog in C:\trek_runtime relaunches on crash).
- Watch: `Get-Content C:\trek_runtime\train_run.log -Tail 8`; health audit: `E:\felon_workspace\venv_trek\Scripts\python.exe E:\queen-bee-v5\check_training_health.py`.
- PID 17704 is the current run; do not kill. train.py edits are inert until the next resume/launch (Python reads the file once at start).
- Every session: log training status in AGENT_NOTES (step, loss, lr, val, anomalies); every batch of corpus docs: rebuild token cache only if the corpus changed.

## Reference the skill from AGENT_NOTES
Every training-status or training-change entry must name this skill (e.g. `via skill: training-from-scratch`).
