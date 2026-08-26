---
name: aide-inference-control
description: In-app inference control + tuning SOP for AIDE — per-model sampler profiles (temperature/top-k/top-p/min-p/mirostat/repeat-penalty/seed), runtime knobs (ctx/threads/parallel/ngl), start-time CLI injection AND per-request overrides, presets, live tok/s/TTFT surfaces, benchmark-gated changes. Use whenever building the Model Hub tuning UI, touching model start arguments or chat sampler parameters, adding presets, displaying performance metrics, or deciding how a downloaded GGUF gets configured. References aide-device-benchmark-runner for measurement; does not duplicate it.
---

# Inference Control — Every Model, Tuned Inside AIDE

Born 2026-08-24 from operator directive: users must be able to "really tweak
whatever model they're using right inside AIDE", referencing ToolNeuron's
in-app download + benchmark + configuration pattern.

## Research base (verified sources)

- **Pascal/GTX1060 backend split (llama.cpp issue #19817, Feb 2026 — our exact card)**:
  Vulkan is SLOWER at prompt-processing but NOTICEABLY FASTER at token generation
  vs CUDA on GTX 1060 (granite-1B tg128: 90.63 vs 61.65 t/s = +47%; falcon-7B +11%).
  Root context: Pascal CUDA k-quants historically weak (old PR #1930 needed
  LLAMA_CUDA_KQUANTS_ITER tweaks; one 1060 tester got best TG with zero offload).
  => backend is a PER-MODEL RUNTIME CHOICE in AIDE, never hardcoded:
  profile.runtime.backend selects binary via AIDE_LLAMA_SERVER_<BACKEND> env;
  profile.runtime.ngl passes -ngl (999 = full offload); flash_attn -> -fa.
- **KV-cache law (discussion #23109)**: mixed K/V types tank both pp and tg hard;
  f16/f16 best for chat-style tg; quantized KV on old cards requires -fa.
  GGML_VK_PREFER_HOST_MEMORY=1 adds 10-15% tg on Vulkan.
- **ToolNeuron v3 (GitHub Siddhesh2377/ToolNeuron + tool-neuron.vercel.app/features)**:
  HF Explorer with dynamic filter chips populated from the LIVE tags catalog
  (pipeline tag, library, params, quant, license, gated, author); per-model
  configs PERSISTED (temperature, top-k, top-p, min-p, repeat penalty, context
  length) saved per model to database; per-turn tok/s + TTFT + peak-memory
  metrics shown per reply; grammar-constrained function calling; gated-repo
  detection; outbound traffic ONLY on explicit user action.
- **llama.cpp server sampling surface (server README)**: request-level and
  CLI-level: temperature, top_k, top_p, min_p, typical_p, tfs_z, mirostat(0/1/2),
  mirostat_tau, mirostat_eta, repeat_penalty, presence_penalty,
  frequency_penalty, seed, n_predict; runtime: --ctx-size, --threads,
  --parallel, -ngl, --flash-attn. OpenAI-compatible /v1/chat/completions accepts
  most sampler fields per request; unknown fields are ignored by older builds —
  VERIFY against the bundled binary version (curl probe) rather than assume.
- **train-serve-consistency law**: evaluation/deterministic paths pin
  temperature=0 + fixed seed; user "play" paths may deviate. Never let tuning
  leak into gate runs.

## Why this design (not just sliders)

Raw samplers confuse users; presets + profiles make weak local models usable:
- min_p beats top_p as the primary cutoff at higher temperatures on small
  models (community consensus + ToolNeuron exposing min_p prominently).
- Mirostat(v2) stabilizes perplexity on long generations where top-p drifts —
  expose tau (target entropy) not raw algorithm choice.
- Profiles travel WITH the model: downloading a GGUF via hub auto-provisions a
  sensible default profile derived from its metadata (quant, size, family);
  operators tweak from there, never from zero.

## Architecture in AIDE

1. **Profile store**: `models/<artifact>.profile.json` sidecars (human-readable,
   gitignored) + merged view served by GET /api/models/status as
   `profile` field. Schema (zod strict, common/contracts/modelhub.ts):
   ModelProfile{ samplers{temperature?,top_k?,top_p?,min_p?,mirostat?,
   mirostat_tau?,mirostat_eta?,repeat_penalty?,seed?}, runtime{ctx_tokens?,
   threads?,parallel?,flash_attn?}, preset?: enum(precise|balanced|creative|
   mirostat|custom) }.
2. **Start-time application**: daemon/model-manager.mjs binary branch appends
   profile→CLI mapping after defaults; runtime ctx change triggers model-fit
   recheck BEFORE spawn (aide-model-fit / free-RAM preflight already there).
3. **Request-time overrides**: legacy + ts chat handlers whitelist sampler keys
   from body.samplers into the upstream /chat/completions body. Precedence:
   request > profile > handler default (temp 0.2). Unknown keys rejected
   VALIDATION, never silently forwarded (supply-chain cleanliness).
4. **Presets** (cockpit one-click): precise{t0.1,minP0.05,rep1.05,seed0},
   balanced{t0.7,topP0.9,minP0.05}, creative{t1.0,topP0.95,minP0.03},
   mirostat{mirostat2,tau5.0,eta0.1}. Preset writes profile; user can then
   edit numbers (advanced drawer, monthly-tier per smart-workbench-flow).
5. **Metrics honesty**: server timings already returned by llama-server
   (timings.predicted_ms etc.) → cockpit shows tok/s + TTFT per reply chip;
   peak-RAM from benchmark lane only (not per-reply).
6. **Benchmark gating**: any runtime change (ctx/threads/parallel) suggests
   re-running device benchmark lane (aide-device-benchmark-runner) before/after;
   verdicts cached so repeated tweaks don't re-bench.

## Tests FIRST

1. Profile round-trip: write profile → status() exposes merged → restart keeps it.
2. Start args contain mapped flags exactly once; preset→flags snapshot tests.
3. Override precedence matrix: request over profile over default; unknown key → VALIDATION error envelope.
4. ctx increase beyond fit → blocked with fit reason (model-fit), not spawned.
5. Deterministic gate: eval path ignores profile samplers (pins temp0/seed).
6. Metrics chip: mocked timings render tok/s + TTFT; absent timings render nothing (no dead UI).

## Pitfalls (device/codebase specifics)

- mirostat ON makes top_k/top_p irrelevant — UI must dim them when mirostat≠0.
- seed determinism holds only per binary+hardware; never promise cross-machine reproducibility.
- --threads > physical cores REGRESSES on i7-8750H (6c/12t): default threads=4 stays.
- GTX 1060 6GB: -ngl is bounded by VRAM fit; profile ngl changes must pass model-fit first.
- llama.cpp renamed/aliased flags across versions — map through ONE table with
  the bundled binary's version pinned; probe unknown-flag failure at start (non-zero exit → surfaced, not retried).
- Windows arg quoting: values with spaces never occur here (numeric/enums) — keep numeric validation strict anyway.
- Do NOT add network calls for tag catalogs without the explicit-action + journal pattern (No-Phone-Home); cache last catalog under .aide/.

## Gate

Unit green (profile store, arg mapping, precedence, presets); live smoke: start
bundled model with creative profile → curl chat returns harness meta +
timings; cockpit Tuning drawer renders current profile and persists an edit;
benchmark suggestion appears after ctx change. Journal + roadmap DONE entry.
