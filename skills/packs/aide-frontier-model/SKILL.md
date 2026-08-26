# Skill: aide-frontier-model

# AIDE Frontier Model — custom/merged model → working GGUF → fine-tune for AIDE workflow

## Mission
Take a custom or merged model (e.g., Kira-14e: Kimi K2.6 × DeepSeek V3.1 MoE merge,
6.66B total / ~1.3B active) and turn it into the frontier model embedded in the AIDE
workbench: converted properly, fine-tuned on the AIDE workflow, served offline via
llama.cpp at usable speed on GTX 1060 6GB.

## THE THREE LAWS (learned 2026-08-23, measured)

### Law 1 — NEVER hand-roll GGUF exports.
The original kira-14e-q4_k.gguf was written by a custom export script mapping tensors
to DEEPSEEK2 metadata by hand. Result: token-id chaos (`[UNK_BYTE_0x20 ...]` soup),
model unusable. The OFFICIAL `convert_hf_to_gguf.py` from the llama.cpp repo matched
the server build commit EXACTLY and dispatched DeepseekV3ForCausalLM natively
(verified live: 295 tensors indexed, 13 shards).
- Why: llama.cpp's converter owns arch dispatch (deepseek2 family incl. V3/V32/V4),
  vocab/tokenizer mapping, MLA tensor shapes. Hand-rolling re-implements a moving target.
- Rule: `convert_hf_to_gguf.py --outfile X.gguf --outtype f16`, then `llama-quantize`
  for Q4_K_M. Custom exporters are forbidden in this pipeline.

### Law 2 — Verify deployment BEFORE fine-tuning.
Convert first, serve first, run the battery FIRST on the base model. If the base is
broken/incoherent through llama.cpp, no amount of LoRA fixes deployment. Gate order:
convert → serve → coherence battery → (only if pass) fine-tune.

### Law 3 — Fine-tune at REAL sequence length with anti-memorization gates.
The v27 Kira recipe trained at seq_len 64–128 and drove persona phase loss to 0.0007
(pure memorization of 27 examples). For an in-IDE coding/workflow assistant:
- seq_len ≥ 1024 for SFT phases (AIDE prompts are whole-file scale)
- persona/domain phases: stop at loss plateau, never below ~0.8–1.0 nats; cap examples
  seen; hold-out eval REQUIRED per phase before advancing
- one eval battery per phase gate; failing phase = rebuild data, not more steps

## SIZING MATRIX (GTX 1060 6GB, fp32-era card, measured)

| Model | Quant | VRAM fit | Expected tok/s (GPU offload) | AIDE verdict |
|---|---|---|---|---|
| Kira-14e 6.66B MoE (1.3B active) | Q4_K_M ≈ 3.9GB | full offload tight w/ ctx ≤4k; else partial | ~10–25 GPU-assisted | possible frontier; verify coherence first |
| Qwen2.5-Coder-3B-Instruct | Q4_K_M 1.80GB (already in E:\models) | easy full offload | ~25–40 | SAFE default coder |
| Qwen3.5-4B | Q4_K_M 2.81GB | comfortable | ~20–35 | general fallback |
| SmolLM2-360M | q8_0 0.36GB | trivial | ~60+ | autocomplete/utility slot |

Rule: the AIDE "frontier" slot needs ≥20 tok/s sustained (edge-deployment-ci skill)
and ≤4GB VRAM so the IDE + daemon breathe. Anything slower becomes CPU-only utility.

## GPU BACKEND FOR PASCAL (GTX 1060) — MEASURED 2026-08-23, MANDATORY

| Backend | Result |
|---|---|
| CPU build (E:\llama-cpp) | ✅ coherent, ~4–7 tok/s on 4B — usable fallback, no CUDA dlls |
| Official CUDA zip b9940 | ❌ **BROKEN on sm_61**: loads, health OKs, generates word-salad ("loadingN loadingN"), known failure class (llama.cpp #9019 wrong-arch → nonsense instead of crash; #19659 MoE cuBLAS corruption) |
| **Official Vulkan zip b9940** | ✅✅ **31–41 tok/s**, all tests pass, coherent |

Rules:
1. Serve from `E:\llama-cpp-vulkan\` (Vulkan b9940) for ALL GPU inference.
2. NEVER use the official CUDA zip on Pascal — fails silently as garbage text.
3. Known open issue: after long multi-request sessions the HTTP listener dies
   silently (process alive, port gone — verify with `netstat -ano | findstr 8088`).
   Mitigation: restart server between heavy batches; use keep-alive sessions;
   watch for upstream fix in newer builds.
4. If server hangs at load: add `--no-mmap` (Windows AV × mmap interaction).
5. Verify offload actually happened: `nvidia-smi` must show model-size VRAM
   (a CPU-only binary ignores -ngl SILENTLY — check for ggml-cuda.dll/ggml-vulkan.dll).

## CONVERSION PIPELINE (do exactly this)

1. Match toolchain to runtime: clone llama.cpp, checkout the SAME commit as the
   server binary (`llama-server --version` → e.g. b9940 / 259f2e2a5). Converter and
   server must come from the same era.
2. Prereqs in venv_trek: torch, transformers, safetensors +
   `pip install gguf` (or use repo gguf-py via PYTHONPATH=E:\llama-cpp-src\gguf-py).
3. Model dir MUST be HF-conventional: config.json complete (DeepseekV3 fields:
   moe_intermediate_size, n_shared_experts, first_k_dense_replace, n_group,
   topk_group, routed_scaling_factor, q_lora/kv_lora ranks, rope_scaling YaRN),
   safetensors with STANDARD names (mlp.experts.K.gate_proj/up_proj/down_proj —
   verify via model.safetensors.index.json), tokenizer files present.
4. Tokenizer: if tiktoken-style (Kimi), ensure a transformers-fast `tokenizer.json`
   exists whose vocab_size == config.vocab_size (Kimi K2 = 163,840). Missing → fetch
   official repo tokenizer.json or export via tokenization code. WRONG TOKENIZER =
   UNK soup even with perfect weights.
5. Convert: `python convert_hf_to_gguf.py <dir> --outfile base-f16.gguf --outtype f16`
6. Quantize: `llama-quantize base-f16.gguf base-q4_k_m.gguf Q4_K_M`
7. Serve: `llama-server -m base-q4_k_m.gguf --port 8087 -c 4096 -ngl 999`
   (reduce -ngl / -c if OOM; Pascal has no flash-attn — leave disabled)

## VERIFICATION BATTERY (gate before ANY fine-tune; rerun after)

Run via llama-server /v1/chat/completions, temperature 0.25, capture to UTF-8 file
(cp1252 console mangles CJK — always write results to disk):
1. COHERENCE — 3-sentence constrained story (no UNK soup, no CJK leakage on English prompt)
2. IDENTITY — "Who are you?" stable across 3 asks
3. CODE — generate function → EXECUTE via verify_harness.run_verified (must pass tests)
4. FACTCHECK — claim vs two conflicting sources → scratchpad + verdict format
5. ARITHMETIC — 17*24 style, show work
6. INSTRUCTION — exact-format compliance ("three colors, one per line")
PASS bar: 0 UNK tokens anywhere; code test passes; instruction format exact;
factcheck verdict matches the evidence direction. Any UNK = deployment broken, stop.

## FINE-TUNE RECIPE v2 (AIDE workflow tuning, after base passes)

Base rules (fixes v27's measured failures):
- seq_len 1024 (not 64/128); batch as VRAM allows, grad-accum to eff ≥16k tok
- QLoRA r16 alpha32 dropout 0.05, KL-to-base 0.1, replay-ratio 0.5 (KEEP — these
  were correct and exceed doctrine minimums)
- LR 5e-5 constant LoRA (proven), clip 0.5, atomic saves only, log lr+grad-norm
- Phase gates: each phase ends with held-out eval + task battery; phase advance
  requires: val_ppl improved AND no memorization signature (phase loss floor ~0.8+
  nats; loss < 0.5 = overfit, cut data not steps)

Phase plan for AIDE workflow corpus:
1. SFT on AIDE workflow traces (open→edit→test→fix cycles, tool calls, project nav)
   — authored/verified per gold-training-docs + zero-dup laws; target ≥2,000 rows
2. Correction phase (≤200 rows): wrong-then-fixed outputs, 1 epoch max, watch loss
3. Persona (Kira voice, ≤50 rows): STOP AT PLATEAU — never chase 0.0007
4. Domain mastery: AIDE-relevant code at seq 1024, replay mixed
Then DPO on execution-verified preference pairs (chosen passes harness, rejected
fails) — trek/anomaly proven pattern. Then quantize → battery → embed in AIDE.

## THREAT MATRIX

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hand-rolled exporter returns | HIGH if legacy scripts kept | fatal (UNK soup) | Law 1; delete/ban export_gguf.py paths |
| Wrong/mismatched tokenizer.json | MEDIUM | fatal (garbage tokens) | vocab_size == config check + UNK scan in battery |
| Converter/server version mismatch | MEDIUM | silent corruption | same-commit rule (Law 1 step 1) |
| seq_len too small in FT | certain if ignored | model can't use IDE context | Law 3: ≥1024 |
| Persona phase memorization | HIGH (measured 0.0007) | parrot, no generalization | loss-floor gate + held-out battery per phase |
| VRAM creep at inference | MEDIUM (5.24GB seen on cipher bench) | laptop lockup | -c ≤4096, monitor, keep IDE overhead budget |
| CPU-only fallback speed | certain if offload fails | unusable frontier | verify -ngl actually offloads (nvidia-smi) |

## DEPENDENCIES
llama.cpp source @ runtime commit; python venv_trek (torch/transformers/safetensors/gguf);
verify_harness.py (execution tests); llama-quantize binary; HF access for official
tokenizer files when merging third-party models; E:\models store for fallback bases.

## WHEN DONE
Battery report saved (UTF-8), quantized GGUF sha256 recorded, serving entry added to
AIDE model registry (port 808X), and a fine-tune changelog entry per phase with
val_ppl + battery deltas. Never claim frontier-ready without the full battery pass.
