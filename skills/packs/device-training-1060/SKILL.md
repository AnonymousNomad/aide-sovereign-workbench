---
name: device-training-1060
description: Device-specific training discipline for THIS machine (GTX 1060 6GB Pascal mobile + i7-8750H + 16GB RAM + Windows). The execution layer under training-from-scratch and model-scaling: what Big Tech recommends vs what this exact card can actually do. Use whenever setting up, launching, resuming, or optimizing ANY training run (pretrain/SFT/distill/preference) on this machine — precision choice, batch/data-pipeline construction, throughput budgets, Windows DataLoader pitfalls, and the 27%-GPU-util bubble diagnosis. Hard device rules: FP32 ONLY (no AMP/TF32 — Pascal has no Tensor Cores), never num_workers>0 for in-memory token data on Windows, never run on battery.
---

# Device Training: GTX 1060 6GB + i7-8750H + 16GB + Windows

Grounded in research (sources below). This skill is the DEVICE layer; it does not
replace training-from-scratch (big-tech pipeline) or model-scaling (size ceiling).
All three must agree — if they ever conflict, this device skill wins on physics
(what the card can do), training-from-scratch wins on recipe (how big-tech trains),
model-scaling wins on size (never >100-150M).

## Device facts (measured + sourced)

| Component | Spec | Consequence for training |
|---|---|---|
| GPU | GTX 1060 Mobile 6GB GDDR5, Pascal CC 6.1, 1404MHz | NO Tensor Cores |
| FP16 rate | 1/64th of FP32 on CC 6.1 (NVIDIA CUDA guide; Anandtech 1080 = 1/64) | FP16 is SLOWER for math here |
| Memory bandwidth | 192 GB/s GDDR5 | THE throughput limiter for decode & attention |
| PCIe | 3.0 x16 (~16 GB/s effective) | H2D bulk transfers matter; keep data contiguous |
| CPU | i7-8750H 6C/12T 2.2-4.1GHz | thermal throttles ~9-14% sustained (Notebookcheck) |
| RAM | 16GB total | num_workers>0 duplicates data per worker (numpy) |
| Power | laptop battery | GPU -53% on battery (Notebookcheck) |

## Hard rule #1 — FP32 ONLY. Never AMP/TF32/FP16 for speed.

- Pascal GTX (CC 6.1) has no Tensor Cores. FP16 fused-multiply-add rate is
  1/64th of FP32 (CUDA arithmetic-instructions table). AMP only helps cards with
  Tensor Cores (Volta/Turing+). Apex maintainers + NVIDIA forums confirm: on GTX
  10-series, mixed precision is at best bandwidth-neutral for memory-bound layers
  and slower for compute-bound ones (apex#76, apex#297, pytorch#27886).
- TF32 is Ampere+ only; NOT available on Pascal. torch.set_float32_matmul_precision
  has nothing to gain here.
- The project already runs fp32 everywhere — this is CORRECT for this card, not a
  compromise. Training-from-scratch's "never fp16/bf16" rule is now explained by
  hardware, not just numerics.
- Only FP16 use-case: inference serving to HALVE VRAM when memory-bound at deploy
  time — never training speed.

## Hard rule #2 — data pipeline on Windows: in-memory = DIRECT SLICING, never workers.

- PyTorch DataLoader with num_workers>0 on Windows is a known trap: 'spawn' start
  method (no fork), each worker takes 3-4s to init and they start SEQUENTIALLY
  (~3.3s each), and worker-heavy configs can be 5-50x SLOWER than num_workers=0
  (pytorch#12831, #153594, #161492). Even persistent_workers=True does not fully
  fix it (#12831 comments).
- Kernel-level trace (ingero 2024, pytorch#154318): DataLoader multiprocessing on
  in-memory tensors causes 200k+ context switches, 301ms cudaMemcpyAsync stalls,
  GPU idle 10-20%. Direct contiguous slicing `X[i:i+bs].to(device, non_blocking=True)`
  was up to 124x faster, because it is one DMA from one contiguous region.
- Our data is ALREADY in-memory token arrays (token_ids_u32.dat memmapped /
  sft_pairs tokenized lists). Conclusion: **never use DataLoader(num_workers>0) for
  this pipeline.** Pre-tokenize ONCE into contiguous tensors, then slice.
- If a task genuinely needs disk I/O workers: num_workers = cores-1 (leave 1 core
  for main process + GPU submission), persistent_workers=True, prefetch_factor=2,
  NOT higher. Never num_workers = core count (#154318 recommendation).

## Hard rule #3 — never run on battery; watch thermals.

- Battery drops GPU throughput ~53% (Notebookcheck GL703GM). Any training run must
  be on AC power.
- i7-8750H sustains ~9-14% lower multi-core after initial boost (Notebookcheck
  Cinebench loop 1026->935). Keep vents clear; if ambient is hot, expect slower
  data prep — do NOT mistake this for a code regression.

## The 27%-GPU-util bubble (diagnose THIS first when a run is slow)

Measured on the live SFT run (8/8): GPU burst 97-99% @ ~5.5GB during forward+backward,
then drops to 29-42% @ ~4.2GB during batch construction + generation eval. The
compute is fine; the card is STARVED between micro-steps by:
  1. Python per-row batch construction (torch.tensor() per row, per micro-batch)
  2. fp32 autoregressive generation during eval (bandwidth-bound: 192GB/s)

Fixes in priority order:
  1. Pre-tokenize all samples into ONE contiguous padded tensor at load; batch =
     tensor slice + pad inside a preallocated buffer. No per-row Python loops.
  2. Prefetch next batch into pinned memory while the current step runs.
  3. Keep eval generation on GPU but batch it and time it (it is the biggest single
     bubble); reduce max_new or eval frequency where the gate allows.
  4. torch.cuda.empty_cache() sparingly (every step KILLS allocation reuse — the
     current code does it every 10 steps; measure before removing, it guards OOM).

## Throughput budgets (measured, model-scaling)

- Sweet spot B=4 L=512 on 150M: ~4.04GB peak, 0.90s/step, 2269 tok/s (~8.2M tok/h).
- Spill threshold ~5GB: B=6 L=512 -> 5.67GB, 2.88s/step, 1067 tok/s (3x slower).
- Any probe >5.0GB peak is REJECTED (model-scaling hard rule #1).
- fp32 AdamW = 16 bytes/param (weights+grads+2 states); 150M -> 2.4GB before acts.
- Budget: 50M corpus ~6h, 100M ~12h, 300M ~37h at sweet spot.

## GPU/process health check (do this when a run looks stuck)

1. Is it alive? `(Get-Process python).CPU` delta over 20s; a healthy run grows fast.
2. Is GPU saturated? `nvidia-smi --query-gpu=utilization.gpu,memory.used` every 5s.
   Near-100% during compute = healthy. Persistent <50% = data-pipeline bubble.
3. Is it writing checkpoints? Check ckpt mtime vs wall clock. No new ckpt for hours
   on a short run = likely stuck in eval or a bubble; on a long run it may just not
   have beaten best yet.
4. Multiple duplicate processes = check `Get-WmiObject Win32_Process -Filter
   "Name='python.exe'"` for duplicated command lines; one is the worker, others are
   dead stubs (0 CPU, ~4MB RAM) — do not kill the active one.
5. Edits to train scripts are INERT until the next launch (Python reads the file
   once at start). Do not "fix" a live run by editing the file.

## Audit checklist for THIS device (run before/after any training launch)

- [ ] Power: plugged in (battery = -53% GPU)
- [ ] Precision: fp32 everywhere; no AMP/TF32/FP16 for training speed
- [ ] Data: pre-tokenized contiguous tensor; direct slicing; NO DataLoader workers
- [ ] Prefetch: next batch staged while current step computes (or batch overlap OK)
- [ ] Batch: use the measured sweet spot (B,L) from model-scaling; peak < 5GB
- [ ] GPU util during compute ~95%+; persistent <50% triggers the bubble fix above
- [ ] Checkpoints writing on cadence; best kept by gate, not last step
- [ ] One active python process per run (dedupe dead stubs before blaming GPU)

## Alignment notes (skill cross-references)

- model-scaling: size ceiling (150M), spill threshold (~5GB), sweet-spot table,
  GQA divisibility. This skill inherits those numbers.
- training-from-scratch: pipeline, hyperparameters, eval cadence, recovery. The
  device rules here are the execution constraints it must run under.
- When in doubt, re-measure: probe on the GPU (model-scaling), never trust paper
  throughput estimates on a Pascal mobile card.

## Research sources

- NVIDIA CUDA arithmetic-instructions table: CC 6.1 FP16 = 2 FMA/clk vs FP32 128
  (1/64); NVIDIA Developer Forums "FP16 support on gtx 1060 and 1080"
- Anandtech GTX 1080 review: FP16 = 1/64 FP32 on Pascal consumer
- Apex#76 (mcarilli), Apex#153, Apex#297: mixed precision needs Tensor Cores
- PyTorch#12831, #153594, #161492: Windows DataLoader spawn slowness
- PyTorch#154318 + ingero.io kernel trace: 124x direct-slicing vs DataLoader
- Notebookcheck (GL703GM / Sabre 17): i7-8750H thermal loop, battery GPU -53%
- loco-bench + FitMyLLM: bandwidth (not VRAM) drives tok/s on 1060
