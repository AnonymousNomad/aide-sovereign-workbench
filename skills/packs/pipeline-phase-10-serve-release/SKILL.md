---
name: pipeline-phase-10-serve-release
description: Phase 10 (final) of the from-scratch training pipeline — serving, quantization, and release. The offline release chain for THIS card: quantize (Q8_0/Q4_K_M), serve via llama-server (logits_all false, deterministic decoding at eval time, no jinja drift), train/serve parity probes (bitwise-ish logit agreement), identity verification (the served model IS the gated checkpoint), and the closed-loop doctrine that turns deployment failures into data (Phase 7) — plus the release checklist that forbids shipping anything unverified. Use when quantizing, launching a serving stack, verifying served identity, comparing served vs eval-time outputs, or deciding a model is release-ready for the 150M rebuild.
---

# Phase 10 — Serve & Release

The pipeline ends where the product begins: a quantized, served, verified model
that behaves exactly like the checkpoint that passed Phase 9. Serving skew is
the silent killer — a model that passes gates at eval time but behaves
differently through the server invalidates every gate. Phase 10's doctrine:
quantize → serve → PROVE identity → release. This machine's serving facts are
already verified (llama.cpp on E:\, ngl 0 for the 6GB card, llama-server with
logits_all false, ports 8081-8087 doctrine).

Research sources: llama.cpp quantization docs (GGUF Q8_0/Q4_K_M tables),
Google Rules of ML #29/#32/#37 (training/serving skew), Thinking Machines
"Defeating Nondeterminism in LLM Inference" (2025), vLLM/Torchtitan bitwise
parity test suite, train-serve-consistency doctrine, verification-complete
(NASA SWE), post-training-closed-loop (deployment failures -> data).

---

## 1. The Quantization Chain (GGUF on this card)

### What to do
- **Primary**: Q8_0 (near-lossless for FP32-trained weights; web/envelope
  gates are byte-sensitive — Q8_0 keeps them stable). Convert:
  `llama-quantize.exe --tokenizer llama tokenizer.model fp32.gguf q8_0.gguf Q8_0`.
- **Alternative (2nd slot)**: Q4_K_M when VRAM < 4GB needed or faster decode
  matters; verify gates AFTER quantize (a Q4 drop is possible on format gates —
  re-run Phase-9 G-Format on the QUANTIZED file, not the FP32).
- **Tokenizers**: byte-level BPE from Phase 2 is already GGUF-native (llama.cpp
  supports it directly); verify vocab matches the trained tokenizer (special
  tokens map 1:1 — a mismatch silently corrupts every completion).

### Why
- The gates were measured on FP32; the product runs Q8_0/Q4_K_M. Parity must be
  re-proven at each quantization level (quantize is a model change).

### Expected bugs / issues
- Quantizing with a different tokenizer than training (silent corruption) —
  assert vocab equality before/after convert.
- Q4_K_M dropping format gates (envelope hair-trigger) — never ship Q4 without
  a G-Format re-run on the quantized artifact.

---

## 2. The Serving Stack (offline, verified facts)

### What to do
- **Server**: llama-server.exe (E:\llama-cpp\llama-server.exe) with the
  quantized GGUF; `-ngl 0` for the 6GB card (GPU holds weights via CPU offload
  is NOT needed — 139.7M Q8_0 fits RAM easily; keep VRAM for training).
- **`--logits_all false`** (MANDATORY — the verified setting; logits_all true
  slows to unusable on this card).
- **Determinism at eval**: seed fixed, temperature 0 (or greedy), no jinja
  drift (use the same chat template the gates used — template drift is serving
  skew in disguise).
- **Ports**: 8081-8087 doctrine (one server per model version; never overlap).
- **Health**: /health + /v1/models identity check before ANY traffic.
- **Offline**: no network paths in the serve config; the model answers only
  localhost.

### Why
- Serving skew (Rules of ML #32) is the difference between "the gates passed"
  and "the product works". Deterministic decode at eval time makes gate results
  reproducible through the server.

### Expected bugs / issues
- Template drift between gate-time and serve-time (the gate uses the jinja
  template; the server applies its own) — assert template ID + test 3
  completions through BOTH paths, compare.
- logits_all true left on (speed collapse) — the verify battery checks
  throughput.
- Wrong port colliding with a stale server (the 10x llama-server pileup crash
  precedent) — preflight process audit before serve launch (Phase 1 law).

---

## 3. Train/Serve Parity Probes (the identity proof)

### What to do
1. **Logit agreement**: same prompt through the FP32 eval-time path and the
   Q8_0 server path → per-token argmax agreement ≥ 99.9% (Q8_0) / ≥ 99.5%
   (Q4_K_M). Any drop → investigate before release (decode-side differences).
2. **Completion parity**: 20 fixed prompts, greedy both paths, byte-equality of
   the completions (or a documented diff < 1% with a reason).
3. **Gate parity**: re-run the Phase-9 matrix (format/chat/coherence/novelty/
   safety/regression) THROUGH THE SERVER on the quantized model. Gates pass on
   the served artifact, not just the checkpoint.
4. **Identity verification**: hash the served weights (GGUF sha256) matches the
   quantized artifact's manifest; the artifact's provenance chain (train run
   manifest → Phase 9 gate manifest) is complete.

### Why
- The served model must BE the gated model (verification-complete: identity +
  provenance, not vibes). Parity probes are the bitwise-parity discipline from
  the train-serve-consistency doctrine.

### Expected bugs / issues
- Server warmup/cache effects making parity probes flaky (first-token latency,
  KV cache) — run parity after warmup, fixed seed, 3 repeats.
- A "parity" test that compares against the OLD normalizer (comparison-epoch
  law from Phase 9) — parity uses the CURRENT gates only.

---

## 4. The Closed Loop (deployment failures become data)

Any failure observed in serving or in the product (a gate flake, a user-visible
miss, a format drift) flows back:
```
served failure -> classify (data bug | eval bug | model bug) -> Phase 9 audit
-> if data: build new Phase-7 pair/trace -> Phase 8 retrain -> re-gate -> re-serve
```
- The loop is recorded in AGENT_NOTES (closed-loop doctrine: eval -> collect
  failures -> verified re-generation -> feed the right stage -> retrain ->
  repeat).
- A release is never final; it is the current verified state.

### Why
- Small models improve only via verified iteration; the loop is the machine
  that produces it.

---

## 5. Release Checklist (nothing ships unverified)

- [ ] Quantized artifact (Q8_0 primary) with sha256 recorded + provenance chain
      (run manifest -> gate manifest -> quantize log)
- [ ] Tokenizer equality asserted (vocab 1:1, specials map)
- [ ] Serve stack per doctrine: ngl 0, logits_all false, fixed seed, template
      ID asserted, port free (preflight PASS), localhost-only
- [ ] Parity probes: logit argmax >= 99.9% (Q8_0) / >= 99.5% (Q4); completion
      parity on 20 prompts; all PASS
- [ ] Gate matrix re-run THROUGH the server on the quantized artifact — all
      gates PASS (formats, chat, coherence, novelty, safety, regression)
- [ ] Identity: served weight hash == artifact manifest hash
- [ ] Offline confirmed: no egress paths; a network kill test (block the port
      and verify the model still serves) at least once
- [ ] Closed loop documented: where failures will be recorded, and the
      re-entry point (Phase 7)
- [ ] AGENT_NOTES: release entry with artifact hash, gate version, parity
      results, serve config — the release is the record

---

## 6. Dependencies Summary

Phase 9 gate matrix (re-run on served artifact), llama.cpp binaries (quantize +
server), Phase 2 tokenizer vocab, Phase 6 monitoring (serve health), Phase 1
preflight (process/RAM/port audit). No new libraries.

---

## 7. When Done

Phase 10 = the pipeline is complete: 10 verified skills, a gated checkpoint,
a parity-proven served artifact, and a closed loop. Mark it complete in
AGENT_NOTES with the full release record. The 150M rebuild is then: run Phases
1-6 on the new corpus (Phase 3 textbook-quality), gate, post-train (7-8), verify
(9), serve (10).