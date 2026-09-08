---
name: cipher-sizing
description: Architecture sizing for FSI Felon Cipher cloud training. Use when deciding model size, layer count, expert count, and training hyperparameters for a given GPU time budget. Phase 0 of cipher-cloud-training.
---

# Phase 0: Architecture Sizing

## Purpose
Determine the optimal Cipher model configuration for a 7-8 hour cloud GPU training run.

## Sizing Methodology

### Step 1: Determine Token Budget
```
tokens_available = gpu_hours × 3600 × estimated_tok_per_sec × moe_derate_factor

A100 80GB: 8 × 3600 × 2000 × 0.75 = ~43M tokens
H100 80GB: 8 × 3600 × 5000 × 0.75 = ~108M tokens
```

### Step 2: Chinchilla-Optimal Dense Size
```
N_optimal_dense = tokens_available / 20

A100: 43M / 20 = ~2.1M params (too small)
H100: 108M / 20 = ~5.4M params (still small)
```

### Step 3: MoE Translation
MoE lets us store MORE params than Chinchilla suggests because:
- Only active params drive per-token compute
- Total stored params = capacity for knowledge
- Activation rate ra = N_active / N_total

```
N_active_target = tokens_available / (6 × 20)  # 6 = forward+backward FLOPs/param
N_total = N_active / ra  # ra = 0.10 to 0.30

A100: N_active = 43M / 120 = ~0.36M → N_total at ra=0.20 = ~1.8M (still small)
H100: N_active = 108M / 120 = ~0.9M → N_total at ra=0.20 = ~4.5M
```

### Step 4: Practical Floor
Below ~50M total params, the model won't learn meaningful coding patterns regardless of tokens. Set a FLOOR:
```
MIN_TOTAL_PARAMS = 50_000_000  (50M)
MIN_ACTIVE_PARAMS = 10_000_000  (10M)
```

### Step 5: Fit to Hardware
For H100 80GB, we can afford up to ~1B total params at BF16:
```
VRAM_budget = 80GB
weights_bf16 = N_total × 2 bytes
optimizer_fp32 = N_total × 8 bytes  (Adam m+v)
activations = ~2GB for batch=4, seq=2048
total_needed = weights_bf16 + optimizer_fp32 + activations

For N_total = 200M:  400MB + 1.6GB + 2GB = ~4GB  ✓ fits easily
For N_total = 500M:  1GB + 4GB + 2GB = ~7GB  ✓ fits
For N_total = 1B:    2GB + 8GB + 2GB = ~12GB  ✓ fits
```

## Recommended Presets

### cipher_cloud_h100 (PRIMARY — 8h H100)
```python
CONFIG = {
    "vocab": 32768,
    "d_model": 512,
    "n_layers": 12,
    "n_heads": 8,
    "n_kv_heads": 2,
    "head_dim": 64,
    "ssm_dim": 512,
    "n_routed": 32,
    "n_shared": 2,
    "top_k": 4,
    "expert_d_ff": 128,
    "r_max": 4,
    "dna_slots": 32,
    "seg_types": 4,
    # Derived
    "total_params": "~200M",
    "active_params": "~40M",
    "activation_rate": "0.20",
    "seq_len": 2048,
    "batch_size": 4,
    "grad_accum": 12,
    "lr": 3e-4,
    "warmup_steps": 200,
    "max_steps": 10000,
    "precision": "bf16",
    "checkpoint_every": 500,
    "eval_every": 500,
}
```

### cipher_cloud_a100 (FALLBACK — 8h A100)
```python
CONFIG = {
    "vocab": 32768,
    "d_model": 384,
    "n_layers": 10,
    "n_heads": 6,
    "n_kv_heads": 2,
    "head_dim": 64,
    "ssm_dim": 384,
    "n_routed": 24,
    "n_shared": 2,
    "top_k": 4,
    "expert_d_ff": 96,
    "r_max": 4,
    "dna_slots": 24,
    "seg_types": 4,
    # Derived
    "total_params": "~80M",
    "active_params": "~20M",
    "activation_rate": "0.25",
    "seq_len": 2048,
    "batch_size": 4,
    "grad_accum": 16,
    "lr": 5e-4,
    "warmup_steps": 200,
    "max_steps": 8000,
    "precision": "bf16",
    "checkpoint_every": 500,
    "eval_every": 500,
}
```

### cipher_local_test (CPU/GTX 1060 — smoke test only)
```python
CONFIG = {
    "vocab": 32768,
    "d_model": 128,
    "n_layers": 4,
    "n_heads": 4,
    "n_kv_heads": 2,
    "head_dim": 32,
    "ssm_dim": 128,
    "n_routed": 8,
    "n_shared": 2,
    "top_k": 2,
    "expert_d_ff": 64,
    "r_max": 4,
    "dna_slots": 8,
    "seg_types": 4,
    # Derived
    "total_params": "~5M",
    "active_params": "~2M",
    "seq_len": 512,
    "batch_size": 1,
    "max_steps": 10,
    "precision": "fp32",
}
```

## Verification: Does It Fit?

Run this BEFORE cloud deployment:
```python
import torch
from cipher_arch import CipherModel, cipher_cfg

cfg = cipher_cfg("cipher_cloud_h100")
model = CipherModel(cfg).cuda()
optim = torch.optim.AdamW(model.parameters(), lr=3e-4)

# Simulate one training step
x = torch.randint(0, cfg["vocab"], (4, 2048)).cuda()
loss = model(x, labels=x).loss
loss.backward()
optim.step()

# Check peak memory
peak = torch.cuda.max_memory_allocated() / 1e9
print(f"Peak VRAM: {peak:.2f} GB")
assert peak < 75, f"Exceeds 75GB safety threshold: {peak:.2f} GB"
print("✓ Architecture fits")
```

## What NOT To Do

1. **DO NOT exceed 1B total params** — beyond Chinchilla-optimal for 100M tokens
2. **DO NOT use top_k > 8** — diminishing returns, increased routing cost
3. **DO NOT skip the VRAM check** — OOM on cloud = credits wasted
4. **DO NOT change config mid-training** — architecture is frozen at step 0
5. **DO NOT use the local test config for cloud** — it's too small to learn anything

## Threat Matrix

| Threat | Impact | Fix |
|--------|--------|-----|
| Wrong GPU type (A100 vs H100) | Half the throughput | Verify GPU type before training, use correct preset |
| VRAM OOM at step 0 | Wasted credits | Run VRAM check locally first |
| Too few steps (<1000) | Undertrained garbage | Verify max_steps × tokens_per_step ≥ 30M tokens |
| Too many steps (>50000) | Overfits small corpus | Verify max_steps × tokens_per_step ≤ 3× corpus size |
| Config typo (wrong key) | Silent default values | Validate config against schema before training |
