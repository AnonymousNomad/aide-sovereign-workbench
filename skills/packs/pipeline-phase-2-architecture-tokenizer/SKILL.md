---
name: pipeline-phase-2-architecture-tokenizer
description: Phase 2 of the from-scratch training pipeline — architecture and tokenizer. Llama-shape transformer config for ~150M params on the GTX 1060 6GB (dim/layers/GQA head-groups/d_ff/vocab), the exact param formula + 139.7M ceiling assert, capacity probes (Megatron activation formula, gradient-checkpointing budget, 5GB VRAM spill threshold), byte-level BPE tokenizer with fertility/utilization/val gates, initialization + residual scaling + warmup rules. Use when designing any new model config, choosing a tokenizer, computing VRAM budgets, or before ANY training run to validate the architecture fits the card.
---

# Phase 2 — Architecture & Tokenizer

A 150M model on a 6GB Pascal card has exactly one chance: the architecture must
fit the memory budget AND the tokenizer must fit the data. Phase 1 proved the
machine; Phase 2 proves the model shape and the token representation. Nothing is
trained until both proofs pass.

Research sources: Llama 1/2 (2202.19836, 2307.09288), SmolLM2 (2502.02737),
TinyLlama (2401.02385), phi-1 (2306.11644), Megatron-LM (1909.08053) activation
formula, GPT-3 tokenizer (2005.14165), sentencepiece/BPE (DBLP:journals/corr/abs-
1804-10959), Mistral GQA, MPT/LLaMA init guidance, llama2.c, nanoGPT.

---

## 1. Architecture Doctrine (this card, this budget)

### Fixed by Phase 1 (non-negotiable)
- FP32 only, 6GB VRAM, 16GB RAM, `num_workers=0`, gradient checkpointing required.
- Hard ceiling: **139.7M params** (measured probe, user 8/7 rule: never >150M).

### PRODUCTION ARCHITECTURE (VERIFIED 2026-08-16 — the actual model)

The ship model is **FSI_Trek dual-mind** (not a plain Llama-shape): 12 layers,
each a DualMindBlock with SEPARATE Spock + Sheldon attention/FFN, RMSNorm, a DNA
gene-bank memory, and dual scratch pads. The Llama-shape below is the reference
fallback; the production numbers are:

| Hyperparameter | Value | Why |
|---|---|---|
| n_layers | 12 | depth at 150M scale |
| dim | 640 | base width |
| spock_heads / sheldon_heads | 12 / 16 | dual-mind attention populations |
| n_kv_heads (GQA) | 8 | KV-cache + activation savings |
| head_dim | 64 | |
| ffn_hidden | 1920 | dual-mind FFN blocks |
| vocab_size | 9302 | tokenizer_v5 (byte-level BPE, verified) |
| max_seq_len | 2048 | RoPE precomputed to 16384 |
| gene_bank_size / gene_dim | 16 / 64 | DNA memory |
| compress_every | 256 | DNA compression cadence |
| n_scratch_slots | 8 | 4 Spock + 4 Sheldon |
| pos_emb | RoPE (precompute_freqs_cis) | no learned positions |
| norm | RMSNorm eps 1e-6 | no bias |
| dropout | 0.0 | regularization via data |

**MEASURED 2026-08-16 (audit probe, audit_capacity_probe.py):**
params = **139,770,624 = ceiling EXACTLY (PASS ≤ 139_770_624)**; 3 fwd+bwd @
seq 1024, batch 2 → peak VRAM **4,265MB (PASS < 5.5GB)**, 1.4s/step, loss 9.146
(≈ ln 9302 = 9.14, init correct), finite, no OOM. Init verified: Linear std =
0.02/sqrt(2*n_layers), Embedding N(0, 0.02) — residual scaling discipline
present in fsi_trek.py `_init_weights`.

### Llama-shape config (REFERENCE fallback, NOT what the ship model uses)
Verified with `scripts/compute_params.py 768 12 12 4 4096 9302 1024` →
**136,905,216 params (97.9% of ceiling) — PASS**

| Hyperparameter | Value | Why |
|---|---|---|
| n_layers | 12 | depth for 150M scale |
| d_model | 768 | 768/12=64 head_dim — dense attention at this size beats MQA for quality |
| n_heads | 12 | 768/12=64 head_dim — dense attention at this size beats MQA for quality |
| n_kv_heads (GQA) | 4 | 1/3 KV-cache + activation savings, minimal quality loss at 150M (SmolLM2 pattern) |
| d_ff | 4096 | 16/3 * d_model, SwiGLU |
| vocab_size | 9302 | matches the existing 150M lineage tokenizer (139.7M was built on vocab 9302) |
| seq_len | 1024 (train) | activations scale with seq; 2048 doubles memory — 1024 for pretrain, longer for eval |
| pos_emb | RoPE theta 10000 | Llama standard; no learned embeddings to save params |
| norm | RMSNorm eps 1e-6 | Llama standard, no bias anywhere |
| dropout | 0.0 | small-model pretrain; regularization via data |

Param math (this config): embed 7,143,936 + per_layer 11,010,048 × 12 =
**139,264,512** (measured: 139,283,712 incl. 19,200 RMSNorm gains) — 99.6% of
ceiling, PASS. If it must go under, drop d_ff to 3968 (135.0M).

### Param formula (verify against this, always)
```
embed = vocab * d_model                                  # 9302*768 = 7.14M
qkv   = dim*dim + 2*dim*kv_heads*head_dim                # q + k + v (GQA)
attn_out = dim*dim
ffn   = 3*dim*d_ff                                       # SwiGLU up+gate+down
per_layer = qkv + attn_out + ffn                         # = 11,010,048 @ this config
out_proj = d_model * vocab (tied — ties embed; untied adds another 7.14M)
total = embed + n_layers*per_layer + out_proj + (RMSNorm gains if counted)
```
For 139.7M target: run the ACTUAL formula on the ACTUAL config — never trust a
round number. Write `compute_params(config)` in Phase 2 code and assert
`total <= 139_770_624`. **The v-projection is the classic missing term — an
under-counted formula makes the model OOM at step 0.**

### Capacity probe (Phase 2 MUST run before Phase 5)
**MEASURED on GTX 1060 (this config):** `capacity_probe.py 768 12 12 4 4096 9302 1024 2`
→ **139,283,712 params, peak VRAM 2.88GB at seq=1024 batch=2 with grad-ckpt ON,
loss 7.32 → 8.6s/3 steps, PASS < 5.5GB.** Headroom ~2.6GB for larger batch,
longer seq, or KV cache at inference.

Megatron activation memory (per token, FP32):
```
attn_acts  = 11 * d_model * seq_len            # per layer, no checkpointing
ffn_acts   = 16 * d_model * d_ff * seq_len / d_model ... (simplified: ~16*seq*d_model + FFN terms)
```
Use the full Megatron formula in code (activation_memory.py), with:
- gradient checkpointing = recompute attn+ffn: activations per layer ≈
  2*seq*d_model*11 (attention only kept)
- Expected budget for 139.7M: static 2.4GB → ~3.6GB left for activations +
  CUDA overhead + beam/generation buffers. Probe by building the model and running
  a real forward+backward at seq 1024 batch 2 — the ACTUAL number is the only
  number that counts.
- If OOM: first reduce seq_len, then batch; gradient checkpointing stays ON.

### Init + residual scaling (Llama 2/LLaMA discipline)
- Embedding: N(0, 0.02)
- Output head: same as embedding init
- All linear: N(0, 0.02), bias = none
- Transformer layers: output proj (attn out + ffn down) scaled by 1/sqrt(2*n_layers)
- RoPE: no learnable params

---

## 2. Tokenizer Doctrine (byte-level BPE, train on YOUR corpus only)

### Verified production state (2026-08-16 audit)
- tokenizer_v5.json: byte-level BPE (model type BPE, ByteLevel pre_tokenizer,
  NFC normalizer), vocab 9302, specials `<pad> <unk> <bos> <eos>` — VERIFIED.
- FERTILITY GATE FAILS on the OLD corpus sample (4.7 vs ≤1.4) — the OLD
  tokenizer was trained on the web-template-heavy corpus (95.7% web). This is a
  KNOWN scheduled fix: rebuild the tokenizer on the FINAL mixed corpus (Phase 3
  output) per this doctrine; the gate failure is the reason, not a blocker for
  the current ship model. add_prefix_space=False in production — the rebuild
  must use add_prefix_space=True + BPE dropout 0.1 (pretrain) per this doctrine.

### What to do
1. **Train on your own corpus** (Phase 3 output). Never download a pretrained
   tokenizer — vocab must match your data's distribution (web-builder + code +
   chat + prose mix). TinyLlama/SmolLM2 trained BPE from scratch on their own
   corpora.
2. Byte-level BPE (GPT-2-style) with `tokenizers` library:
   - vocab_size 8192 (or 16k if corpus is diverse enough) — measured by
     utilization, not preference.
   - `lowercase=False`, `add_prefix_space=True`, BPE dropout 0.1 for pretrain
     (regularization), 0 for SFT.
   - `special_tokens`: `[PAD] [UNK] [BOS] [EOS]` — train with them in vocab.
3. **Verify gates** on a held-out sample BEFORE building the cache:
   - Fertility: mean tokens per word ≤ 1.4 (too high → vocab too small)
   - Utilization: ≥ 95% of vocab used on a 10M-token sample (too low → vocab bloated)
   - Val coverage: no OOV explosion on val split (byte-level BPE has no true OOV,
     but check rare-token behavior)
   - Length: mean seq tokens after tokenization must match config seq_len plan
     (1024) — else re-balance chunks.
4. Save tokenizer as `tokenizer.json` + `tokenizer_config.json` in repo `data/`
   — it is a build artifact, versioned with the corpus.

### Why
- Byte-level BPE has zero OOV (every byte sequence is representable) — the right
  choice for a small model that must never emit `<UNK>` in web/chat formats.
- Training your own tokenizer avoids the classic failure: a pretrained 50k vocab
  that wastes 90% of its capacity on words your corpus never uses (our 13.5k
  Colonymind vocab + 150M model mismatch is a documented counter-example: fix
  vocab FIRST, train later).
- BPE dropout 0.1 improves generalization in small models (measured effect),
  drop it for SFT/distill to keep outputs stable.

### Expected bugs / issues
- `tokenizers` version drift changes merges → tokenizer must be rebuilt from the
  same corpus with the same version; pin the lib version in Phase 1 lockfile.
- Trained on web-only corpus → chat/coherence degradation at inference
  (documented on this project: 95.7% web-template corpus → base cannot produce
  natural language). Corpus mix (Phase 3) and tokenizer are coupled: tokenizer
  trained on the FINAL mixed corpus.
- SentencePiece + BPE differ on whitespace/unicode; pick one and never mix.
- Adding special tokens AFTER training = token-id drift; add them during training
  only.
- Fertility check must use the EXACT final vocab size, not a draft.

---

## 3. Verification Checklist (Phase 2 DONE only when ALL pass)

- [ ] Config printed via `compute_params(config)` == 139.7M ± 0.1M AND ≤ 139_770_624
- [ ] Capacity probe: real forward+backward at seq 1024, batch 2, grad-ckpt ON →
      peak mem < 5.5GB, no OOM, no spurious NaN
- [ ] Residual scaling / init: loss at step 0 on a 10-step smoke run is finite and
      ~ ln(vocab) ± 0.3 (≈ 9.14 for 9302), decreasing after step 2
- [ ] Tokenizer gates pass: fertility ≤1.4, utilization ≥95%, val coverage sane,
      seq-length plan matches config (1024)
- [ ] Tokenizer trained on the FINAL corpus mix (not a draft subset)
- [ ] Determinism smoke (Phase 1) still bit-identical with this model
- [ ] `pytest tests/test_config_ceiling.py` green (asserts ≤ 139.7M)
- [ ] GPU memory flat over 50 steps at real batch (no leak, no spike)

---

## 4. Dependencies Summary

torch 2.9.x+cu128, tokenizers 0.20+ (pinned), numpy 2.x, yaml configs. No
transformers for the model — the model is YOUR code (Phase 5). This phase's
outputs: `model_config.yaml`, `tokenizer.json`, `compute_params.py`,
`activation_memory.py`, `capacity_probe.py`, `tokenizer_train.py`, `tests/`.

---

## 5. When Done

Mark Phase 2 complete in AGENT_NOTES with probe numbers (params, peak mem,
fertility, utilization), then proceed to Phase 3 (Data Acquisition & Curation):
skill `pipeline-phase-3-data-curation`.