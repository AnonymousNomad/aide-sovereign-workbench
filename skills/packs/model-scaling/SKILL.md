---
name: model-scaling
description: Size-feasibility discipline for FSI-FELON models on THIS machine (GTX 1060 6GB, i7-8750H, 16GB RAM). Codifies the 8/7 measured probe: hard size ceiling is ~150M (139.7M chosen), the ~5GB VRAM spill threshold, the GQA head-divisibility constraint, and the measured config candidates. Use BEFORE choosing a model size, changing a config, or budgeting a corpus/VRAM for any training run. Hard rule from user (8/7): NEVER go bigger than 100-150M. Probe first, don't assume.
---

# Model Scaling on the GTX 1060 (measured 8/7, not estimated)

The user's hard cap: **100M-150M params, never bigger** (anti-scaling thesis — small
closed-loop dual-mind model competitive with big models). This skill keeps every
scaling decision honest with measured numbers. The 1060's real limit is NOT the 6GB
spec — it is a ~5GB effective ceiling before PyTorch spills to shared RAM and
throughput collapses.

## The chosen config (validated, 139,746,304 params = within the 150M cap)
```
dim=640  n_layers=12  ffn_hidden=1920
spock_heads=12  sheldon_heads=16  n_kv_heads=8  head_dim=64
vocab_size=9283 (tokenizer_v5)  max_seq_len=2048
gene_bank_size=16  gene_dim=64  compress_every=256  n_scratch_slots=8
```
Architectural roles: Spock = deeper/focused attention (logic), Sheldon = broader
(pattern), DualDebateGate fuses, DNAHelixMemory = differentiable running-sum memory,
ScratchPad = learnable SOP slots.

## Hard rule #1 — the ~5GB spill threshold (kills speed, silently)
Measured peak VRAM at various (B, L) on the chosen 150M config:
| config | peak VRAM | step time | tok/s | verdict |
|---|---|---|---|---|
| B=8 L=256 | ~4.05GB | 1.20s | 1711 | fits |
| **B=4 L=512** | **~4.04GB** | **0.90s** | **2269** | **SWEET SPOT** |
| B=1 L=2048 | ~4.02GB | 1.80s | 1137 | fits (long-ctx) |
| B=6 L=512 | 5.67GB | 2.88s | 1067 | SPILL, avoid |
| B=8 L=512 | 7.3GB | 6.05s | 677 | SPILL, avoid |
| B=2 L=2048 | 7.3GB | 8.84s | 463 | SPILL, avoid |
| 200M config (188M params) | 5.13GB | 42.24s | — | FAIL |
Peak scales with TOTAL TOKENS (B x L), not L alone. Above ~5GB the 1060 pages to
shared RAM: reported peak grows past 6GB, wall-clock explodes 3-8x. **Any config
that reports peak > ~5.0GB in a probe is rejected regardless of claimed fit.**

## Hard rule #2 — GQA head-divisibility constraint (REAL BUG FOUND 8/7)
`GQA.forward`: `n_rep = n_heads // n_kv_heads` then `repeat_interleave(n_rep)`.
KV heads are split per mind in DualMindBlock:
`kv_spock = max(1, n_kv_heads // 2)`, `kv_sheldon = max(1, n_kv_heads - kv_spock)`.
**Every mind's n_heads MUST be an exact multiple of its kv heads.**
- n_kv_heads=8 -> kv_spock=4, kv_sheldon=4 -> spock_heads % 4 == 0 AND sheldon_heads % 4 == 0.
  (12/4=3, 16/4=4 OK. 10 heads with kv=4 crashed: "size tensor a (10) vs b (8)".)
- n_kv_heads=4 -> kv_spock=2, kv_sheldon=2 -> both heads % 2 == 0.
Verify divisibility BEFORE building a scaled model. This is a silent runtime crash,
not a warning.

## Other scaling rules
- Probe on the GPU before committing any config: instantiate, run real
  fwd+bwd+AdamW step, print `torch.cuda.max_memory_allocated()` AND wall-clock.
  Never trust paper estimates.
- fp32 AdamW = 16 bytes/param total (weights + grads + 2 optimizer states).
  150M -> 2.4GB just for state; the rest is activations (dual-path attention is
  expensive: two attention streams + FFN per layer).
- fp32 checkpoint ~510-533MB on disk; Q4 deploy ~80MB (runs on phones/laptops).
- Throughput at sweet spot ~8.2M tokens/hour -> 50M corpus ~6h, 100M ~12h,
  300M ~37h. Budget pretraining accordingly; 1B tokens at this size is ~5 days.
- Gradient checkpointing was tested but is NOT needed: the sweet spot fits. If ever
  forced past 5GB, checkpoint the transformer stack (pass the module, not a closure,
  else "element 0 does not require grad") — but prefer shrinking B/L instead.
- Memory math sanity: 200M config fails (5.1GB+), 300M+ never attempted (would need
  4.8GB just for optimizer state before activations). 150M is the ceiling for THIS
  card. This is a feature: it forces the anti-scaling thesis to be proven by
  architecture/data/closed-loop quality, which is the whole point.
- Keep probes in E:\pip_temp\opencode\ (scale_probe.py, infer_probe.py, seq_probe.py).
- PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True reduces fragmentation; it does NOT
  remove the spill ceiling.

## Alignment with other skills
- device-training-1060 is the EXECUTION layer under this skill: FP32-only (Pascal
  has no Tensor Cores, no AMP/TF32), Windows data-pipeline rules (direct contiguous
  slicing, never DataLoader workers for in-memory token data), the 27%-GPU-util
  bubble diagnosis, throughput budgets inherited from this file. Load it before
  launching/optimizing any run on THIS card.
- training-from-scratch is the RECIPE layer (pipeline, hyperparameters, eval, recovery).
- Order of authority on conflict: model-scaling wins on SIZE (never >150M),
  device-training-1060 wins on PHYSICS (what the card can do), training-from-scratch
  wins on RECIPE (how big-tech trains).

## When to use
- Picking/justifying any size for trek/felon/cipher/Sopher/web-builder model.
- Budgeting VRAM for a run, or diagnosing "training suddenly 8x slower" (check peak,
  it's spilling).
- Reviewing a proposed config change: check divisibility, probe on GPU, confirm
  peak < 5GB, recompute tok/s before accepting.
