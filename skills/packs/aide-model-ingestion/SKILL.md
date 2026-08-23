# Skill: aide-model-ingestion

# AIDE — Model Ingestion: load ANY GGUF, auto-fit to the device (arch Phase 6)

## Doctrine

- Any user-supplied GGUF file must be loadable offline, and AIDE must auto-select the largest settings the user's device can actually handle — never crash the machine, never guess. Every decision comes from measured hardware + parsed GGUF metadata + the memory math below.
- GGUF metadata is the ONLY trusted source of truth about a file: `general.architecture`, `<arch>.context_length`, `tokenizer.chat_template`, `general.file_type`, tensor counts. Do NOT trust the filename alone, and do NOT trust `general.file_type` for S/M/L sub-variants (see threat matrix).
- Offline-first (R4): ingestion works with zero network. Downloads (HF) are an optional online flow routed through the egress allowlist.
- The existing runtime is llama-cpp-python 0.3.34 (CPU-only on this machine; Settings supports: `model`, `model_alias`, `n_ctx`, `n_gpu_layers`, `chat_format`, `n_threads`, `logits_all`, `cache`, `use_mmap`, `use_mlock`, `tensor_split`, `main_gpu`, `rope_scaling_type`, `host`, `port`, `verbose` — verified from `E:\Python310\Lib\site-packages\llama_cpp\server\settings.py`). NO `keep_alive`/`warmup` fields exist in 0.3.34.

## What to do / code

1. **GGUF header probe (daemon, `node/src/services/gguf.ts`)** — parse the first ~1 MB, read KV metadata:
   - magic `GGUF`, version (accept v2/v3; v1 must be REJECTED with a clear message — gguf.cpp: "GGUFv1 is no longer supported"), kv count, per-key values.
   - Extract: `general.name`, `general.architecture`, `general.size_label`, `general.file_type`, `general.license`, `general.quantization_version`, `<arch>.context_length`, `<arch>.block_count`, `<arch>.embedding_length`, `<arch>.attention.head_count[_kv]`, `tokenizer.chat_template` (full string), `tokenizer.ggml.{bos_token_id,eos_token_id,add_bos_token}`.
   - Gate: architecture must be in the allowlist (llama, qwen2 first; others explicitly rejected with "unsupported architecture X").
2. **Hardware probe (daemon)** — Windows: RAM via `GlobalMemoryStatusEx` (kernel32 `MEMORYSTATUSEX.ullTotalPhys/ullAvailPhys`); VRAM via `IDXGIAdapter3::QueryVideoMemoryInfo` (free) with `IDXGIAdapter::GetDesc` totals as fallback; CPU logical cores. Cache the result for 30s (probes are cheap but not free).
3. **Fit decision matrix (pure function, unit-tested)**:
   - KV cache bytes = `2 * block_count * head_count_kv * head_dim * numCtx * 2` where `head_dim = embedding_length / head_count` (f16 K+V; verified formula from Ollama `PredictServerVRAM` + llama-kv-cache.cpp).
   - Required RAM ≈ `fileSize + kvBytes(ctx) + 1024 MiB buffer margin` (llama.cpp log pattern: `mem required = 7024.01 MB (+ 400.00 MB per state)` + compute buffer).
   - Rule: required ≤ `0.8 × free RAM` → pick that ctx, else shrink ctx by halving (32768 → 16384 → 8192 → 4096; floor 2048) and re-test; if it still does not fit, fail with an honest "needs X GiB free" message (Ollama does the same ctx-tier reduction on OOM — verified in `server/sched.go`).
   - GPU offload default: `n_gpu_layers = 0` (CPU-only) on this machine — Pascal GTX 1060 compute 6.1 is supported by CUDA builds but no primary source proves it beats 12 CPU threads at small-batch token generation; treat offload as a manual toggle until `llama-bench` is run locally.
4. **Quant/context recommendations** (shown to the user, auto-applied on "Auto"): prefer the largest quant that fits the free-RAM budget from Q4_K_M → Q5_K_M → Q6_K → Q8_0 (TheBloke guidance: Q4_K_M "balanced quality — recommended"; Q8_0 rarely worth the RAM). Derive the actual quant from the **filename encoding suffix** (GGUF naming convention: `<BaseName><SizeLabel><FineTune><Version><Encoding><Type>.gguf`) AND `general.file_type` coarse family — never assume S/M/L from file_type (contradiction: spec doc vs ggml.h enum).
5. **Serving**: spawn `py -3.10 -E -m llama_cpp.server --model <file> --model_alias <id> --n_ctx <decided> --n_gpu_layers 0 --logits_all false --host 127.0.0.1 --port <free>` — poll `GET /v1/models` until ready (existing ModelManager pattern). Pass `--chat_format` ONLY when the GGUF lacks `tokenizer.chat_template` (llama-cpp-python 0.3.34 auto-loads the GGUF template via jinja2, then silently falls back to `llama-2` when absent — the silent fallback is the gibberish source; surface it).
6. **Register into `models/manifest.json`** (source of truth, R5): new entry with id, name, endpoint, model string (alias), context_tokens (decided, NOT the GGUF max), quant, sha256, status: `verified` only after the smoke test below. Never mutate bundled entries.
7. **Validation pipeline before "ready"**: sha256 match (if the file came with a manifest/hash — GGUF has NO embedded checksum) → header parse → smoke: one fixed prompt, assert non-empty response + no repeated-token blowup → status `ready`.
8. **UX**: ingest flow = pick file → probe → show "Device fit: model 1.1 GB + KV 229 MB at 8192 ctx = OK in 16 GB (Auto selected Q4_K_M @ 8192)" → import → smoke → usable. Failure paths show the exact number, never a silent disabled model.

## Why it's done this way

- GGUF spec (https://github.com/ggml-org/ggml/blob/master/docs/gguf.md): KV metadata + naming convention are normative; `<arch>.context_length` is "the hard limit on the length of the input".
- Memory math: Ollama source `PredictServerVRAM` (https://github.com/ollama/ollama/blob/main/llm/llama_server.go) computes exactly `weights + 2*layers*kvHeads*headDim*ctx*2`; llama.cpp log pattern adds compute buffers (~75-100 MB); Ollama FAQ confirms RAM scales linearly with `NUM_PARALLEL * CONTEXT_LENGTH`. Ollama's ctx-tier reduction on OOM (sched.go) is the proven rescue pattern.
- Quant ladder: TheBloke model cards (e.g. https://huggingface.co/TheBloke/Llama-2-13B-chat-GGUF) + HF GGUF docs (https://huggingface.co/docs/hub/en/gguf, bits-per-weight table); llama-server's `--hf-repo` default quant = Q4_K_M (official default).
- Hardware APIs: GlobalMemoryStatusEx (https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-globalmemorystatusex), DXGI desc/QueryVideoMemoryInfo (https://learn.microsoft.com/en-us/windows/win32/api/dxgi/ns-dxgi-dxgi_adapter_desc); Ollama uses exactly these on Windows (discover/cpu_windows.go, NVML for NVIDIA free VRAM).
- Chat template: llama-cpp-python 0.3.34 resolves chat_format → GGUF metadata template (jinja2) → silent llama-2 fallback (verified from llama.py/llama_chat_format.py source); the fallback is the classic gibberish cause (AIDE research base #5).
- Validation: Ollama imports content-addressed by sha256 layer digests and reads metadata first (`llm.LoadModel(path, 1024)`) before spawning — port that order.

## Dependencies

- Node 20+ daemon; existing ModelManager + `start_model_servers.ps1` conventions (sequential starts — RAM burst fix from Phase 1); zod contracts; egress guard (optional HF downloads); `models/manifest.json` schema v1.1 (bundled entries frozen; ingested models appended).
- Python env: `py -3.10 -E` with llama_cpp 0.3.34 + jinja2 (hard dep for template rendering — verify presence in the packaged env).
- Port allocation: a free-port picker in the daemon (existing ports 8082/8083/8087 are contract-frozen, R5).

## Threat matrix

| Threat | Detail | Symptom if violated | Mitigation |
|---|---|---|---|
| GGUF v1 files | gguf.cpp rejects v1 ("no longer supported") | load crash | reject at probe with clear message |
| file_type S/M/L mismatch | spec doc lists Q4_K_S=14/Q4_K_M=15; ggml.h enum has family-only values (12=Q4_K) | wrong quant label shown to user | read filename encoding suffix; treat file_type as coarse family |
| Silent llama-2 chat fallback | GGUF without tokenizer.chat_template → llama-cpp-python falls back silently | gibberish / never-ending output | probe template presence; pass explicit chat_format or warn |
| KV cache underestimate | forgetting K+V × 2 or head_dim division (GQA!) | OOM mid-inference, pagefile thrash | use the Ollama formula verbatim + 1 GiB buffer margin |
| Parallel requests multiply ctx | 2 parallel slots = 2× KV allocation (Ollama FAQ) | OOM under chat load | single-slot serving for ingested models; document |
| Free RAM vs total RAM | sizing against ullTotalPhys while other apps run | pagefile thrash on 16 GB machine | use avail RAM × 0.8; re-probe at start time |
| GPU offload on Pascal | no evidence 1060 beats 12 CPU threads; F16 compute emulated at ~1/64 rate | slower, VRAM pressure, confusing UX | default n_gpu_layers=0; benchmark gate (llama-bench) before enabling |
| Truncated/corrupt downloads | GGUF has no embedded checksum | crash or garbage output | sha256 manifest compare + magic/version probe + smoke prompt |
| Path/containment | ingested model path from browser | arbitrary file read | daemon-only file pick, containment per Phase 1 rule |
| Port collisions | fixed-port assumption | server fails to bind | free-port picker; manifest stores the real endpoint |
| n_ctx 0 trap | llama-cpp-python default n_ctx=2048 ignores GGUF max | users think model is broken (bad long-context answers) | always pass explicit n_ctx from the fit decision |

## Local verification gates (before claiming the phase)

1. `llama-bench` (or a timed smoke) on the 3 bundled models → real tok/s on this machine (bandwidth model predicts 0.5B≈60-120 t/s, 1.5B≈25-50 t/s CPU — UNVERIFIED, must measure).
2. KV formula against a live server log line (qwen 1.5B: 28 layers × 2 kv-heads × 128 head_dim → 28 KB/token → ~229 MB at 8192 ctx).
3. `tokenizer.chat_template` present in all 3 bundled GGUFs (parsed this session: smollm ✔, qwen ✔ — verify 0.5B too).
4. jinja2 present in E:\Python310 (hard dep).
5. nvidia-smi driver 582.28 ≥ 570 — GTX 1060 tier supported per Ollama GPU docs (verified; only matters if CUDA build is ever adopted).
6. llama-cpp-python 0.3.34 `/v1/models` in multi-model mode: confirm it lists all aliases (app.py suggests yes — verify with curl).
