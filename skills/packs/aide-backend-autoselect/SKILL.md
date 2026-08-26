---
name: aide-backend-autoselect
description: Backend auto-detection and selection SOP for llama-server engines in AIDE — probes candidate binaries via --list-devices, caches capabilities, selects per-model backend/offload (Vulkan/CUDA/CPU) from operator profile override > benchmark verdict > heuristic, ships multi-binary awareness so every download gets optimal tok/s out of the box. Use whenever wiring engine spawn logic, adding GPU offload controls, diagnosing "model ignores -ngl" or slow generation, deciding which llama.cpp builds ship in-box, or benchmarking backends.
---

# Backend Auto-Select — Right Engine, Every Machine

Born 2026-08-25: operator reported Vulkan gives better coherence/throughput than
the configured default. Investigation found the DEFAULT llama-cpp build was
CPU-only (empty --list-devices) while -ngl flags were silently ignored — every
AIDE model had been running pure CPU unnoticed. Adjacent builds existed:
llama-cpp-cuda (no visible devices on this driver) and llama-cpp-vulkan
(GTX 1060 @ 6245 MiB detected). This skill makes that discovery automatic.

## Research base (verified 2026-08-25)

1. **llama.cpp issue #19817 — GTX 1060 exact match**: Vulkan slower at prompt
   processing, NOTICEABLY FASTER token-generation vs CUDA on Pascal
   (granite-1B tg128: 90.63 vs 61.65 t/s = +47%; falcon-7B +11%). Pascal CUDA
   k-quants historically weak (PR #1930 era; LLAMA_CUDA_KQUANTS_ITER tweaks;
   one 1060 tester's best TG was zero-offload CPU).
2. **NVIDIA forum cross-vendor bench (Mar 2026)**: tg roughly parity Vulkan/CUDA
   on modern cards, pp favors CUDA ~15%; GGML_VK_PREFER_HOST_MEMORY=1 adds
   10-15% Vulkan tg. Discussion #23109: qwen3-0.6B GT1030-class Vulkan tg128
   64.8 vs CUDA 40.7 (+59%) — old small cards favor Vulkan decisively.
3. **KV-cache law (#23109 thread)**: mixed K/V types tank both pp and tg hard;
   f16/f16 best for chat tg; quantized KV needs -fa on legacy cards.
4. **SpecPicks RTX3060 matrix**: modern NVIDIA (SM86+) favors CUDA 15-25% TG;
   Pascal is the documented exception. AMD/Intel: Vulkan only GPU path.
5. **Detection protocol (docs/multi-gpu.md + build.md)**: `--list-devices`
   prints per-binary devices (`Vulkan0: NAME (total MiB, free MiB)`); one
   binary may carry multiple backends (-DGGML_CUDA=ON -DGGML_VULKAN=ON);
   `--device <Selector>` chooses at launch; `-ngl auto|all|N` (default auto).
   Empty list = CPU-only build: GPU flags are SILENTLY IGNORED — always probe,
   never assume. Probe cost <10s (backend init included).

## Selection order (per model, at start)

1. Operator override: profile.runtime.backend (+ optional runtime.device
   selector like Vulkan0) wins outright.
2. Cached benchmark verdict: .aide/bench/<artifact-hash>.json winner from the
   device-benchmark-runner lane (llama-bench per candidate backend).
3. Heuristic: NVIDIA Pascal (<SM80) + chat-shaped load -> prefer Vulkan;
   modern NVIDIA -> CUDA; AMD/Intel GPU -> Vulkan; no accelerator -> CPU.
4. First candidate with a NON-EMPTY --list-devices result.

## Architecture in AIDE

- Candidate binaries: AIDE_LLAMA_SERVER (default), AIDE_LLAMA_SERVER_VULKAN,
  AIDE_LLAMA_SERVER_CUDA, AIDE_LLAMA_SERVER_ROCM (env-mapped). Missing/unset
  entries drop out; each survivor gets ONE --list-devices probe cached in
  .aide/backend-capabilities.json {path, devices[], probedAt} (TTL 24h).
- model-manager.start(): resolveBinaryFor(profile) applies selection order,
  appends --device when profile.runtime.device names a selector, -ngl/-fa from
  profile.runtime. Capability cache refreshed when binary mtime changes.
- MODELS panel honesty: each engine shows resolved backend label
  (cpu-only / vulkan / cuda) from the cache — never a silent mismatch.
- Packaging (W9): prefer ONE universal multi-backend llama-server build; else
  bundle cpu+vulkan (small) and offer cuda as first-run download behind the
  explicit-consent egress gate.

## Pitfalls

- CPU-only binaries IGNORE -ngl silently — that failure mode is why probing is mandatory before trusting any offload setting.
- CUDA build with missing/mismatched driver shows empty device list even though the exe exists — treat exe presence as NOTHING; only --list-devices counts.
- Pascal fp16: 0 (per #19817 device dump): avoid fp16 KV/type_k on Vulkan/Pascal; f32/q8_0 paths are safe.
- --device selector strings are binary-specific; pass them through verbatim from that same binary's probe output, never constructed.
- Benchmark verdicts must pin the artifact hash AND binary path+build — a backend win does not transfer across builds.
- Windows: schtasks/env — AIDE_LLAMA_SERVER_* set via setx reach scheduled stacks only after their next process spawn; document restart requirement in UI copy.

## Tests FIRST

1. Parser fixtures: empty list, Vulkan0+CUDA0 multi-line, noise lines, missing header — parser returns [] safely.
2. Capability cache TTL + binary-mtime invalidation.
3. Selection matrix unit tests: override > bench > heuristic > first-available; every branch resolves to an existing binary path.
4. Launch args contain --device only when a matching probed selector exists.
5. Live gate (this box): vulkan-profiled smollm2 start -> server log/backend label vulkan; tok/s >= 2x the CPU baseline recorded in docs/evidence/.

## Gate

Unit green; live dual-backend smoke on this box (cpu vs vulkan tok/s delta table in docs/evidence/backend-selection.md); MODELS panel shows honest backend labels; journal entry. Roadmap DONE when packaging decision (universal vs multi-binary) lands in W9 planning notes.
