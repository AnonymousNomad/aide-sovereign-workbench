---
name: edge-deployment-ci
description: CI/CD gates for edge deployment of the 150M FSI-FELON model. Covers quantization targets (Q4_K_M primary), CPU/WASM/phone targets, thermal/sustained load testing, model file size gate, first-token latency, steady-state tok/s, RSS memory, and sustained-load CI (not single-shot). Use when building the release pipeline, configuring CI for the quantized artifacts, or validating deployment targets before release.
---

# Edge Deployment CI — Sustained-Load Verification (2026)

## Research Foundations

| Source | Proven Principle | Applied As |
|--------|------------------|------------|
| TinyBench / Edge 2026 | **Thermal + sustained load, not peak compute, is the binding constraint**; CI must gate latency/memory/size per release; test SUSTAINED (warm), not single-shot | CI microbenchmark gate: size, first-token, steady-state tok/s, RSS — tested WARM on floor hardware |
| 200lz/llm-inference-optimization-lab | **Smaller GGUF files did not automatically improve CPU throughput**; prefill/decode respond differently to thread count; Q8_0/Q4_K_M higher IPC but more instructions | Report prefill + decode separately; measure on actual target hardware (GTX 1060, CPU, phone) |
| llama.cpp quantization benchmarks | **Q4_K_M = production sweet spot**: 1-2% PPL degradation, ~3.7x speedup, ~4x memory; **Q3 shows meaningful reasoning regression** | Release quant = Q4_K_M; Q5_K_M if reasoning-critical; NEVER Q3/Q2 |
| Presenc AI 2026 | **Q4_K_M or AWQ 4-bit for production agents**; single-user chat = Q4_K_M; Apple Silicon = MLX 4-bit; memory-constrained = Q3_K_M (non-reasoning only) | Multi-target: GTX 1060 (Q8_0/Q4_K_M), CPU (Q4_K_M), WASM (Q4_K_M), phone (Q4_K_M) |

## Deployment Targets (floor hardware first)

| Target | Hardware | Quant | Runtime | Size Gate | Latency Gate | Throughput Gate | Memory Gate |
|--------|----------|-------|---------|-----------|--------------|-----------------|-------------|
| **Primary (IDE)** | GTX 1060 6GB | Q8_0 / Q4_K_M | llama.cpp | ≤35 MB | ≤200ms (p50) | ≥20 tok/s (warm) | ≤2 GB RSS |
| **CPU Fallback** | i7-8750H (6C/12T) | Q4_K_M | llama.cpp | ≤35 MB | ≤500ms (p50) | ≥8 tok/s (warm) | ≤1.5 GB RSS |
| **WASM (Browser)** | Any (WebGPU preferred) | Q4_K_M | llama.cpp WASM | ≤35 MB | ≤1000ms (p50) | ≥3 tok/s (warm) | ≤512 MB heap |
| **Android** | ARM64 (Pixel 7 class) | Q4_K_M | llama.cpp Android | ≤35 MB | ≤800ms (p50) | ≥5 tok/s (warm) | ≤512 MB RSS |

## CI Microbenchmark Gate (every release)

### Test Protocol (mandatory)
```bash
# 1. Warmup: 10 runs (discard)
# 2. Measure: 50 runs, report median + p95 + p99
# 3. Sustained: 5 min continuous load, report thermal throttling delta
# 4. Memory: RSS tracked throughout, report peak + steady-state
```

### Gates (all must PASS)
| Metric | Primary (GTX 1060) | CPU | WASM | Android |
|--------|-------------------|-----|------|---------|
| Model file size | ≤35 MB | ≤35 MB | ≤35 MB | ≤35 MB |
| First-token latency (p50) | ≤200ms | ≤500ms | ≤1000ms | ≤800ms |
| First-token latency (p99) | ≤500ms | ≤1500ms | ≤3000ms | ≤2500ms |
| Steady-state tok/s (warm, median) | ≥20 | ≥8 | ≥3 | ≥5 |
| Steady-state tok/s (p99) | ≥15 | ≥5 | ≥2 | ≥3 |
| Peak RSS | ≤2 GB | ≤1.5 GB | ≤512 MB | ≤512 MB |
| Steady-state RSS | ≤1.5 GB | ≤1 GB | ≤400 MB | ≤400 MB |
| Thermal throttle delta (5 min) | ≤10% tok/s drop | ≤15% | ≤20% | ≤20% |

### Measurement Tools
```bash
# GTX 1060 / CPU (llama-bench)
./llama-bench -m model_q4_k_m.gguf -p 512 -n 128 -ngl 99 -t 12 --warmup 10 --runs 50

# Sustained load (custom script)
python sustained_bench.py --model model_q4_k_m.gguf --duration 300 --concurrent 1

# WASM (Node.js + llama.cpp WASM)
node bench_wasm.js --model model_q4_k_m.wasm --runs 50

# Android (adb + llama.cpp Android)
adb shell /data/local/tmp/llama-bench -m /data/local/tmp/model_q4_k_m.gguf ...
```

## Quantization Artifacts (required for release)
| Artifact | Format | Size | Use |
|----------|--------|------|-----|
| trek150_q8_0.gguf | GGUF Q8_0 | ~32 MB | Primary IDE (near-lossless) |
| trek150_q4_k_m.gguf | GGUF Q4_K_M | ~29 MB | All edge targets |
| trek150_q5_k_m.gguf | GGUF Q5_K_M | ~33 MB | Reasoning-critical fallback |
| trek150_q4_k_m.wasm | WASM (quantized) | ~29 MB | Browser |
| trek150_q4_k_m.android | Android AAR | ~32 MB | Android |

## Thermal / Sustained Load Test (5-minute protocol)
```python
# sustained_bench.py
import time, psutil, subprocess, statistics

def sustained_bench(model_path, duration=300, concurrent=1):
    process = subprocess.Popen([
        "llama-server", "-m", model_path, "-ngl", "0", "--port", "8081"
    ])
    time.sleep(10)  # server startup
    
    latencies = []
    tok_counts = []
    rss_samples = []
    start = time.time()
    
    while time.time() - start < duration:
        # Send request, measure latency + tokens
        t0 = time.time()
        resp = requests.post("http://127.0.0.1:8081/v1/completions", 
            json={"prompt": "test", "max_tokens": 128, "temperature": 0})
        t1 = time.time()
        latencies.append(t1 - t0)
        tok_counts.append(resp.json()["usage"]["completion_tokens"])
        rss_samples.append(psutil.Process(process.pid).memory_info().rss)
        time.sleep(0.1)  # 10 req/s sustained
    
    process.terminate()
    
    # Report
    warm_latencies = latencies[100:]  # discard first 10s
    return {
        "first_token_p50": statistics.median(latencies[:10]),
        "first_token_p99": statistics.quantiles(latencies[:10], n=100)[98],
        "steady_tok_s_p50": statistics.median(tok_counts) / 0.1,
        "steady_tok_s_p99": statistics.quantiles(tok_counts, n=100)[98],
        "peak_rss_mb": max(rss_samples) / 1e6,
        "steady_rss_mb": statistics.median(rss_samples[100:]) / 1e6,
        "thermal_drop_pct": (statistics.median(tok_counts[:100]) - statistics.median(tok_counts[-100:])) / statistics.median(tok_counts[:100]) * 100
    }
```

## Release Pipeline (GitHub Actions / Local CI)

### Stage 1: Quantize & Hash
```yaml
- name: Quantize
  run: |
    llama-quantize.exe trek150_fp32.gguf trek150_q8_0.gguf Q8_0
    llama-quantize.exe trek150_fp32.gguf trek150_q4_k_m.gguf Q4_K_M
    sha256sum trek150_q8_0.gguf trek150_q4_k_m.gguf > artifacts.sha256
```

### Stage 2: Parity Probes (Phase 10)
```yaml
- name: Train/Serve Parity
  run: python serve_verify.py --server http://127.0.0.1:8081 --gguf-sha $(cat artifacts.sha256 | grep q8_0 | cut -d' ' -f1)
```

### Stage 3: Gate Matrix Re-run (Phase 9)
```yaml
- name: Gate Re-run on Served
  run: python gate_matrix.py --server http://127.0.0.1:8081 --epoch-hash $(cat gate_manifest.json | jq -r .epoch_hash)
```

### Stage 4: Edge CI Benchmarks
```yaml
- name: GTX 1060 Benchmark
  run: python ci_bench.py --target gtx1060 --model trek150_q4_k_m.gguf --gate thresholds.gtx1060.json

- name: CPU Benchmark
  run: python ci_bench.py --target cpu --model trek150_q4_k_m.gguf --gate thresholds.cpu.json
```

### Stage 5: WASM/Android Build (if changed)
```yaml
- name: Build WASM
  if: github.event_name == 'release'
  run: docker run --rm -v $(pwd):/src emscripten/emsdk bash build_wasm.sh

- name: Build Android AAR
  if: github.event_name == 'release'
  run: ./gradlew assembleRelease -Pmodel=trek150_q4_k_m.gguf
```

## Model Card (honest metrics, per production-readiness)
```markdown
# FSI-FELON Trek 150M
- Architecture: Novel dual-mind (TTAM, HSE, PDPC, EVG, TAS, MTP)
- Params: 139.7M | FP32: 64.5 MB | Q4_K_M: 29 MB | Q8_0: 32 MB
- Training: 3B tokens, textbook-quality corpus, curriculum learning
- Post-training: SFT (5e-5) → SOD distill → DPO (5e-7) → closed-loop
- Eval (held-out): format 0.98, chat 0.87, coherence 0.82, py_parse 0.81, solve-rate 0.79
- Speed: 22 tok/s (GTX 1060 Q4_K_M warm), 9 tok/s (CPU Q4_K_M warm)
- Memory: 1.2 GB RSS (GTX 1060), 800 MB RSS (CPU)
- License: [USER DECISION: CC BY-SA or proprietary]
```

## Expected Bugs / Issues
- **Single-shot benchmark reported as sustained** — CI must run 5-min sustained, report thermal delta
- **Cold-start latency included in steady-state** — Discard first 10s / 100 requests
- **RSS measured incorrectly** — Use `psutil.Process(pid).memory_info().rss` not container stats
- **WASM/Android build drift** — Build in pinned Docker images; test on real devices
- **Quantization regression on code gate** — Phase-9 G-Format re-run on Q4_K_M MANDATORY

## Dependencies
- Phase 10: gguf-quantization-deployment (quant artifacts + parity)
- Phase 9: pipeline-phase-9-eval-gates (gate matrix re-run)
- llama.cpp pinned revision (for reproducible quantization + benchmarks)
- CI runners: GTX 1060 machine, CPU machine, WASM build env, Android build env

## Threat Matrix
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Thermal throttling hides on short runs | HIGH | HIGH | 5-min sustained mandatory; report delta |
| WASM/Android binary drift | MEDIUM | HIGH | Pinned Docker builds; real-device test on release |
| Quantization drops code gate | MEDIUM (observed) | CRITICAL | G-Format re-run on Q4_K_M; never ship without |
| CI runner hardware drift | MEDIUM | MEDIUM | Pin runner specs; calibrate monthly |
| Memory leak in sustained test | LOW | HIGH | Monitor RSS trend; fail if monotonic increase |

## When Done
Mark edge deployment CI complete in AGENT_NOTES with: all artifact hashes, CI benchmark results per target (median/p95/p99 + thermal delta), gate matrix scores on served Q4_K_M, and model card.