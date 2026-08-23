# Training Phase B2 — Hardware-Aware QLoRA Job Runner

## What
TrainingManager v2: replace the allowlisted-command stub with a real fine-tuning runner — hardware-aware preset selection, a generated pinned-dependency Unsloth script, live loss streaming to the UI, checkpoint policy (keep-3, best-by-eval-loss), OOM-ladder advisor, approval-gated start/stop.

## Why
2026 consensus recipe: QLoRA+Unsloth, r=16, alpha≈r, all-linear targets, lr 2e-4 cosine, batch-1 + gradient accumulation, 1–3 epochs. Verified VRAM tables put this machine's bundled 0.5B (~3GB) and 1.5B (~4GB) within the GTX 1060 6GB budget. The current 45-line stub can run commands but knows nothing about models, progress, checkpoints, or failure modes.

## Code Plan
- `node/src/services/training.ts` (TS port, replaces daemon stub; keep old manifest jobs importable): presets computed from `hardware.ts` probe (VRAM total/free) × candidate base models (manifest GGUFs with param counts) → {model, max_seq_length, r, alpha, lr, epochs, batch, accum} per verified table; refuse combos over budget.
- Python side: generated `train_sft.py` written to job dir — pinned imports (unsloth, trl SFTConfig), `load_in_4bit=True`, `use_gradient_checkpointing="unsloth"`, save_steps/save_total_limit=3, eval_strategy=steps + `load_best_model_at_end=True` (metric eval_loss), seed fixed, `report_to=[]` (offline doctrine), reads dataset paths from B1 meta (locked only).
- Live progress: parse stdout lines (`{'loss': ..., 'epoch': ...}` trainer JSON) → events channel `training` (schema already exists in events contract); UI chart binds to it.
- Failure handling: exit≠0 → classify stderr (CUDA OOM → emit ladder advice: batch→accum→seqlen→rank); watchdog: no stdout for 10min → warn event; stop() = process-manager kill-tree.
- Approval gate preserved (`approved !== true` throws); single active job.

## Dependencies
B1 datasets, hardware probe, process-manager, events hub (`training` channel exists), python env probe pattern from model-runtime.
Research: Sitepoint/codersera/engineered.at 2026 guides; Unsloth VRAM tables; OOM ladder consensus.

## Threat Matrix
| Threat | Control |
|---|---|
| Runaway/failed job | hard timeout option, kill-tree stop, watchdog on silent stdout |
| Disk exhaustion by checkpoints | save_total_limit=3 enforced in generated config |
| VRAM OOM crash-looping | preset refusal up-front + OOM ladder advice on failure |
| Offline violation | generated script sets report_to=[], no downloads at runtime (base model path local; Hub-sourced bases resolved through Phase-9 install first) |
| Unapproved training | existing explicit-approval throw retained; UI surfaces it |

## Issues / Bugs Watchlist
- GTX 1060 is FP16-only (no BF16 tensor cores): generated script must use fp16=True — Unsloth's float16 fix path (bf16 activations workaround) applies; NaN losses otherwise.
- Old GPUs + newest Unsloth wheels drift: pin versions in job dir requirements.txt; record versions in meta for reproducibility.
