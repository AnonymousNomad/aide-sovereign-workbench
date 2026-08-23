---
name: pipeline-phase-5-pretrain-code
description: Phase 5 of the from-scratch training pipeline — the pretraining code itself. Model definition (FSI_Trek from Phase 2), trainer with packing/padding-free dataloader, loss masking, AdamW config (0.9/0.95 eps 1e-5 wd 0.1), WSD or cosine schedule with warmup, gradient accumulation for effective batch 48 on 6GB VRAM, OOM retry doctrine, atomic checkpoint save/restore (model+optimizer+RNG+LR+step+token offset), JSONL monitoring hooks, and the test battery. VERIFIED REALITY (2026-08-16 audits): torch 2.7.1+cu118 (Phase 1), FSI_Trek = production architecture (Phase 2), 150M run used LR 5e-4 / clip 5.0 / cosine+curriculum (train_150.py), 16.9M run used LR 3e-4 (closed_loop.py). Use when writing any training loop for the 150M rebuild, debugging OOM at step 0, checkpoint load mismatches, LR schedule drift on resume, or grad-norm spikes.
---

# Phase 5 — Pretrain Code

Phases 1-4 proved the machine, the model shape, the tokenizer, and the data.
Phase 5 writes the code that trains it. Every piece of Phase 5 is written ONCE
and verified with tests + a 100-step smoke BEFORE the real run (Phase 6). The
watchdog/resume machinery from Phase 1 and the cache contract from Phase 4 are
consumed here.

Research sources: nanoGPT (train.py), llama2.c, LLaMA2 recipe (2307.09288),
SmolLM2 (2502.02737), TinyLlama (2401.02385), WSD (2405.18392), Megatron
checkpointing, Pythia (2104.00061), Google Rules of ML #29/#32/#37, HF Smol
Training Playbook, W&B LLM training white paper.

---

## 1. Module Layout (one process, no framework)

```
src/llm/
  model/model.py        # FSI_Trek (Phase-2 production architecture, verified in Phase 2)
  data/dataset.py       # uint16 shard reader (Phase-4 manifest contract)
  data/loader.py        # packing + batch assembly (padding-free)
  train/scheduler.py    # WSD or cosine + warmup
  train/trainer.py      # step loop, grad accum, OOM retry, checkpoint, metrics
  train/config.py       # schema-validated config (dataclasses + yaml)
  utils/seed.py         # Phase-1 6-RNG contract
  utils/checkpoint.py   # atomic save/restore
  utils/metrics.py      # JSONL ledger writer
  utils/gpu.py          # memory stats, reset_peak
scripts/run_pretrain.ps1  # launcher (env vars incl. CUBLAS_WORKSPACE_CONFIG)
tests/                   # test battery (below)
```
NO transformers, NO flash-attn, NO AMP. torch + numpy + tokenizers only.
NOTE (2026-08-16 audit): the current project uses FLAT trainers (train_150.py
lineage in E:\queen-bee-v5), not this src/llm layout — the layout is the target
for the new-corpus pretrain, not the current reality.

---

## 2. Dataloader (packing, padding-free, Windows-safe)

### What to do
- Read the Phase-4 uint16 shards per the manifest (single process,
  `num_workers=0`).
- **Packing**: concatenate token streams into fixed seq_len blocks (1024). No
  padding: a stream is split at block boundaries; the next stream continues the
  block. Loss masking is NOT needed for pretrain packing (every token predicts
  the next).
- Sequence order: shard order → stream order → block order, all fixed by the
  manifest (determinism). Track `tokens_seen` as the global step currency.
- Shuffle at the SHARD level only (within fixed epoch order) for the same seed —
  keeps determinism while varying stream adjacency between epochs.
- Batch assembly: `B, S = (2, 1024)` → per-step tokens = 2048; grad accum 24 →
  effective batch = 48 × 1024 = 49,152 tokens (≈ 1.5M tokens/step-accum-set).

### Why
- Packing removes EOS/BOS padding waste (10-30% tokens lost to padding
  otherwise); TinyLlama/SmolLM both pack.
- Padding-free + fixed order = reproducible token stream = reproducible loss
  curve (Phase-1 law).
- Windows spawn + shared memmap is a footgun — single-process sequential reads
  from `.bin` files are faster than any multiprocessing attempt on 16GB RAM.

### Expected bugs / issues
- Manifest/shard order drift (Phase 4) → offsets misalign → garbage tokens.
  Assert loader start: first shard's first 8 tokens == manifest-registered
  sample check (roundtrip token ids from a known doc).
- Shard size not a multiple of seq → tail token loss or a short final block;
  decide: drop remainder (document in manifest) vs zero-pad with loss mask.
- `.bin` opened with `np.memmap(mode="r")` in the trainer process is fine; NEVER
  share it with another process (Windows).
- Reading one shard fully into RAM (100-200MB) at a time is fine; preloading ALL
  shards is not (3B tokens × 2B = 6GB → OOM on 16GB).

---

## 3. Optimizer & Schedule (LLaMA2 + WSD, tuned for this card)

### What to do
- **AdamW**: betas (0.9, 0.95), eps 1e-5, weight_decay 0.1, no bias decay, no layernorm decay.
- **LR — VERIFIED REALITY (2026-08-16 audit)**: the 150M-B run (train_150.py)
  used LR 5e-4, MIN_LR 1e-5, warmup 200, GRAD_CLIP 5.0, betas (0.9,0.95), wd 0.1,
  cosine schedule + curriculum phases (P2@30%, P3@70%). The 16.9M Trek run
  (closed_loop.py) used LR 3e-4, wd 0.01. The skill's earlier "3e-4" claim
  matched the 16.9M run, not the 150M. For the NEW pretrain: 5e-4 worked on this
  card at batch 49K; 3e-4 is the conservative option. Phase-1 law (5e-5) applies
  to POST-TRAIN full-FT on the ship base, NOT to pretraining from scratch.
- **Schedule**: WSD (warmup-stable-decay, 2405.18392) is the research-preferred
  option for the NEW run — warmup 2000 steps (or 2% of total), stable ~85% at
  peak LR, linear decay to ~1/10 × peak over the last ~15%. VERIFIED reality:
  both project runs used COSINE + warmup (train_150.py get_lr: warmup 200,
  cosine to MIN_LR over MAX_STEPS; closed_loop.py same pattern). Cosine is the
  proven fallback on this card; WSD is the upgrade candidate.
- **Grad clipping**: 1.0 global norm is the standard; VERIFIED reality: the 150M
  run used 5.0 and was stable. For the new run start at 1.0, relax to 5.0 if
  grad-norm spikes are frequent but the loss trend stays healthy (spike
  doctrine, §4).
- **Grad accumulation**: accum=24 with batch 2 — forward/backward 24× per
  optimizer step; clip the FULL accumulated gradient once (not per micro-step).
  Effective batch = 48 × seq. VERIFIED reality: train_150.py used seq 512
  (eff 24,576 tok); the Phase-2 probe verified seq 1024 batch 2 fits (4,265MB
  peak) → new run targets seq 1024 (eff 49,152 tok).
- Loss: cross-entropy over tokens (vocab 9302), mean over batch.

### Why
- Betas 0.95 (not 0.9) is the LLaMA2/SmolLM choice for LM stability at small
  batch; eps 1e-5 vs 1e-8 matters at fp32 (no fp16 underflow here).
- WSD's stable-phase LR lets you "pause" the run and inspect without decaying
  progress (the run can be resumed mid-stable with the same LR); cosine forces
  you to finish or re-warmup.
- Grad accum instead of larger batch: 6GB VRAM cannot hold batch 48; accumulation
  preserves the effective-batch statistics at the optimizer step.

### Expected bugs / issues
- **LR schedule state not saved** → resume silently restarts the schedule from
  step 0 (classic silent bug: loss diverges after resume because LR jumped).
  Save `lr`, `schedule_step`, `warmup_steps`, `phase` (stable/decay) in the
  checkpoint and restore BEFORE the optimizer step.
- AdamW m/v state must be saved/restored per-param — a resume that rebuilds the
  optimizer loses momentum → different trajectory, slower convergence, often a
  spike.
- Weight decay applied to embeddings/head: LLaMA2 decays them; some recipes
  exclude embeddings — PICK ONE, document, don't flip mid-run.
- Grad clip before/after accumulation: clip ONCE on the accumulated norm,
  otherwise micro-clipping breaks the effective-batch statistics.
- `torch.no_grad()` in eval steps leaking into train steps (autocast/vars leak) —
  assert `requires_grad` states after every eval.

---

## 4. OOM & Spike Doctrine

### What to do
- Wrap the micro-step in try/except `torch.cuda.OutOfMemoryError`:
  1. `torch.cuda.empty_cache()`; reset peak stats
  2. Halve the micro-batch (batch 2 → 1) for the REST of the run (persistent
     flag in config); if already 1 → halve seq_len (never silently — log loudly)
  3. Continue from the same data offset (skip the failed step, do NOT re-read
     from the start of the shard)
  4. Never fall back to CPU offload (Pascal fp32 CPU = 20x slower).
- Spikes: any loss jump > 5× rolling mean in one step → dump the batch, note
  `tokens_seen`, log `spike_event`; if the NEXT step is normal, continue (don't
  kill the run); if 3 consecutive spikes → stop and diagnose (Phase 6 playbook).

### Why
- OOM at step 0 (most common) is usually AdamW state — the Phase-1 memory law
  budget was wrong or a second process holds VRAM. Never "just try smaller
  batch" blindly; check `nvidia-smi` first (a leftover llama-server from the
  teacher-corpus work is a documented repeat offender).
- Spike ≠ death: single-step spikes (hard batch) are recoverable; the run is
  wasted only if you panic-kill it.

### Expected bugs / issues
- OOM leaves partial gradients/accumulated state — zero the accumulation buffer
  before retry (not after: a half-accumulated step pollutes the next optimizer
  step).
- empty_cache() does not release all of it on Windows (paging weirdness) — the
  real fix is smaller batch/seq, not cache-eviction tricks.
- CPU offload silently halves throughput → latency confusion in monitoring.

---

## 5. Checkpoints (atomic, complete, resumable)

### What to do
Checkpoint contains: model state, optimizer state, scheduler state (lr, step,
phase), RNG states (torch, cuda, numpy, random, worker seeds), global
`tokens_seen`, epoch/shards consumed, and a `config_hash` (sha256 of the
effective config) — refuse to load a checkpoint whose config hash differs.

Save cadence: every N steps (e.g. 500) + best-by-val-loss (Phase 6 runs the
val eval; Phase 5 provides the hook). Save pattern:
1. Write `ckpt.tmp` (same dir = same filesystem for atomicity)
2. `os.replace(tmp, final)` 
3. fsync dir
Keep the last 3 + best. Never save during a spike (loss NaN → don't overwrite
best).

### Why
- Complete state = the ONLY resume that reproduces the trajectory bit-for-bit
  (Phase-1 determinism law). Partial checkpoints (weights only) are for
  inference, not training.
- `config_hash` guard catches the silent "resumed with a different config" bug
  that manifests as a mysterious loss plateau 10k steps later.

### Expected bugs / issues
- AV/OneDrive locking `.pt` mid-write → corrupted file. Atomic replace + fsync +
  keep-previous guard; the Phase-1 watchdog retries from the previous ckpt.
- Save on Windows is slow (large file, no O_DIRECT) — save in a background
  thread ONLY if the main loop never reads the checkpoint until it is
  `os.replace`d (a partially-copied file read by the watcher = garbage).
- RNG state omitted → resume re-seeds → shard order diverges → val numbers
  drift (silent).
- Best-ckpt saved during a spike → poisoned best. Guard: `best` only updates on
  clean steps (grad_norm < clip, loss finite).

---

## 6. Monitoring Hooks (the ledger from Phase 1, wired in)

Per micro-step: `tokens_seen, step, lr, loss, grad_norm, clip_fraction,
throughput_tok_s, gpu_mem_peak, seq_std` → JSONL, flush=True.
Per eval (every 1000 steps): `val_loss, cloze_score` (Phase 6 defines evals;
Phase 5 provides the hook + CLI flag).
Events: `spike_event`, `oom_recovery`, `resume_from`, `schedule_phase` →
separate `events.jsonl`.

### Why
- The JSONL ledger is the ONLY history that survives a crash; print is lost.
- `clip_fraction` (grad norm ≥ clip) is the earliest degradation signal — a
  sustained rise means LR too high for the current data phase.
- `tokens_seen` (not step) is the comparability currency (batch/accum changes
  don't skew it).

### Expected bugs / issues
- Logging into the middle of a step (before the optimizer step) vs after —
  pick AFTER and document; mid-step values confuse spike diagnosis.
- Throughput in tok/s must divide by wall-clock INCLUDING eval (else eval-steps
  look like throughput drops).

---

## 7. Test Battery (must be green before Phase 6)

AUDIT NOTE (2026-08-16): the current project has NONE of these tests
(test_dataloader/test_scheduler/test_checkpoint_roundtrip/test_optimizer/
test_config/test_seed do not exist in E:\queen-bee-v5). train_150.py has
`random.seed(42)` only — no torch/numpy seeding, no CUBLAS_WORKSPACE_CONFIG in
code (Phase 1 fix moved env vars to launch_train.ps1/watchdog). The battery is
a TO-BUILD item for the new-corpus pretrain (the old corpus/trainer are
superseded); it is NOT satisfiable against the legacy train_150.py.

- [ ] `test_dataloader.py`: packing produces exactly n_tokens from the manifest
      (no padding, no loss), deterministic across 2 runs (same shard order),
      tail-shard behavior defined
- [ ] `test_scheduler.py`: WSD produces the expected LR curve (warmup→stable→decay);
      resume mid-stable reproduces the exact LR
- [ ] `test_checkpoint_roundtrip.py`: save→load→run 10 steps == run 10 steps
      without checkpoint (bit-identical loss curve) — THIS is the resume proof
- [ ] `test_optimizer.py`: AdamW m/v decayed after a step; grad clip on
      accumulated norm; no bias/layernorm decay
- [ ] `test_config.py`: schema rejects typo'd keys (dim=64 not 768, etc.);
      computes params ≤ 139.7M; `config_hash` changes when config changes
- [ ] `test_seed.py`: same seed → same shard order, same first batch
- [ ] 100-step smoke on real shards (small sample): loss finite and decreasing
      after step 2, ~ln(vocab) at step 0, no NaN, no OOM, ledger complete

---

## 8. Dependencies Summary

torch 2.7.1+cu118 (VERIFIED 2026-08-16, Phase 1 — NOT 2.9.x+cu128; the Phase 1
audit decided to keep the verified working wheel), numpy 2.x, tokenizers 0.20+
(Phase 2), pyyaml, jsonl I/O. No transformers, no flash-attn, no AMP, no
multiprocessing. Phases 1-4 outputs consumed: venv + determinism (1), config +
params (2), splits + mix (3), shards + manifest (4).

---

## 9. When Done

Mark Phase 5 complete in AGENT_NOTES with test-battery results + smoke numbers,
then proceed to Phase 6 (Pretrain Run): skill
`pipeline-phase-6-pretrain-run`.