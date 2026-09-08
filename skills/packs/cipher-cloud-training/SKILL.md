---
name: cipher-cloud-training
description: Master orchestrator for training the FSI Felon Cipher model from scratch on cloud GPUs. Use at the START of any cipher training task. Covers the full pipeline: architecture sizing, tokenizer, data prep, cloud deployment, training, checkpoint recovery, and evaluation. 7 phases, 8 skills.
---

# FSI Felon Cipher — Cloud Training Pipeline

## Mission
Train the FSI Felon Cipher (600M-1B MoE, twin Sheldon/Spock populations) from scratch on cloud GPUs (A100/H100 80GB) using the NVIDIA Developer Program / NGC ecosystem. 7-8 hour GPU budget.

## Hardware Truth
- **Local**: GTX 1060 6GB (FP32 only, no tensor cores) + 16GB RAM
- **Cloud target**: A100 80GB or H100 80GB (BF16 tensor cores)
- **Budget**: 7-8 hours GPU time

## Phase Map

| Phase | Skill | What | Duration |
|-------|-------|------|----------|
| 0 | cipher-sizing | Architecture sizing for time budget | 1-2h (local) |
| 1 | cipher-tokenizer | Complete tokenizer (500 → 32K vocab) | 1h (local) |
| 2 | cipher-data-pipeline | Corpus prep + tokenize + shard | 2-3h (local) |
| 3 | cipher-cloud-setup | Docker + NGC + upload | 1-2h (local) |
| 4 | cipher-training | BF16 MoE training on cloud GPU | 5-7h (cloud) |
| 5 | cipher-checkpoint | Save + verify + download | 1h (cloud+local) |
| 6 | cipher-eval | Eval battery + serve locally | 2-3h (local) |

**Total local prep**: ~6-8h (before touching cloud)
**Total cloud time**: ~6-8h (training + eval)

## Critical Rules

### R1: BF16 is Mandatory
FP32 wastes 90% of A100/H100 silicon. On a 7-8h budget, FP32 = disqualifying. BF16 with FP32 master weights + optimizer is the only viable path.

### R2: Pre-Tokenize Everything Locally
Tokenization is CPU-bound. Never waste GPU time on it. Tokenize on GTX 1060, upload .pt shards to cloud.

### R3: Checkpoint Every 30 Minutes
Cloud instances can die. Checkpoint to persistent storage. Include model + optimizer + scheduler + RNG + step + token_offset.

### R4: Active Params Drive Compute
MoE training cost = 6 × N_active × D, NOT 6 × N_total × D. Size the model around ACTIVE parameters for time budget.

### R5: No Training Without Verified Architecture
Smoke test the full forward+backward pass on CPU locally before uploading to cloud. One successful batch proves the code works.

### R6: Loss-Free Balancing > Auxiliary Loss
DeepSeek-V3 proved loss-free balancing (bias-based) gives BOTH better perplexity AND better load balance. Use it.

### R7: Gradient Checkpoint Every MoE Layer
NVIDIA NeMo 2026: selective checkpointing is for dense models ONLY. MoE requires full checkpointing of MoE layers.

## Time Budget Analysis

| GPU | 8h throughput (dense) | MoE derate (60-85%) | Usable tokens |
|-----|----------------------|---------------------|---------------|
| A100 80GB | ~58M tok | ~35-50M tok | 35-50M |
| H100 80GB | ~144M tok | ~86-122M tok | 86-122M |

Chinchilla-optimal for 50M tokens = ~2.5M params (dense). MoE lets us go larger in stored capacity while keeping active params small.

## Recommended Architecture (sized for 8h on H100)

```
Preset: "cipher_cloud_h100"
  vocab:        32768
  d_model:      512
  n_layers:     12
  n_heads:      8
  n_kv_heads:   2
  head_dim:     64
  n_routed:     32       (reduced from 62 for time budget)
  n_shared:     2
  top_k:        4        (reduced from 8 for time budget)
  expert_d_ff:  128      (reduced from 256)
  Active params: ~40M
  Total params:  ~200M
  Training:     BF16, batch 4 × grad_accum 12 = 48 seq/step
  Sequence:     2048
  Steps:        ~10,000 (8h on H100)
  Tokens:       ~100M (2 epochs over 50M curated)
```

## What NOT To Do

1. **DO NOT train on GTX 1060** — FP32 + 6GB VRAM = weeks for what cloud does in hours
2. **DO NOT use FP32 on cloud** — wastes 90% of tensor cores
3. **DO NOT tokenize on cloud** — CPU work burns GPU money
4. **DO NOT skip architecture smoke test** — discovering bugs on cloud = wasted credits
5. **DO NOT checkpoint only weights** — lose optimizer state = training instability on resume
6. **DO NOT use auxiliary loss for 62 experts** — loss-free balancing is strictly better
7. **DO NOT skip z-loss** — router logit explosion kills training silently
8. **DO NOT train without monitoring** — W&B or tensorboard, watch for NaN/collapse
9. **DO NOT download only best checkpoint** — download ALL checkpoints (you can't go back)
10. **DO NOT skip eval before claiming done** — perplexity + generation quality + routing health

## Threat Matrix

| Threat | Impact | Mitigation |
|--------|--------|------------|
| Cloud instance killed mid-training | Lost hours | Checkpoint every 30min to persistent storage |
| Expert collapse (1 expert dominates) | Model useless | Loss-free balancing + z-loss + utilization monitoring |
| Router logit explosion → NaN | Training dead | Z-loss (α=0.001) + gradient clipping 1.0 |
| Tokenizer mismatch (train vs serve) | Gibberish output | Pin tokenizer, verify vocab equality before serving |
| bf16 overflow on large logits | Silent corruption | Gradient clipping + z-loss + QK-Norm |
| Checkpoint corruption on save | Unrecoverable | Atomic writes (.tmp → os.replace) + SHA-256 verify |
| Insufficient data diversity | Memorization | Verify corpus mix before training |
| Cross-population merge (S+K same) | Design failure | Orthogonality loss + overlap monitoring |
| Overfitting (small corpus) | No generalization | Dropout 0.1 + weight decay 0.1 + early stopping |
| Download fails mid-transfer | Checkpoint lost | Multiple download methods + verify checksums |

## Dependencies

### Python (cloud container)
```
torch>=2.4.0
tokenizers>=0.19.0
numpy>=1.24.0
tqdm>=4.66.0
pyyaml>=6.0
```

### Optional (monitoring)
```
wandb>=0.16.0
tensorboard>=2.15.0
```

### Local (for prep)
```
torch (CPU version OK for tokenizer + data prep)
tokenizers
numpy
tqdm
```
