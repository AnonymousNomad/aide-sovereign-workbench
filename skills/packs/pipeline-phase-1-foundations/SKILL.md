---
name: pipeline-phase-1-foundations
description: Phase 1 of the from-scratch training pipeline — foundations and environment. Hardware truth (GTX 1060 FP32-only, 12 bytes/param memory law), toolchain + venv + hashed lockfile, project skeleton, 6-RNG determinism (CUBLAS_WORKSPACE_CONFIG), JSONL experiment tracking, watchdog + atomic checkpoints, and the 8-assert hardware gate. Use at the START of any from-scratch training program and whenever a new machine/venv/project is set up, when determinism or resume behavior is questioned, or before ANY training run is launched.
---

# Phase 1 — Foundations & Environment

The pipeline cannot be verified if the ground it runs on is unverified. This phase
makes the machine, the toolchain, the project skeleton, and the run-supervision
layer all deterministic, reproducible, and provable. Nothing in later phases works
if this phase is skipped. Do not proceed to Phase 2 until every item in the
verification checklist passes.

Research sources: NVIDIA CUDA docs (compute capability, Pascal tuning guide),
PyTorch randomness guide, pip repeatable-installs, HF smollm repo layout, W&B LLM
training white paper, Megatron-Energon save/restore, nanoGPT prepare.py, Pythia
checkpoint cadence, Thinking Machines nondeterminism work.

---

## 0. Hardware Doctrine (non-negotiable, measured on THIS machine)

| Fact | Value | Consequence |
|---|---|---|
| GPU | GTX 1060 Mobile 6GB, CC 6.1 (sm_61), Pascal | NO Tensor Cores. FP32 ONLY. |
| FP16 on Pascal | ~1/64 of FP32 rate | FP16/AMP/BF16 is SLOWER and riskier — never use it. |
| TF32 | unsupported on sm_61 | `torch.backends.cuda.matmul.allow_tf32 = False` always. |
| VRAM | 6GB GDDR5 | 150M fp32 static ≈ 2.4GB → ~3.6GB for activations → gradient checkpointing mandatory (Phase 2). |
| RAM | 16GB total | `num_workers=0` always (Windows spawn). Every model server eats 1-2GB. |
| Storage | C:/E: | AV + OneDrive lock files mid-run — exclude training dirs, atomic saves. |
| OS | Windows 11, pwsh 7 | `multiprocessing` = spawn (no fork); TDR watchdog; sleep/hibernate kills runs. |
| Power | laptop battery | NEVER train on battery (GPU -53%). Plug in, verify A/C. |

**Derived memory law (memorize):** FP32 training static cost = **12 bytes/param**
(weights 4 + grads 4 + AdamW m/v 8). For 139.7M → ~1.7GB model + ~0.7GB moments ≈
**2.4GB static**. Budget activations from the remaining ~3.6GB. Counting optimizer
state at 4 bytes instead of 8 is the classic OOM-at-step-0 bug.

---

## 1. Toolchain Setup (setup_env.ps1 — idempotent)

### What to do
1. Python **3.10.11** only (machine-verified; 3.12+ has native wheel gaps). Use
   `py -3.10 -E` everywhere. NEVER plain `python` (MS Store stub). NEVER
   `PYTHONPATH=E:\python_packages` (cp313-only, broken).
2. Create venv: `py -3.10 -E -m venv E:\felon_workspace\venv_trek` (already exists).
3. Install torch from a CUDA index ONLY: `pip install torch --index-url
   https://download.pytorch.org/whl/cu118` — the default PyPI index silently
   installs a CPU wheel on Windows. VERIFIED ON THIS MACHINE 2026-08-16:
   torch 2.7.1+cu118 in E:\felon_workspace\venv_trek (driver 582.28, all smoke
   tests passed, capability (6,1) confirmed at runtime). cu128 wheels are a
   valid UPGRADE path (driver ≥545 required) but are NOT installed — do not
   "fix" a working env.
4. Other pinned majors: numpy 2.2.6, tokenizers 0.22.2, pyyaml 6.0.3, pytest 8.x,
   huggingface_hub (tokenizer/datasets only — NOT transformers for the model).
5. Freeze the exact env: `pip freeze > requirements-lock.txt` — ALREADY EXISTS:
   E:\felon_workspace\requirements-lock.txt (86 packages, 2026-08-16). After
   ANY env change (install/upgrade), regenerate it.
6. Set `CUBLAS_WORKSPACE_CONFIG=:4096:8` as an ENVIRONMENT VARIABLE before any
   python process starts (see §2 — setting it in code is too late).

### Why
- CUDA 12.8 wheels bundle the toolkit — no system CUDA install needed; mixing
  system CUDA with bundled wheels is DLL hell.
- cu128 still builds for sm_61; verify at runtime, never assume.
- A lockfile + hash-pinned env means a crash-rebuild reproduces the same numerics.

### Expected bugs / issues
- CPU torch silently installed → CUDA unavailable, 50-100x slower. Detect:
  assert `torch.cuda.is_available()` at startup, always.
- `py` launcher picks a different interpreter → version drift. Always `py -3.10 -E`
  or absolute `E:\Python310\python.exe`.
- Driver too old for cu128 wheels → `CUDA error: no kernel image available`.
  Verify driver ≥545 (CUDA 12.8 requirement).
- Two training processes fighting for the GPU → OOM on 6GB. One GPU job at a time;
  GPU lock doctrine.

### Dependencies
`py -3.10 -E`, pip, venv, torch==2.7.1+cu118 (verified), numpy 2.2.6, tokenizers
0.22.2, pyyaml 6.0.3, pytest, huggingface_hub. NO transformers for the model,
NO flash-attn, NO bitsandbytes, NO bf16. Lockfile: E:\felon_workspace\requirements-lock.txt

---

## 2. Determinism (the 6-RNG contract)

### What to do
In the run script, BEFORE model construction:
```python
import random, numpy, torch
random.seed(SEED); numpy.random.seed(SEED); torch.manual_seed(SEED)
torch.cuda.manual_seed(SEED); torch.cuda.manual_seed_all(SEED)
torch.use_deterministic_algorithms(True)   # strict mode for smoke, warn_only for long runs
torch.backends.cudnn.deterministic = True
torch.backends.cudnn.benchmark = False
torch.backends.cuda.matmul.allow_tf32 = False
```
And BEFORE process start (launcher sets it, not code):
```
$env:CUBLAS_WORKSPACE_CONFIG = ":4096:8"   # PowerShell launcher
$env:PYTHONHASHSEED = "<fixed>"            # string/dict hash randomization
```

### Why
- `CUBLAS_WORKSPACE_CONFIG` must be an env var set before process start; setting it
  in Python is too late and cuBLAS stays nondeterministic SILENTLY.
- `PYTHONHASHSEED` pins dict/set iteration order (affects dataloading).
- Determinism costs ~10-20% throughput — acceptable at 150M scale; bit-parity beats
  15% speed in a research loop.

### Expected bugs / issues
- `cudnn.benchmark=True` left on → autotuner picks different kernels per run.
- `random` (stdlib) not seeded while numpy/torch are → shuffle drift.
- DataLoader worker RNGs not seeded via `worker_init_fn` → parity broken.
- `torch.compile` can emit nondeterministic fusions → disable for deterministic runs.
- Model moved CPU↔GPU between runs → different reduction order.
- Intermittent NaN = determinism leak, not an optimizer bug.

### Verify
A 100-step smoke run under strict determinism is **bit-identical across 2 launches**
(output files match byte-for-byte).

---

## 3. Experiment Tracking & Logging (JSONL, not print)

### What to do
Per-run directory: `runs/<run_name>/` containing:
- `config.yaml` — full config snapshot (copied at launch, immutable)
- `metrics.jsonl` — append-only, ONE JSON object per line, `flush=True`
- `checkpoints/` — model+optim+step+RNG states
- `logs/` — stdout/stderr files
- `events/` — eval artifacts

Per-step ledger fields: `step, epoch, tokens_seen, lr, loss, loss_clm, grad_norm,
grad_clip_rate, throughput_tok_s, gpu_mem_peak, seq_std, clip_fraction`.
Second-order (eval cadence): `val_loss, cloze_score`.

Loss smoothing: EMA α=0.99 for display; raw per-step for the ledger.

### Why
- Print-scraping is lost on crash; JSONL is machine-readable and append-safe.
- `tokens_seen` (not step) is the comparability currency across batch sizes.
- Grad norm + clip fraction are the EARLIEST spike signals (Phase 6).

### Expected bugs / issues
- Buffered stdout lost on crash → `flush=True` on every write.
- Overwriting metrics on resume → duplicated lines, destroyed charts → append-only +
  dedupe by step on load.
- No config snapshot in run dir → can't reconstruct what was trained.
- GPU mem logged once at peak, not per step → can't catch creeping leak.
- Eval logged with wrong global step → misaligned plots.

---

## 4. Project Skeleton

```
repo/
  configs/            # model.yaml, data.yaml, train.yaml, tokenizer.yaml
  src/llm/
    model/            # architecture only (no training)
    data/             # tokenizers, datasets, loaders
    train/            # trainer, loop, scheduler
    eval/             # cloze/val evals
    utils/            # seed, logging, checkpoint, config, gpu
  scripts/            # run.ps1, watch.ps1, setup_env.ps1, verify_hardware.ps1
  tests/              # test_checkpoint_roundtrip.py, test_seed_determinism.py, ...
  data/               # (gitignored) raw + processed
  runs/               # (gitignored) experiment output
  requirements*.txt
```

Config is CODE: one canonical schema (dataclasses/YAML), validated at boot, all
stages read the same schema. `vocab_size` lives in ONE place (tokenizer config);
model.py reads it — never two constants.

### Why
- Monolithic scripts can't be reused across stages (pretrain→SFT→distill→pref).
- A schema-validated config catches `hidden=64` vs `hidden=640` typos (classic
  silent wrong-model bug).
- Single source of truth for shared numbers (vocab, dim, seq) prevents cryptic
  IndexError/OOM at load.

### Expected bugs / issues
- No schema validation → typo silently uses a default → wrong model.
- `runs/` committed to git → repo balloons, AV scans it.
- Checkpoints not versioned with code → old ckpt + new code = tensor mismatch.
- No `__main__` guard → Windows spawn re-runs training on import.

---

## 5. Windows Process Management & Watchdog

### What to do
- Launch hidden: `Start-Process ... -WindowStyle Hidden` with stdout/stderr
  redirected to `logs/`.
- Health ping: run script touches `logs/health.ping` every **30s**.
- Watchdog (separate process or scheduled task): if ping older than **120s** →
  kill tree (`taskkill /PID <pid> /T /F`), restart from latest checkpoint; max
  **3 restarts** then alert. Restart with backoff.
- Graceful stop: Ctrl+C / WM_CLOSE → checkpoint → exit; tree-kill is last resort.
- Check free disk BEFORE checkpoint save; watch for AV/OneDrive locks on `.pt`.
- Atomic save: write `ckpt.tmp` then `os.replace(tmp, final)`.

### Why
- Windows has no fork; keep the training process long-lived and supervise outside.
- `taskkill` without `/T` orphans children that hold the GPU → next run OOMs.
- `os.replace` is atomic on NTFS — a killed write never corrupts the checkpoint.

### Expected bugs / issues
- Watchdog kills a healthy run because ping path wasn't flushed → flush=True.
- Sleep/hibernate: process alive but frozen; ping stops → watchdog restarts, but
  if resume re-seeds instead of loading the latest ckpt you train from 0 again.
- Two watchdogs (manual + script) → double restarts, torn checkpoints.
- Kill during checkpoint write → corrupt `.pt` → atomic replace + fall back to
  previous ckpt on load failure.
- Restart loop storm → backoff + max-restarts alert.

---

## 6. Hardware Verification (verify_hardware.ps1 — 8 asserts + burn-in)

**MANDATORY PREFLIGHT (HARD LAW — learned the hard way 2026-08-20):**
Before ANY major training run OR any process launch that uses GPU/RAM:
1. Run `scripts/preflight_check.ps1` (process audit + RAM + VRAM + A/C power).
2. **Process audit FIRST:** kill all stale llama-server/python/training processes
   (the 2026-08-20 crash: 10x stale llama-servers from a broken self-heal +
   user's game = laptop crash. Never let orphan servers pile up — a self-heal
   that spawns a new server MUST kill the old one first).
3. RAM: verify free RAM >= the job's need BEFORE launch (16GB total; llama-server
   alone eats 1-2GB).
4. VRAM: verify nvidia-smi free VRAM >= the job's need (6GB total; model 2.4GB
   static + activations ~3.6GB). A 0.4GB-allocated GPU with a game running = DO
   NOT train.
5. A/C power gate: never train on battery.
6. Only after PASS: launch. Re-run preflight after ANY crash/suspend before
   resuming.

### What to do
Before ANY training, run and PASS all asserts or abort:
1. `torch.cuda.is_available()` == True
2. `torch.cuda.get_device_capability()` == (6, 1)
3. device name contains "GTX 1060"
4. `get_device_properties(0).major/minor` == 6/1
5. `torch.cuda.memory_reserved()` baseline < 200MB
6. `allow_tf32 == False`, `cudnn.benchmark == False`
7. Determinism smoke: 1e4-element FP32 matmul twice → identical results
8. A/C power: `Get-CimInstance Win32_Battery` → BatteryStatus == 2 (on AC)
Then burn-in: 5 min `torch.matmul` loop → no TDR/crash/OOM, memory stable,
temp/clocks sane (`nvidia-smi --query-gpu=temp,utilization,clocks`).

### Why
- Pascal FP32-only must be verified at runtime, never assumed from docs.
- Memory baseline must be measured BEFORE model load (post-load is polluted).
- Battery detection prevents the classic -53% GPU clock collapse mid-run.
- TDR (Timeout Detection and Recovery, Event 117 nvlddmkm.sys) has killed our
  llama-server repeatedly — burn-in catches marginal GPU state early.

### Expected bugs / issues
- iGPU enumerated as device 0 → pin `CUDA_VISIBLE_DEVICES=0`.
- Driver auto-updated mid-run → kernel mismatch on next resume → verify driver on resume.
- Overheating mobile → throttling reads as "random" 27% util → check clocks.
- VRAM leak → `reset_peak_memory_stats()` each step; leak dies 6h in.

---

## 7. Verification Checklist (Phase 1 DONE only when ALL pass)

- [ ] `verify_hardware.ps1` passes all 8 asserts + 5-min burn-in (device, CC 6.1,
      FP32 flags false, determinism smoke identical, A/C power, sane temps/clocks)
- [ ] `torch.cuda.is_available()` and capability (6,1) true at every launch
- [ ] 100-step smoke run bit-identical across 2 launches (strict determinism)
- [ ] Resume-from-checkpoint reproduces the ledger exactly from the saved step
- [ ] Config validator computes params and asserts ≤ 139.7M ceiling
- [ ] Setup script idempotent — running twice yields the same env
- [ ] Metrics.jsonl append-only with per-step: loss, grad_norm, clip fraction,
      lr, tokens_seen, throughput, gpu_mem_peak
- [ ] Watchdog: kill process at step N → auto-restart lands on checkpoint N, not 0
- [ ] Atomic checkpoint: corrupt a `.pt` byte → run resumes from previous good ckpt
- [ ] Sleep test: 20-min sleep mid-run → watchdog detects gap, resumes from
      pre-sleep checkpoint
- [ ] `pytest tests/` green (determinism, checkpoint round-trip, config ceiling)
- [ ] GPU memory flat over 1000 steps (no creeping leak)

---

## 8. Dependencies Summary

Python 3.10.11, torch==2.7.1+cu118 (VERIFIED 2026-08-16; cu128 optional upgrade
path), numpy 2.2.6, tokenizers 0.22.2, pyyaml 6.0.3, pytest 8.x,
huggingface_hub. PowerShell 7 + `Start-Process` for launch/supervision. Windows
scheduled task for watchdog. NO transformers (model), NO flash-attn, NO
bitsandbytes, NO bf16/tf32.

---

## 9. When Done

Mark Phase 1 complete in AGENT_NOTES with the checklist results, then proceed to
Phase 2 (Architecture & Tokenizer): skill `pipeline-phase-2-architecture-tokenizer`.