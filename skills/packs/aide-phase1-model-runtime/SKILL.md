---
name: aide-phase1-model-runtime
description: Phase 1 SOP for the AIDE offline IDE — make the 3 bundled GGUF models serve text via llama-cpp-python OpenAI-compatible endpoints and wire the daemon chat API + frontend controls. Use whenever starting/verifying model servers, implementing /api/chat or /api/model/start, or debugging "model won't start / chat returns nothing" on this machine.
---

# Phase 1 — Model Runtime SOP

Goal: `python -m llama_cpp.server` serving the 3 GGUF models on 127.0.0.1, verified via `/v1/models`, consumed by the daemon at 4777 and the UI at 4173.

## The model contract (manifest.json is truth)

| Model ID | File | Port | n_ctx | Lane |
|---|---|---|---|---|
| qwen-coder-1.5b-q4 | qwen2.5-coder-1.5b-instruct-q4_k_m.gguf | 8087 | 4096 | build |
| smollm2-360m-q8 | smollm2-360m-instruct-q8_0.gguf | 8082 | 2048 | research |
| qwen-coder-0.5b-q4 | qwen2.5-coder-0.5b-instruct-q4_k_m.gguf | 8083 | 4096 | fast |

Files at `E:\aide-sovereign-workbench\models\`. **GTX 1060 6GB: `-n_gpu_layers 0` (CPU inference only).**

## This machine's Python reality (verified 2026-08-13)

- `python` on PATH is the Microsoft Store stub (fails). `pip` resolves to `E:\python_packages` (python 3.13). `py -0p` lists: 3.13 Store (`WindowsApps\PythonSoftwareFoundation.Python.3.13_...`), 3.11 (`C:\Python311` — python.exe MISSING), 3.10 (`E:\Python310` — works, lacks jinja2).
- llama-cpp-python 0.3.34 exists at `E:\python_packages`, but import FAILED on 3.13 (`DLL load failed ... _multiarray_umath` = missing VC++ redistributable) and on 3.10 (`No module named jinja2.ext`).
- **Before writing any server script: verify which interpreter can actually import llama_cpp**: `py -3.10 -c "import llama_cpp; print(llama_cpp.__version__)"` (and fix the environment: install jinja2 for 3.10, or install the VC++ redistributable for 3.13). A script that calls a broken interpreter prints FAILED — that is the honest result. Do not claim READY on unverified imports.

## SOP 1 — start_model_servers.ps1

1. Resolve interpreter: prefer the exact one verified to import llama_cpp (try candidates in order; abort with clear error if none works).
2. Spawn 3 background jobs: `& $interp -m llama_cpp.server --model "<gguf>" --host 127.0.0.1 --port <port> --n_ctx <ctx> --n_gpu_layers 0` (PowerShell `Start-Job` or `Start-Process -WindowStyle Hidden` with `-RedirectStandardOutput/Error` to log files).
3. Wait ~10s (CPU model load is slow), then `Invoke-RestMethod http://127.0.0.1:<port>/v1/models` (no curl on this machine).
4. Print `SERVER <port> READY` or `SERVER <port> FAILED` (quote the error/log tail on failure).
5. Wait for Enter keypress, then kill all spawned processes/jobs.
6. On this shell: background jobs do NOT persist across sessions — the user launches this script from their own terminal.

## SOP 2 — daemon integration (daemon/server.mjs)

- `POST /api/chat` (exists at server.mjs:244) must accept `{model, messages, temperature?}` and proxy to `http://127.0.0.1:<port>/v1/chat/completions` with the model's manifest port. Parse OpenAI response `{choices:[{message:{content}}]}`.
- `POST /api/model/start` → `{id}` resolves manifest → spawn the llama_cpp.server process (or verify the port if a manager already serves it); poll `status()` until `running`; keep the manifest's `endpoint` in sync.
- Error contract (user-verified acceptance): missing `.gguf` → 503 with exact error; process crash → 500 with stderr tail.
- Log every generation: `INFERENCE: model=[name] prompt_tokens=[N]` (use response `usage`).
- CORS: daemon responses must allow origin `http://127.0.0.1:4173`.

## SOP 3 — frontend wiring (Desktop/frontend/app.js)

- On load: `GET /api/models` → populate `#model-select`; console.log the result.
- `#send-button` click: read `#input` + selected model → `POST http://127.0.0.1:4777/api/chat` `{model, messages:[{role:"user",content}]}` → append `<div class="chat-user">` (user) and `<div class="chat-assistant">` (response); error → `<div class="chat-error">Error: [message]</div>`; clear `#input`; console.log every step.
- START MODEL button: `POST /api/model/start {id}` → poll `/api/model/status` until `running` → UI state "Model Running".
- Guard against double-firing: `#send-button` ALREADY has `onclick = sendChat` (app.js:864) — replace/reuse that binding, never add a second listener that double-posts.

## Acceptance gates (all must be observed, quoted in AGENT_NOTES)

- `SERVER 8087/8082/8083 READY` from the script (qwen-1.5b re-ported to 8087 on 2026-08-16: port 8081 was squatted by a foreign llama-server).
- `curl`-equivalent POST to `/api/chat` returns generated text in <30s per model (smollm2 360M, qwen 0.5B, qwen 1.5B — test sequentially, "Say hello").
- DevTools console shows the logged fetch/response on SEND click.
- CORS: no console error on the 4173→4777 fetch.

## VERIFIED FACTS (2026-08-16, all observed on this machine)

1. **Python discovery chain (daemon `probePython()`):** `AIDE_PYTHON` env → `py -3.10 -E` → `py -3 -E` → absolute `E:\Python310\python.exe -E`. Lazy re-probe every 5s when not ready; `start()` re-probes before failing. Verified under a hostile PATH (no `py` at all) → still `runtime_available=true`. Never plain `python` (MS Store stub); never `PYTHONPATH=E:\python_packages` (cp313-only, broken) — `-E` strips it.
2. **`--logits_all false` is REQUIRED** on every llama_cpp.server spawn: default True allocates a 2.32 GiB scores buffer per 4096-ctx model → OOM on this machine. Non-negotiable.
3. **Identity check before declaring running:** daemon verifies `GET /v1/models` on the endpoint matches OUR model id/alias before `running`. A foreign server squatting the port (seen live: `qwen35` from another project's `llama-server.exe` on 8081) is reported as a CONFLICT, never trusted. Pass `--alias <name>` when spawning so the id is deterministic.
4. **Port conflict doctrine:** if another project owns a manifest port, RE-PORT AIDE (8081→8087 done) rather than fight. Other projects' llama-server swarms can be crash-looping (scheduled task `ColonyWatchdog` respawns 20×); stop the TASK, not just the processes.
5. **RAM is the load-killer:** with <~2GB free RAM, model loads fail (`MapViewOfFile failed: Not enough memory resources`). Check `FreePhysicalMemory` before starting a model; keep `n_ctx` minimal; CPU inference ~8-80 t/s; first request = load latency 10-25s (generous timeouts, honest UI state).
6. **Real chat verified:** smollm2 on 8082 via daemon `/api/chat` returned HTTP 200 `"OK."`; qwen-1.5b logs show real inference (prompt eval ~78 tps, ~7.7 t/s generation) on 8081-before-re-port.
7. **Frontend chat uses raw `/api/chat`** with `{modelId, messages, max_tokens, timeout_ms}` (app.js:728); `/api/operator` remains for heavy contextual workflows.