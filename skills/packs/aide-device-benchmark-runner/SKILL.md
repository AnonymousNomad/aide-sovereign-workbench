---
name: aide-device-benchmark-runner
description: SOP for AIDE's MEASURED device benchmark lane — running llama.cpp llama-bench against a candidate GGUF on the user's actual hardware, parsing pp/tg tok/s from JSON, caching verdicts, and merging measured numbers with M2 header-estimate fit verdicts. Extends (does not replace) aide-model-hub-acquisition M2 estimates. Use when implementing the benchmark runner, when "Will this run fast?" must be answered with numbers instead of estimates, when interpreting llama-bench output, or when debugging benchmark jobs.
---

# Device Benchmark Runner — measured tok/s, not vibes

## What we are doing
Give AIDE a real benchmark capability: user picks a model (or finishes a download) -> daemon spawns llama.cpp's official `llama-bench` binary -> parses JSON output -> caches {pp512_tok_s, tg128_tok_s, stdev, backend, ngl, gpu_name, timestamp} per model+device -> UI shows "runs at ~X tok/s on YOUR machine" and feeds the recommender ranking.

## Research base (primary sources, verified 2026-08-24)
1. llama.cpp `tools/llama-bench/README.md` (ggerganov/llama.cpp master): three test types — pp (prompt processing), tg (text generation), pg (combined); defaults `-p 512 -n 128`, reps default 5; results = mean ± stdev tok/s; **measurements EXCLUDE tokenization and sampling**; `-o json|csv|md` output; `-ngl` controls GPU layer offload; `-fa` flash attention; multiple values via commas run combinatorial matrix.
2. llama-bench JSON shape (llama-bench.cpp + CraftRigs methodology): top-level {build_commit, gpu_devices[], results[]}; each result carries n_gpu_layers, n_prompt, n_gen, test_time_ms, prompt_ms/prompt_n, predict_ms/predict_n. Derive pp = prompt_n/prompt_ms*1000, tg = predict_n/predict_ms*1000 (cross-check against reported t/s).
3. CraftRigs benchmark methodology (2026): single runs swing up to ~15%; thermal throttling swings 12–18% cold vs stabilized; use ≥5 reps (default) or more; warm-up before measuring; report pp512 and tg128 SEPARATELY (never conflate); tg128 ≈ memory-bandwidth / weights-size rule of thumb for sanity-checking.
4. r/LocalLLaMA convention: pp512 + tg128 are THE cross-comparable standard numbers.

## Why this way
- Official tool = battle-tested, comparable numbers, zero new native deps to WRITE (we consume the prebuilt binary shipped alongside our llama.cpp runtime — In-the-Box law: bundle llama-bench.exe with the same release artifact as llama-server; if only llama-server ships today, add llama-bench to the bundle list in packaging phase).
- Estimates (M2) answer "will it FIT"; measurement answers "is it USABLE". Both needed: estimate gates the download, measurement validates reality. GTX 1060-class cards can fit models that are still unpleasantly slow — the recommender needs BOTH signals.

## Design
```
common/contracts/bench.ts   BenchRequest {model_name} ; BenchStatus {state:'queued'|'running'|'done'|'error',
                            progress?, error?} ; BenchReport {model_name, pp512:{mean,std}, tg128:{mean,std},
                            ngl, backend, gpu_name, build_commit, measured_at, duration_s}
node/src/services/bench-service.mjs
  createBenchService({repoRoot, workspace, events, processManager})
  - queue depth 1 (GPU is exclusive; second request -> 409 CONFLICT typed error)
  - locate binary: <repoRoot>/bin/llama-bench.exe (Windows) — fail typed NOT_SUPPORTED 'bench binary not bundled' if absent
  - spawn: execFile('...llama-bench.exe', ['-m', modelPath, '-p','512','-n','128','-r','5','-o','json','-ngl','-1'], timeout 600_000)
    * ngl=-1 lets llama.cpp offload everything that fits (matches our serve-time policy); record achieved ngl from output
    * NO shell:true ever (process-manager law)
  - parse stdout JSON (tool prints one JSON doc; tolerate trailing newline/log noise by extracting first '{'..last '}')
  - persist .aide/bench/<model>.json atomically (tmp+rename, index-store pattern); emit WS 'bench' channel events queued|running|done|error
routes/bench.ts  POST /api/models/bench {model_name}; GET /api/models/bench/status?name=; GET /api/models/bench/list
events.ts  ChannelName += 'bench', zod strict union BenchStreamEvent
```

## Code guidance specifics
- Windows path to binary: never shell-interpolate; execFile argv array.
- Timeout: 10 min hard kill (tree kill via ProcessManager). tg128 on a 1060 for a 8B Q4 ≈ minutes; pp dominates long prompts but we fix p=512 so worst case bounded.
- VRAM guard BEFORE spawn: reuse hardware probe; if fitModel verdict is OVER → refuse with typed error telling user to pick smaller quant (don't OOM the whole machine mid-session).
- Thermal honesty: report stdev; if reps disagree wildly (>15% CV), mark report `unstable:true`.
- Cache invalidation: keyed by model sha256 (manifest already stores size/etag — extend manifest with sha256 if absent) + gpu name; driver change detection out of scope v1.

## Pitfalls / bugs watch-list
1. llama-bench writes progress/logs to stderr in some builds — capture stdout ONLY for JSON; stderr goes to log file for diagnosis.
2. `-o json` emits ONE document even with multiple test combos; we pin single combo (-p 512 -n 128) so results[] length==1 — assert it, don't loop blindly.
3. Pascal (GTX 1060) has no tensor cores / FP16 accel quirks: expect LOW pp vs Ampere; never compare raw numbers across architectures in UI copy ("your machine" framing only).
4. Benchmark while llama-server serves another model = VRAM contention → garbage numbers or OOM. Bench service MUST check model-runtime state; if any local model loaded → 409 with message naming the loaded model.
5. Reps=5 at tg128 for big models can exceed timeout on CPU fallback (ngl clamps to 0 when OVER) — the VRAM pre-guard prevents this path.
6. JSON extraction: some versions wrap output between markdown fences in md mode — we always force `-o json`, but still extract first `{`..last `}` defensively.

## Threat matrix
| Threat | Control |
|---|---|
| Arbitrary file load via model_name | resolve under models dir, reject traversal (same validator as import route); name must match an imported model manifest |
| Resource exhaustion via bench spam | queue depth 1 + 409; per-workspace cooldown 60s |
| Output injection (model file crafted to print junk) | strict JSON parse inside extracted braces; schema-validate via zod contract before persisting |
| Binary tamper | llama-bench ships with release checksums (packaging skill battery verifies sha256 at install) |

## Verification gates (phase-gated)
1. Unit (fake binary fixture script printing canned JSON): happy path fields parsed+cached; CONFLICT while running; traversal rejected; OVER-fit refusal; unstable-stdev flag; timeout kills proc and emits error event.
2. Arch route tests: envelope shapes, 409s, status machine over HTTP, WS 'bench' events through contract union.
3. LIVE once on this machine (GTX 1060): bench the smallest bundled GGUF; assert tg128 within sanity band of bandwidth rule (±40%); evidence JSON into docs/evidence/bench-live.json; manual because GPU-exclusive.
4. Standard chain: tsc x2, eslint, veritas, CI green, journal.
