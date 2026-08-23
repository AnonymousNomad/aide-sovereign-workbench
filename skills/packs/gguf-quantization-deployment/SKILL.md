---
name: gguf-quantization-deployment
description: Quantize, verify, and deploy GGUF models for the 150M FSI-FELON rebuild. Covers quantization format selection (Q8_0/Q4_K_M/Q5_K_M), Pareto-optimal tradeoffs, train/serve parity probes (logit agreement ≥99.9%, completion parity, gate re-run through server), tokenizer vocab equality, identity verification (GGUF sha256 chain), and offline serving stack (llama-server, ngl=0, logits_all=false, ports 8081-8087). Use when quantizing the gated checkpoint, launching the serving stack, running parity probes, or deciding release quantization.
---

# GGUF Quantization & Deployment — Evidence-Based (2026)

## Research Foundations (what benchmarks actually show)

| Source | Proven Principle | Applied As |
|--------|------------------|------------|
| arXiv 2601.14277 (Kurt 2026) | **Q4_K_M essentially matches F16 on GSM8K (77.41 vs 77.63)**; Q3_K_S drops 9.32 pts; Q5_0 slightly exceeds F16; format matters more than bit-width | Primary quant = Q8_0 (near-lossless for format gates); fallback = Q4_K_M (Pareto-optimal); NEVER Q3 or below for reasoning |
| Presenc AI 2026 benchmarks | **Q4_K_M = production sweet spot**: 1-2% PPL degradation, ~3.7x speedup, ~4x memory; Q3 shows meaningful reasoning regression (5% GSM8K drop) | Release target = Q4_K_M; Q5_K_M if reasoning-critical; Q8_0 for benchmarks |
| yrougy/llm-quant-bench (GTX 1070) | **BigCodeBench (code) most sensitive to quant**; Q4_K_M reliable floor; below Q3 risks significant drops on coding | Code-gen gate re-run on quantized artifact MANDATORY; Q4_K_M minimum for web-builder |
| 200lz/llm-inference-optimization-lab | **Q4_K_M 61% smaller than F16**; Q8_0 46% smaller; end-to-end A/B inconclusive on CPU — measure on YOUR hardware | Parity probes on THIS card (GTX 1060); llama-bench median-of-3 |
| LM Studio 2026 guide | **Target file size 1-2 GB below VRAM**; K-quants preferred unless below Q4 with imatrix | 150M fp32 = 64.5MB → Q4_K_M ~29MB, Q8_0 ~32MB; both fit easily |

## Quantization Chain for 150M FSI-FELON

### FP32 → GGUF Conversion
```bash
# 1. Convert FP32 checkpoint to GGUF (llama.cpp convert script)
python convert_hf_to_gguf.py --outfile trek150_fp32.gguf --outtype f32

# 2. Primary quantization: Q8_0 (near-lossless for FP32-trained weights)
llama-quantize.exe trek150_fp32.gguf trek150_q8_0.gguf Q8_0

# 3. Production quantization: Q4_K_M (Pareto-optimal)
llama-quantize.exe trek150_fp32.gguf trek150_q4_k_m.gguf Q4_K_M

# 4. Optional: Q5_K_M if reasoning-critical (1-2% better than Q4_K_M on GSM8K)
llama-quantize.exe trek150_fp32.gguf trek150_q5_k_m.gguf Q5_K_M
```

### Tokenizer Equality Assertion (MANDATORY)
```python
# Before quantize: assert vocab 1:1 match
assert trained_tokenizer.vocab == gguf_tokenizer.vocab
assert trained_tokenizer.special_tokens_map == gguf_tokenizer.special_tokens_map
# Special tokens: <pad> <bos> <eos> + project markers (<task>, <mind_spock>, etc.)
# A mismatch silently corrupts every completion
```

## Train/Serve Parity Probes (Phase 10 Identity Proof)

### Probe 1: Logit Agreement (≥99.9% Q8_0 / ≥99.5% Q4_K_M)
```python
# Same prompt through FP32 eval path and Q8_0 server path
# Per-token argmax agreement across 20 prompts, 128 tokens each
# Any drop → investigate decode-side differences before release
```

### Probe 2: Completion Parity (20 prompts, greedy, byte-equality)
```python
# Fixed seed (42), temp 0.0, same chat template
# FP32 completion == Q8_0 completion (or documented diff <1% with reason)
```

### Probe 3: Gate Matrix Re-run THROUGH Server
```python
# Re-run FULL Phase-9 matrix on quantized model via llama-server
# G-Format, G-Chat, G-Coherence, G-Novelty, G-Safety, G-Regression
# Gates pass on SERVED artifact, not just checkpoint
```

### Probe 4: Identity Verification
```python
# sha256(served GGUF) == manifest.sha256
# Provenance chain: train_manifest → gate_manifest → quantize_log → GGUF sha256
```

## Serving Stack (Offline, Verified)

### llama-server Configuration
```bash
llama-server.exe \
  -m trek150_q8_0.gguf \
  -ngl 0 \                    # 6GB card: CPU offload NOT needed; 139.7M Q8_0 fits RAM
  --logits_all false \        # MANDATORY — true slows to unusable on Pascal
  --jinja \                   # Use same chat template as gates
  --chat_template_kwargs '{"enable_thinking": false}' \  # MANDATORY for Qwen teacher parity
  -c 2048 \                   # Context (matches training max)
  --port 8081 \               # Ports 8081-8087 doctrine (one server per model version)
  --host 127.0.0.1 \          # Localhost-only (offline)
  --seed 42 \                 # Fixed seed for determinism
  --temp 0.0                  # Greedy for parity probes
```

### Health & Identity Checks
```bash
# Pre-traffic verification
curl http://127.0.0.1:8081/health
curl http://127.0.0.1:8081/v1/models  # Returns loaded model ID + sha256
```

### Offline Confirmation (Network Kill Test)
```bash
# Block port 8081 at firewall, verify model still serves localhost
# Confirms no egress paths (telemetry, license checks, etc.)
```

## Quantization Gate Checklist (Phase 10 Release)

- [ ] Q8_0 artifact produced + sha256 recorded in manifest
- [ ] Tokenizer vocab equality asserted (1:1, specials map)
- [ ] Q4_K_M artifact produced + sha256 recorded
- [ ] Serve stack per doctrine: ngl=0, logits_all=false, fixed seed, template ID asserted, port free (preflight PASS), localhost-only
- [ ] Parity probes: logit argmax ≥99.9% (Q8_0) / ≥99.5% (Q4); completion parity 20 prompts; ALL PASS
- [ ] Phase-9 gate matrix re-run THROUGH server on quantized artifact — ALL GATES PASS
- [ ] Identity: served weight hash == artifact manifest hash
- [ ] Offline confirmed: network kill test PASS
- [ ] Closed loop documented: failure → classify → Phase 7/8/9 re-entry
- [ ] AGENT_NOTES release entry: artifact hash, gate version, parity results, serve config

## Expected Bugs / Issues
- **Template drift**: Gate uses jinja template; server applies its own — assert template ID + test 3 completions through BOTH paths, compare
- **logits_all true left on** — speed collapse; verify battery checks throughput
- **Wrong port colliding with stale server** — 10× llama-server pileup crash precedent; preflight process audit before serve launch (Phase 1 law)
- **Quantization format mismatch** — K-quants vs legacy; use llama-quantize.exe from SAME llama.cpp build as llama-server
- **KV cache quantization** — llama.cpp uses q4_0 KV cache by default; this is correct for consumer usage

## Dependencies
- Phase 9: pipeline-phase-9-eval-gates (gate matrix to re-run)
- Phase 10: pipeline-phase-10-serve-release (release checklist)
- llama.cpp binaries at E:\llama-cpp\ (llama-server.exe, llama-quantize.exe, llama-cli.exe)
- GGUF artifacts in E:\trek_150_runtime\gguf\
- Tokenizer: tokenizer_v5.json (byte-level BPE, vocab 9302)

## Threat Matrix
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Tokenizer mismatch after quantize | MEDIUM | CRITICAL | Assert vocab equality BEFORE quantize; test 3 completions both paths |
| Q4_K_M drops format gates (envelope hair-trigger) | MEDIUM (observed) | HIGH | NEVER ship Q4 without G-Format re-run on quantized artifact |
| Server non-determinism (seed/temp/context) | MEDIUM | HIGH | Parity probe 1 (self-consistency) catches this; fixed seed 42, temp 0 |
| Stale server port collision | HIGH (observed) | CRITICAL | Preflight PASS mandatory; kill existing llama-server on port |
| Network egress in serve stack | LOW | HIGH | Network kill test at least once; firewall block verify |

## When Done
Mark quantization & deployment complete in AGENT_NOTES with: GGUF sha256s (Q8_0, Q4_K_M, Q5_K_M), parity probe results (logit %, completion parity, gate matrix scores), serve config, and offline test result.