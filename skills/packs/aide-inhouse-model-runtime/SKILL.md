# Skill: aide-inhouse-model-runtime

# AIDE In-House Model Runtime & Server Launcher SOP

## Objective
Provide a deterministic, research-backed Standard Operating Procedure for running in-house GGUF models (starting with `aide-cipher-4b` / Cipher v1) on Windows GTX 1060 using the `llama-server` binary runtime.

---

## 0. Authoritative Launch Flags (VERIFIED 2026-08-27 — read this first)

These are the load-bearing facts, each proven by A/B on this exact machine (VMware-SVGA / Pascal GTX 1060 / WDDM). Do NOT re-litigate them.

| Flag | Verdict | Why |
|---|---|---|
| `--no-mmap` | **FORBIDDEN. NEVER add it.** Law comment in `model-manager.mjs:505-509`. | In this VMware-SVGA/Pascal-WDDM env the monolithic private-memory read+upload path of `--no-mmap` **wedges at heavy-init or dies with `0xFFFFFFFF` and zero stderr**. Default mmap streams pages lazily and survives. A/B proof: identical args EXCEPT dropping `--no-mmap` → **model loaded + HTTP bound in 1m12s** with full `-ngl 999` Vulkan + frontier-lora attached, direct completion returned "OK"; every `--no-mmap` sibling wedged/died silently. |
| `--no-warmup` | **KEEP.** | Without it the Vulkan warmup epoch crashes the process (exit code 1, `[exit code=1 signal=null]` in log); with it engine is READY in 4-6s (verified A/B). Startup may transiently return 503 "Loading model" while mmap streams weights (~72s heavy-init, up to ~90s first cold load on this Pascal card — do NOT declare failure under 90s). |
| `cwd: binaryDir` on spawn | **REQUIRED.** | Node spawn without `cwd` → Windows DLL search misses `ggml-vulkan.dll`/`llama.dll` next to the binary → instant exit code 1. |
| `--log-disable` | **REMOVE for diagnosis.** | Hides the actual stderr; without it `logs/engine-<id>.err.log` captures the real crash reason. No longer in args. |
| Duplicate `-ngl 999` | Harmless, cleanup candidate. | Model-manager hardcodes `-ngl 999` AND profile runtime `ngl` also emits it → llama.cpp warns `DEPRECATED: argument '-ngl' specified multiple times, only last value will be used`. Both are 999 so behavior is correct; dedupe (let profile drive it) later. |

**Startup time reality:** real Vulkan load on this card is ~72-90s cold (mmap streaming), ~4-6s warm. Verify against `/v1/models`; if `[exit code=1]` or `0xFFFFFFFF` appears → checked `--no-mmap` is absent? `cwd` set? `--no-warmup` present?

---

## 1. Problem & Root-Cause Research

### The Issue
When starting `aide-cipher-4b` (or any model configured with a Vulkan/CUDA binary in `.aide/backends.json`), the daemon reported `status: "starting"`, but `http://127.0.0.1:8091/v1/models` returned HTTP 503 (Service Unavailable). Logs consistently showed `[exit code=1 signal=null]`.

### Root-Cause Analysis (Full Debugging Journey)

1.  **Initial Hypothesis: Windows DLL Resolution Failure (`cwd` Missing)**:
    *   In `daemon/model-manager.mjs`, `this.spawnProcess` was called without specifying `cwd`. Node.js defaults `cwd` to `process.cwd()` (`E:\\aide-sovereign-workbench`).
    *   `llama-server.exe` dynamically links to DLLs (e.g., `ggml-vulkan.dll`, `llama.dll`) located in its own directory (`E:\\llama-cpp-vulkan\\`). Without `cwd` explicitly set to `E:\\llama-cpp-vulkan`, the Windows loader fails to find these DLLs, causing an immediate exit with code 1 (`STATUS_DLL_NOT_FOUND`).
    *   **Verification:** Manually running `llama-server.exe` with `workdir: E:\llama-cpp-vulkan` allowed it to run successfully, while running it from the daemon's default `cwd` failed. This strongly implicated the `cwd` as the root cause.

2.  **Secondary Investigation: `resolveBinaryFor` Logic (`fromFile` vs `this.binaryPath`)**:
    *   During initial debugging, it appeared that `ModelManager.resolveBinaryFor` might be incorrectly selecting the CPU binary (`E:\\llama-cpp\\llama-server.exe`) instead of the Vulkan one, despite `backends.json` being correctly configured and `profile.runtime.backend` being "vulkan".
    *   **Verification:** `fs.existsSync` confirmed both `E:\\llama-cpp-vulkan\\llama-server.exe` and `E:\\llama-cpp\\llama-server.exe` existed. To deeply trace `resolveBinaryFor`, `console.log` statements were added within the method.
    *   **Finding:** Upon running the daemon with the `cwd` fix already applied to `spawnProcess`, the `aide-cipher-4b` model successfully started and served chat completions. The `console.log` statements in `resolveBinaryFor` showed that `fromFile` correctly resolved to `E:\\llama-cpp-vulkan\\llama-server.exe` and `existsSync(candidate)` was `true`.
    *   **Conclusion:** The `resolveBinaryFor` logic itself was correct; the *apparent* issue was a red herring caused by the `llama-server.exe` process exiting so quickly due to the DLL loading failure that no *other* issues (like a misidentified binary) could manifest or be properly logged. The `cwd` fix was the fundamental problem.

3.  **Backend Reality on GTX 1060 / VMware**:
    *   `Vulkan` (`E:\\llama-cpp-vulkan\\llama-server.exe`): **PRIMARY / VERIFIED WORKING**. Achieves ~27.1 tok/s generation speed on Pascal GTX 1060 without driver instability.
    *   `CUDA` (`E:\\llama-cpp-cuda\\llama-server.exe`): Causes driver TDRs (`nvlddmkm.sys` timeout) under VMware VM environments or hangs during startup. **AVOID for this setup.**
    *   `CPU` (`E:\\llama-cpp\\llama-server.exe`): Fallback; slow (~3-7 tok/s).

4.  **In-House Cipher v1 Config**:
    *   Model ID: `aide-cipher-4b`
    *   Base Model: `E:\\aide-sovereign-workbench\\models\\aide-house\\base.q8_0.gguf` (4,082 MB)
    *   Profile: `models/aide-house/base.q8_0.gguf.profile.json` (`{"runtime":{"backend":"vulkan","ngl":999},"samplers":{"temperature":0.7,"top_p":0.9,"min_p":0.05}}`)
    *   LoRA Adapter: `E:\\aide-sovereign-workbench\\models\\aide-house\\frontier-lora.gguf` (126 MB)
    *   Port: `8091`

---

## 2. Surgical Code Fix

### File: `E:\\aide-sovereign-workbench\\daemon\\model-manager.mjs`

In `ModelManager.start(id)`:

```javascript
// Ensure binary directory is set as cwd so Windows DLL search finds backend DLLs (e.g. ggml-vulkan.dll)
const binaryDir = path.dirname(binaryForRun);
const child = this.spawnProcess(binaryForRun, args, { cwd: binaryDir, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
```

---

## 3. Operational Verification SOP

### Step 1: Apply the Fix
Edit `E:\aide-sovereign-workbench\daemon\model-manager.mjs` so the engine spawn carries **all three** verified laws (already in place):
1. `cwd: path.dirname(binaryForRun)` (DLL search law)
2. NO `--no-mmap` in args (law comment present)
3. `--no-warmup` present in args

### Step 2: Restart the Workbench Server Stack
Ensure no orphan `llama-server` or `node` processes are active, then restart the AIDE daemon:
```powershell
# Stop existing engine on port 8091 if active
Invoke-RestMethod -Uri "http://127.0.0.1:4777/api/models/stop" -Method POST -Body '{"id":"aide-cipher-4b"}' -ContentType "application/json" -ErrorAction SilentlyContinue

# Stop AIDE daemon processes (start.mjs launcher, old facade/arch)
Get-Process -Name node -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*aide-sovereign-workbench*' -or $_.CommandLine -like '*start.mjs*' } |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2 # Give processes time to terminate

# Start persistent AIDE stack in background
Start-Process node -ArgumentList "scripts/start.mjs" -WorkingDirectory "E:\aide-sovereign-workbench" -WindowStyle Hidden
Start-Sleep -Seconds 4 # Allow time for daemon to initialize
```
NOTE: separate kill/verify-zero/launch into distinct tool calls — never chain `taskkill` + relaunch in one (reaper hits the whole compound).

### Step 3: Trigger Start of Cipher v1
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4777/api/models/start" -Method POST -Body '{"id":"aide-cipher-4b"}' -ContentType "application/json"
```
Returns `{status:"starting", endpoint:"http://127.0.0.1:8091/v1"}` immediately; poll `/api/models` until `status: ready`.

### Step 4: Validate Endpoint Health & Generation
```powershell
# 1. Check health / models endpoint — poll for READY (cold load up to 90s, warm 4-6s)
Invoke-RestMethod -Uri "http://127.0.0.1:8091/v1/models"

# 2. Test chat completion
$body = @{
    model = "aide-cipher-4b"
    messages = @(@{ role = "user"; content = "Write a Python function to reverse a string." })
    max_tokens = 100
    temperature = 0.7
} | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:8091/v1/chat/completions" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 30
```
**Expected Outcome:** Both `Invoke-RestMethod` calls succeed, returning valid JSON, and the chat completion provides a correct Python function.

### Step 5: Chat through the Router (not just the engine)
```powershell
$body = @{ modelId="aide-cipher-4b"; messages=@(@{role="user";content="Reply with exactly: OK"}); max_tokens=16 } |
        ConvertTo-Json -Depth 5
Invoke-WebRequest -Uri "http://127.0.0.1:4777/api/chat" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 45
```
**Expected:** HTTP 200 `{text, modelId:"local:aide-cipher-4b", harness:{injected:true,...}}`.
CRITICAL: a 409 `NOT_READY` here is expected until the engine is started — it is NOT a bug. Start the model first (Step 3). If engine is up but router still 409s, check the router's process map / fallback chain.

---

## 4. Pitfalls & Threat Matrix

| Threat / Pitfall | Cause | Impact | Prevention / Solution |
|---|---|---|---|
| **`--no-mmap` reintroduced** | Someone "optimizes" away mmap paging | Wedge at heavy-init or silent exit `0xFFFFFFFF`, zero stderr | **NEVER add `--no-mmap`.** LAW comment at `model-manager.mjs:505-509`. Default mmap streams weights into VRAM ~72s and binds HTTP. |
| **Missing `--no-warmup`** | Removed or forgotten flag | Vulkan warmup epoch crashes process (exit code 1) | Keep `--no-warmup` in spawn args. A/B proof: with it → ready 4-6s; without → dead. |
| **Missing `cwd` on spawn** | `spawnProcess` invoked without `cwd: binaryDir` | Exits with code 1 immediately (`STATUS_DLL_NOT_FOUND`) | **CRITICAL FIX:** Always pass `cwd: path.dirname(binaryForRun)` when spawning `llama-server.exe` |
| **Pascal CUDA TDR Crash** | VMware / Pascal GPU driver timeout on CUDA backend | GPU hangs or VM suspends | Prefer `backend: vulkan` in profile for GTX 1060 |
| **Port Conflict** | Orphan `llama-server` process squatting port 8091 | 503 Service Unavailable or model mismatch | Invoke `stop()` or `freePort(8091)` before `start()`; daemon blocks occupied/wrong ports as `conflict` (identity-verified via `/v1/models`) |
| **LoRA Path Resolution** | Relative path escaping model directory | Adapter fails to load | Ensure `model.lora_adapter` resolves to `E:\aide-sovereign-workbench\models\aide-house\frontier-lora.gguf` |
| **RAM Exhaustion** | Free physical RAM < 2.5 GB floor | Model allocation fails | Enforce `FREE_RAM_FLOOR_BYTES` check in `model-manager.mjs` |
| **Incorrect Binary Selection** | `resolveBinaryFor` returning default `this.binaryPath` due to unexpected conditions | CPU-only performance if Vulkan/CUDA selected, or startup failure if `this.binaryPath` is invalid | Ensure `backends.json` is correct and `existsSync(candidate)` behaves as expected. Debug with `console.log` if needed. |
| **409 NOT_READY on /api/chat** | Router correctly refuses when engine not started | chat returns 409 "start this model before chatting" | NOT a bug — start the model first. Only debug if engine is confirmed up AND router still 409s. |
| **Declaring cold start a failure** | Real Vulkan load ~72-90s cold, 4-6s warm | False negatives; restarts pile up | Poll `/v1/models` up to 90s before diagnosing. |
| **killing teacher/other engines** | `taskkill /IM llama-server.exe` nukes ALL instances | Kills user's `E:\llama-cpp` qwen3.5-4b teacher @8081 (corpus gen) | Kill by PID/port match only; never blanket-tool target. Check port 8081 before cleanup. |

---

## 5. Dependencies
- Node.js ESM runtime (`daemon/server.mjs`, `daemon/model-manager.mjs`)
- `E:\llama-cpp-vulkan\llama-server.exe` & `ggml-vulkan.dll`
- `E:\aide-sovereign-workbench\models\aide-house\base.q8_0.gguf`
- `E:\aide-sovereign-workbench\models\aide-house\frontier-lora.gguf`
- `E:\aide-sovereign-workbench\models\aide-house\base.q8_0.gguf.profile.json`
- `.aide/backends.json` (vulkan → vulkan binary path)
- `E:\llama-cpp\llama-server.exe` = user's teacher model runtime (@8081) — never killed

## 6. Changelog
- 2026-08-27: Added §0 Authoritative Launch Flags (verified 2026-08-27 A/B): `--no-mmap` FORBIDDEN law, `--no-warmup` required, cwd law, `--log-disable` removal, duplicate `-ngl` note, real startup-time reality (72-90s cold / 4-6s warm). Added Step 5 (router chat), 409-NOT_READY clarification, teacher-engine-don't-kill threat row. Verified live: engine ran with full stack, `/api/chat` returned OK with harness meta.
