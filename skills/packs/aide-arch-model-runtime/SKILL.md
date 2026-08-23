---
name: aide-arch-model-runtime
description: Phase 6 SOP for the AIDE offline-first IDE rebuild — the local model runtime + chat: port the VERIFIED model-manager (python discovery chain, llama_cpp.server spawn with --logits_all false, identity check, warmup gate, RAM doctrine, port doctrine 8081→8087), typed chat contract with SSE token streaming, model status via WS, offline-first (local llama.cpp only; online providers strictly opt-in). Use whenever wiring model start/stop/status/chat, debugging "model won't start", "first chat fails", "MapViewOfFile failed", or port conflicts. Research-grounded in the verified facts of 2026-08-16 (this machine, this project) plus llama.cpp docs.
---

# AIDE Architecture — Phase 6: Model Runtime + Chat

## Doctrine

- **Local-first, always.** The 3 bundled GGUF models (smollm2, qwen-0.5b, qwen-1.5b) serve on localhost via llama_cpp.server. Chat never leaves the machine. Online providers (if ever added) are a SEPARATE opt-in adapter behind the same chat contract, defaulting to off.
- **Verified facts are law.** The Phase 6 code that survived live verification (python discovery chain, logits_all false, identity check, warmup gate, RAM doctrine, port doctrine) is PORTED, not redesigned. New work extends the contract layer and streaming; it does not touch verified behavior.
- Verify before claiming: every model start → status → chat round-trip verified live end-to-end (as done 2026-08-16) before the phase is done.

## What

Phase 6 turns the verified model-manager.mjs into a first-class contract service:

- **Model service** (`node/src/services/models.ts`): registry of models (id, path, port, status), start/stop/status, warmup gate, RAM guard, port allocation, python discovery — all verified logic ported from `daemon/model-manager.mjs`.
- **Chat contract** (`common/contracts/chat.ts`): `ChatRequest { modelId, messages, options? }` → `ChatResponse { text, modelId, tokens?, timing? }`; streaming variant via SSE: `GET /api/chat/stream` → `data:` lines of `{ delta }` + final `{ done }` event.
- **Status channel**: WS `model:status` events (starting/warming/ready/error/stopped) — the RUN view and status bar subscribe (Phase 4 channel).
- **Guard rails**: RAM check before spawn (doctrine: <2GB free → refuse with NOT_READY + message); port conflict doctrine (foreign squat → next free port, logged loudly); daemon shutdown stops all model children (tree kill — verified: daemon restart takes llama servers down; that's correct lifecycle, and orphans must be hunted by command line if a hard kill ever happens).
- **Chat UX**: chat panel (EXP view) with model picker, message list, streaming render, stop button (aborts the SSE stream + cancels generation), history persisted per workspace (replay-store ported).

## How

### 1. Python discovery chain (VERIFIED 2026-08-16 — do not reorder)

`AIDE_PYTHON` env → `py -3.10 -E` → `py -3 -E` → `E:\Python310\python.exe -E`. Never bare `python` (MS Store stub). `-E` strips the broken global `PYTHONPATH=E:\python_packages` (cp313-only) that breaks imports under other pythons. Verify by running the probe (`python -c "import llama_cpp; print(llama_cpp.__version__)"`) and checking llama_cpp 0.3.34 imports.

### 2. Server spawn (VERIFIED flags)

- Command: `<python> -m llama_cpp.server --model <path> --host 127.0.0.1 --port <port> --n_ctx 2048 --logits_all false` (adjust n_ctx per model RAM budget). `--logits_all false` is MANDATORY (all-token logits blow Pascal GPU memory).
- Identity check: after bind, GET `/v1/models` and verify the served model alias matches the expected id BEFORE declaring ready (verified: server binds + answers /v1/models before generation context is fully loaded — this is why status and first-chat race).

### 3. Warmup gate (VERIFIED fix for the first-chat race)

- `warmed` Set + `warmup(id)`: 1-token generation, 3 attempts × 10s. `isReady(id)` returns true only when warmed; `waitReady(id)` awaits it. Chat route rejects with NOT_READY ("Model still warming up…") until warmed — the translated-error UX (Phase 2) shows this instead of a raw fetch failure.
- Port this code verbatim; it was shipped in commit 9ce9666 and is the known-good fix.

### 4. RAM doctrine (VERIFIED)

- Before spawn: read free memory (daemon `os.freemem` or `Get-CimInstance Win32_OperatingSystem` — use node's `os.freemem()` consistently). <2GB free → refuse with `NOT_READY` + message "Not enough free RAM (model needs X)". Symptom it prevents: `MapViewOfFile failed` crashes.
- Expose freeMemoryMB in `/api/health` (Phase 1 already did) and show it in the status bar — the user's own training jobs (fsi-anomaly) also consume RAM; the UI must make contention visible, not mysterious.

### 5. Port doctrine (VERIFIED 2026-08-16)

- Fixed per-model ports: smollm2=8082, qwen-0.5b=8083, qwen-1.5b=8087 (re-ported FROM 8081 after a foreign llama-server squatted it and ColonyWatchdog respawned swarm processes). The model manager checks the port before use: if occupied by OUR model (identity matches) → reuse (idempotent start); if occupied by a FOREIGN process → pick next free port and log loudly; if free → bind.
- Never silently squat; never crash on EADDRINUSE without the log.

### 6. Chat streaming (new contract work)

- SSE over the daemon (event channel schema in common/contracts/events.ts): `GET /api/chat/stream?modelId=&prompt=` → `data: {"delta":"..."}` lines → `data: {"done":true,"modelId":"..."}` → close. Abort = client closes the fetch → daemon cancels generation (stop the llama request; the server keeps running).
- Non-stream fallback: POST /api/chat (verified end-to-end path) stays for tests and simple clients.
- Streaming must pass the SAME zod validation: each SSE `data:` payload is validated against the event schema before being handed to the UI (fail closed).

### 7. Provider abstraction (future, opt-in only)

- Interface `ChatProvider { id, isAvailable(), stream(req, onDelta): Promise<void> }` with exactly two implementations now: local llama (default) and NONE. An online provider (e.g. OpenAI-compatible remote) is added ONLY behind `config.onlineFeatures.<providerId> === true` with a UI toggle labeled as online/opt-in. The chat contract does not change.

## Why (research grounding)

- Verified project facts (2026-08-16): the discovery chain, logits_all false, identity check, warmup gate (3×10s), RAM killer, port doctrine, and the end-to-end chat evidence (smollm2/qwen-0.5b/qwen-1.5b all answered through the daemon) — these are the machine's measured reality; changing them without re-measuring is how this project has lost hours.
- llama.cpp docs: logits_all=false is the standard chat setting; server binds before full context load (the observed race).
- VS Code/privileged-host doctrine: the daemon owns the model processes; the browser only sees typed status/chat contracts.

## Dependencies

Python 3.10 + llama_cpp 0.3.34 (verified import under `py -3.10 -E`), 3 GGUF models in models/ (paths in config), Phase 1 process manager (spawn + tree kill + timeout), Phase 4 WS channel + SSE, Phase 2 api client + error translation.

## Known issues / bugs (watch these)

- **First-chat race**: status says running but generation context not loaded → first chat fails. The warmup gate is the fix — if a chat still fails on the FIRST attempt after status=running, the gate is broken; re-verify the ported code.
- **Port squatting**: ColonyWatchdog (scheduled task) and foreign llama-servers grab ports. The port doctrine's "check identity, else next free port + loud log" handles it; a static port list does NOT.
- **RAM contention**: user's training jobs (fsi-anomaly) eat RAM/GPU. The RAM guard refuses starts; the UI must show free RAM so contention is visible, not mysterious.
- **Orphaned daemon chains**: a daemon killed with -Force leaves llama children (tree kill didn't run). Hunt by command line (`python -m llama_cpp.server`) after hard kills; prefer graceful shutdown ALWAYS.
- **logits_all true creep**: someone adding `--logits_all true` for perplexity runs is fine on small models but OOMs Pascal — keep it a per-invocation override, never the server default.
- **SSE vs WS**: chat streaming is a single long-lived stream → SSE (simple, abortable). Model status is multi-channel state → WS. Don't mix them.
- **Backpressure on stream**: llama can emit fast; pipe through with async iteration + backpressure (await write drain) or the daemon buffers unboundedly during slow UI.
- **Model swap**: replacing a GGUF file while a server runs (user's own updates) — detect mtime/size change on start and refuse with CONFLICT until the old server stops (or you serve a half-written file).
- **Unknown-element template tags (verified 2026-08-20)**: the chat panel's model picker was written `<modelSelect id="chat-model">` — NOT `<select>`. Browsers create an `HTMLUnknownElement` (tagName `MODELSELECT`) with NO `.value`/`.options`; the send() guard `modelSelect.value.length` throws TypeError, the click handler dies SILENTLY (unhandled rejection), no request leaves the browser (daemon log shows no `/api/chat/stream`), and no toast appears. Symptom: chat send does nothing, `#status-right` stays empty, e2e asserts time out. Rules: (1) template tags must be real elements — verify with `page.evaluate(() => document.getElementById('chat-model').tagName)` when debugging "UI did nothing"; (2) e2e chat tests must attach a `page.on('pageerror')` collector and assert it empty at the end — a silent page error is a test failure, never a pass.
- **Toast labels swallow detail (verified 2026-08-20)**: `translateError` maps known codes to fixed labels (`INTERNAL` → 'Daemon error'), hiding the daemon's specific message. For INTERNAL/CHILD_FAILED with a non-empty message, append the detail (`Daemon error: model: start this model before chatting`) so the honest reason surfaces; other known codes keep their fixed label.

## Phase 6 audit checklist (applied to the existing model code)

1. model-manager.mjs ported into services/models.ts with: discovery chain, logits_all false, identity check, warmup gate, RAM guard, port doctrine — ported verbatim where verified.
2. Contracts chat.ts (request/response/stream events) in common/; both daemon and browser tests use the same fixtures; SSE payloads validated.
3. Live verification (when the user's fsi-anomaly job is NOT running): start each model → status=ready (warmed) → streaming chat round-trip → stop → daemon restart kills children (verify by PID scan).
4. RAM guard + health freeMemory visible in UI; status bar shows model state via WS.
5. Stop button aborts SSE stream and cancels generation without killing the model server.
6. `npm run check` green.
## Large-GGUF memory expansion policy (DECIDED 2026-08-22, collaborator research handoff)

DECISION: AIDE does NOT build custom virtual RAM / disk-streaming. The ladder is: (1) llama.cpp native mmap is ALREADY the disk-expansion mechanism - on Windows CreateFileMappingA, on Linux mmap; OS pages hot layers in, cold stay on disk; works today for models somewhat larger than RAM at a speed penalty. AIDE only surfaces flags + expectations. (2) Swap/pagefile = documented ESCAPE HATCH for batch jobs, never a first-class interactive workflow (~1-3 t/s class, thrashing risk, SSD wear). (3) Layer offloading / partial loading stays on the RESEARCH roadmap; watch llama.cpp upstream before integrating. (4) Custom madvise + hugepages + async prefetch = out of scope (power-user territory, hardware-specific).

WHAT AIDE ACTUALLY SHIPS for this: a PREDICTION/GUIDANCE layer, not memory engineering. Before start(): estimate feasibility from model size + quant + free RAM + KV need (model-fit.ts exists) and ADD tok/s estimation + disk-class awareness so the UI can say "7B Q4 ~20 t/s locally / 70B-with-swap ~0.5 t/s unusable interactively / hand off to cloud provider instead". Warn-before-load beats fail-after-OOM.

DATA PROVENANCE RULE: the collaborator numbers (2-3 t/s swap anecdote, 671B DeepSeek-R1 40-70 wpm MoE case, Strix Halo 70B/24GB) are SECONDHAND until re-sourced. Before implementing any UI copy or thresholds that quote numbers, verify against primary sources (llama.cpp docs/README mmap section, the cited threads) per verify-first-discipline. The DECISION itself is adopted now; the NUMBERS are not yet citable.

Threats: promising "runs bigger models" then shipping 0.5 t/s UX = trust damage - always show predicted t/s BEFORE load; mmap on low-RAM machines can still OOM during prompt eval (KV cache is not mmap'd); --no-mmap changes nothing about capacity, only paging behavior - do not present it as an expansion feature.
