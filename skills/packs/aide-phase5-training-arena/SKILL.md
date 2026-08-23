---
name: aide-phase5-training-arena
description: Phase 5 SOP for the AIDE offline IDE — run model training pipelines from the IDE: define job config JSON, spawn via the daemon, stream logs, poll status, stop cleanly (graceful-then-kill-tree, checkpoint-first). Verified against the actual code in E:\aide-sovereign-workbench (daemon/server.mjs, daemon/training-manager.mjs, app.js) and grounded in the device reality of THIS machine (GTX 1060 6GB Pascal, FP32 only, i7-8750H, 16GB RAM, Windows, py -3.10 -E). Use whenever wiring RUN VERITAS JOB / STOP TRAINING JOB, showing training status/logs, or managing long-running processes from the daemon.
---

# Phase 5 — Training Arena SOP (verified against repo code + this device)

Goal: user starts a training pipeline from the IDE, watches live logs, stops it cleanly, sees status — without leaving the app. The daemon owns the process; the frontend only talks HTTP to the daemon. Every claim below was verified by reading `daemon/server.mjs`, `daemon/training-manager.mjs`, `app.js`, `training/manifest.json` in `E:\aide-sovereign-workbench` on 2026-08-16.

## Research base (primary sources, 2026-08)

| Topic | Finding | Source |
|---|---|---|
| Windows kill semantics | POSIX signals do NOT exist on Windows. `subprocess.kill('SIGTERM')` is not a signal — the process "will always be killed forcefully and abruptly (similar to SIGKILL)" via TerminateProcess. Only SIGKILL/SIGTERM/SIGINT/SIGQUIT are even accepted; all behave as force-kill. | Node.js docs `subprocess.kill()` |
| Detached spawn | `detached: true` on Windows lets the child continue after the parent exits and gives it its own console; once enabled it cannot be disabled. For a true background job, stdio must NOT be inherited (pipe to a file/buffer) and `child.unref()` releases the parent's event loop. | Node.js docs `options.detached` |
| Kill tree | npm/pnpm/tree-kill pattern on Windows: `taskkill /F /T /PID <childPid>` terminates the whole subtree at the spawn site — no process-list enumeration, fast. The robust native mechanism is a Job Object with KILL_ON_JOB_CLOSE (Cargo/Bun), but Node cannot use it without a native addon. | pnpm/pnpm#12406, npm `@npmcli/promise-spawn` |
| Graceful stop on Windows | Since signals are impossible, graceful shutdown is a COOPERATIVE protocol: the trainer polls a sentinel stop-file each step, or stdin EOF, or a named pipe; the process then flushes/checkpoints and exits cleanly. `child.kill()` never gives the child a chance to flush. | SO 34600653, SO 79974632 |
| Checkpoint-first | Checkpoints make any kill resumable-safe. Local SOP (verified on real runs): `ckpt_latest` + `ckpt_best` every 500 steps (model+optimizer+step), `--resume --start-step` so a killed/crashed run continues its deterministic permutation with at most one checkpoint interval lost. | `training-sop` skill §2/§3 (this machine) |
| Log streaming | Server→client streams: SSE is the right primitive (`text/event-stream`, event ids for `Last-Event-ID` resume, keepalive, 204 to stop reconnect). Short polling is fine when staleness ≤ 5–10 s — the app already polls status every 5 s. Bounded ring buffer server-side; strip ANSI escape codes before rendering raw log text in DOM. Always consume stdout/stderr or the child BLOCKS on pipe backpressure. | MDN SSE; caduh 2026; wolf-tech 2026; Node docs stdio |
| GPU monitoring | `nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv` (+ `temperature.gpu`, `-l 5` fine grain / `-l 60` general). `--query-compute-apps=pid,used_memory,process_name` attributes VRAM to PIDs. | NVIDIA KB 3751; Baeldung; oneuptime 2026 |
| Watchdog | Long runs on THIS box crash (verified 8/8: long-run VRAM fragmentation). Any run > ~500 steps MUST have the OOM-retry wrapper + `empty_cache()` every 10–100 steps; a supervisor (the daemon is the natural home) must relaunch with `--resume --start-step`. | `training-sop` §3, `device-training-1060` (verified 8/8) |

## The device reality (non-negotiable, from training-sop / device-training-1060)

| Fact | Consequence for the Arena |
|---|---|
| GTX 1060 Mobile 6GB, Pascal CC 6.1 | NO Tensor Cores. FP32 ONLY. AMP/TF32/FP16 are slower or unavailable — any job config promising "mixed precision" is wrong here. |
| 6GB VRAM, ~5GB spill threshold | Probe peak > 5.0GB is REJECTED. Sweet spot (150M) B=4 L=512 ≈ 4.04GB. |
| 16GB RAM total | Each model server eats 1–2GB. Pre-flight: refuse to start a job when free RAM < ~5GB (machine already ran 2 concurrent SFT jobs with only 4GB free — that is the edge, not the norm). |
| Windows + in-memory token data | NEVER `num_workers>0` in the trainer (spawn-start duplication, 5–50x slower). Direct contiguous slicing only. |
| Python discovery | NEVER plain `python` (MS Store stub). Use `py -3.10 -E` or absolute `E:\Python310\python.exe`. NEVER `PYTHONPATH=E:\python_packages` (cp313-only, broken). `-E` ignores PYTHON* env vars. |
| Battery = GPU −53%; i7-8750H throttles 9–14% | NEVER start/continue training on battery. Thermals explain slow data prep; do not misread as a code regression. |
| GPU util bubble (measured) | Burst 97–99% @ ~5.5GB during forward/backward, then 29–42% @ ~4.2GB during batch construction/generation eval. Persistent <50% during compute = data-pipeline bubble, NOT a dead job. |
| 32K tokens/step effective batch, ckpt every 500 steps | The verified per-stage numbers (LR, warmup, epochs, clip) live in the `training-sop` skill — the Arena launches what that SOP specifies. |

## Training job lifecycle SOP

### Step 1 — Define the job config JSON (`training/manifest.json`)

Jobs are allowlisted ONLY. The manifest currently holds two non-training jobs (`verify-release` = `npm run veritas`, `benchmark-dry-run`); real training stages (`pretrain`, `posttrain`) exist as `stages` marked `approval-required`. To wire a real trainer:

```json
{"id": "pretrain", "name": "Continue pretraining",
 "command": "py", "args": ["-3.10", "-E", "E:\\train\\train.py", "--resume", "--start-step", "<step>"],
 "status": "approval-required"}
```

Rules: command must resolve via the daemon's PATH (`py` launcher or absolute exe path); args must include `--resume --start-step` for long runs; the trainer MUST have the OOM-retry wrapper and ckpt-every-500 before it is allowed in the manifest (gate, below); one heavy job at a time (manager enforces).

### Step 2 — Pre-flight gates (BEFORE any spawn)

1. Plugged in (battery = −53% GPU).
2. Free RAM ≥ ~5GB: `(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory` (>5,120,000 KB).
3. GPU not saturated by another run: `nvidia-smi --query-compute-apps=pid,used_memory,process_name --format=csv,noheader` — any python PID not ours = contention; the manager's single-active guard only knows about ITS jobs.
4. Trainer script inspected: OOM-retry wrapper present, `torch.cuda.empty_cache()` cadence, `--resume` support, ckpt cadence ≤ 500 steps. A job without these is NOT launchable (see Safety rules).
5. Log file target writable: `.aide\training\` exists.

### Step 3 — Spawn via the daemon (the daemon owns the process; the frontend never spawns)

```
POST http://127.0.0.1:4777/api/training/start
{"id": "verify-release", "approved": true}
→ 200 {"id": "verify-release", "status": "running"}
```

Guards in code (training-manager.mjs:24-36): `approved !== true` → "explicit training approval required"; already-active → "another Training Room job is already running"; unknown id → "training job is not allowlisted". The child is `spawn(job.command, job.args, { cwd: workspace, stdio: ['ignore','pipe','pipe'] })`.

[TODO] Start does NOT return the PID. Until fixed, log the PID externally:
`Get-CimInstance Win32_Process -Filter "Name='py.exe' or Name='python.exe' or Name='node.exe'" | Where-Object CommandLine -Match "<job args>" | Select ProcessId,CommandLine`

### Step 4 — Stream logs (see Log streaming SOP below)

### Step 5 — Poll status (see Daemon API contract)

### Step 6 — Stop = graceful-first, then kill-tree fallback, checkpoint-first

Current code (training-manager.mjs:38-44): `stop()` immediately calls `child.kill('SIGTERM')` — which on Windows is a FORCEFUL TerminateProcess (Node docs), NOT graceful — and sets `active = null` before the `exit` event fires. That is a status lie window and a zero-grace stop. The correct protocol, in order:

1. **Cooperative stop (graceful):** drop a sentinel file the trainer polls each step (`.aide\training\stop-<job>.flag`), or close stdin (`child.stdin.end()`) if the trainer honors EOF. This lets it checkpoint + flush. [TODO in code]
2. **Grace window:** wait for `exit` up to ~120 s (one ckpt-interval + flush margin). During this, status stays `stopping`; `active` is NOT cleared on request, only on the `exit` event. [TODO]
3. **Kill-tree fallback:** if still alive after grace, `taskkill /F /T /PID <pid>` — kills the whole subtree (npm-style jobs spawn grandchildren that `child.kill()` alone would orphan). [TODO]
4. **Confirm and record:** on `exit(code)` → log "job exited with code N" (already implemented), THEN mark `stopped`. Return the final log tail + exit code in the stop response. [TODO — currently returns only `{status:'stopped'}`]
5. **Checkpoint-first always:** before killing anything, verify the latest ckpt mtime is recent and the trainer writes `ckpt_latest` (model+optimizer+step). With ckpts every 500 steps + `--resume`, even a force kill loses at most one ckpt interval — that is what makes ANY kill safe. Killing a run with ZERO checkpoints is total loss: never do it (R2 hard rule — NEVER kill a training run without explicit human approval).

### Step 7 — Crash handling + watchdog

`child.once('exit')` records the exit code and clears `active` (implemented). Missing [TODO]: state `crashed` (exit != 0), log `TRAINING_CRASHED: <jobId> code N`, and — per training-sop — a watchdog that auto-relaunches the SAME job with `--resume --start-step <last ckpt step>` up to N times (verified reality: long runs on this box WILL hit fragmentation at least once; 15-step probes do NOT show it). Never auto-relaunch a job whose script lacks resume semantics — you would restart from scratch and corrupt the permutation.

## Daemon API contract (verified by reading the code)

| Route | Request body | Response (repo, current) | Notes / gaps |
|---|---|---|---|
| `POST /api/training/start` (server.mjs:377-380) | `{id, approved}` | `{id, status:'running'}` | [TODO] return `pid`. Job must exist in manifest; `approved` must be `true`; single-active enforced. |
| `POST /api/training/stop` (server.mjs:381-383) | `{}` | `{status:'stopped'}` or `{status:'idle'}` | [TODO] graceful-first protocol + final tail + exit code; `active` must clear on `exit`, not on request. |
| `GET /api/training/status` (server.mjs:371-373) | — | `{active: {id, status}\|null, logs: <last 100>, jobs: [...]}` | Implemented. `logs[]` = `{id, line, at}` with stderr prefixed `stderr: `; exit records "job exited with code N". [TODO] add step/loss/elapsed parsing + GPU/RAM health. |
| `GET /api/training/logs` (streaming) | — | NOT IMPLEMENTED | [TODO] SSE or `?since=<index>` tail endpoint. |
| Errors | — | `{error}` with 500, or 503 when matching `/Local model setup required|model file was not found|llama-server was not found/` (errorStatus, server.mjs:91-93) | All responses JSON with `Access-Control-Allow-Origin: http://127.0.0.1:4173`. |

Frontend (app.js:883-902, 1143-1144, 1151-1152): `#training-verify` → `trainingRequest('start', {id:'verify-release', approved:true})`; `#training-stop` → `trainingRequest('stop')`; `refreshTrainingStatus()` polls every 5 s and renders `active | jobs | last log line (100 chars)` into `#training-status` (index.html:85-87). Daemon survives browser refresh — job ownership + log buffer live in the daemon (partially: logs are in-memory only, see resilience gap below).

Resilience gap [TODO]: `TrainingManager` state is in-memory (`this.logs`, `this.active`). Kill the daemon mid-job → on restart the orphan still runs but status reports idle and logs are gone. Fix: persist `{jobId, pid, startedAt}` + append log lines to `.aide\training\<job>-<ts>.log` on every record; on `load()`, detect live PIDs (`Get-Process -Id`) and re-adopt them. Only then does the old acceptance gate "daemon restart still reports the orphan job's state" pass.

## Log streaming SOP

- **Bounded ring buffer in the daemon** (owner): cap `this.logs` (~2000 lines) so a multi-hour job cannot grow it unbounded; `status()` already slices last 100. [TODO — currently unbounded array]
- **ANSI strip at capture:** training scripts emit `\u001b[0;33m...` etc.; render raw log text in the DOM ONLY after stripping (`/\u001b\[[0-9;]*[a-zA-Z]/g`) — control chars in textContent are harmless, but the terminal panel must not parse ANSI since it is not an xterm renderer. [TODO]
- **Line assembly:** stdout chunks split on '\n' per chunk (training-manager.mjs:31-33) — a line split across two chunks is recorded as two fragments. [TODO] accumulate a pending buffer per stream and flush on newline/EOF.
- **Transport:** polling `GET /api/training/status` every 5 s is CORRECT for this app (staleness ≤ 5 s; caduh/wolf-tech: polling wins under ~10 s). Upgrade path [TODO]: SSE `GET /api/training/logs` — `Content-Type: text/event-stream`, one event per line with an id, `:keepalive` every 15 s, `Last-Event-ID` resume from the ring buffer, HTTP 204 when the job ends so the browser stops reconnecting. Do NOT use WebSockets (one-way stream).
- **Never leave stdout un-consumed:** pipes have limited capacity; if nothing reads the child's stdout the trainer BLOCKS on write (Node docs) — the daemon's data handlers are the mandatory consumer.

## Health monitoring SOP (GPU + RAM + watchdog)

- Poll (daemon timer or external): `nvidia-smi --query-gpu=utilization.gpu,memory.used,temperature.gpu --format=csv,noheader,nounits` every 5–15 s (NVIDIA: `-l 5` fine grain, `-l 60` general).
- Interpret on THIS card: compute-phase util ~95%+ = healthy; persistent <50% = data-pipeline bubble (fix: pre-tokenized contiguous slicing, prefetch, batch eval gen), NOT a dead job; VRAM > ~5GB peak = spill (3x slower, reject probes); temp + power checks for thermals.
- PID attribution: `nvidia-smi --query-compute-apps=pid,used_memory,process_name --format=csv,noheader` — confirm OUR python PID owns the VRAM; dedupe dead python stubs (~4MB RAM, 0 CPU — do not kill the active one).
- Alive test: `(Get-Process -Id <pid>).CPU` delta over 20 s grows; ckpt mtime advances on cadence; `Get-Content <run log> -Tail 8` advances.
- Watchdog guidance (training-sop, verified): OOM-retry wrapper is MANDATORY in any long run; `--eval-every >= 20`; `--resume + --start-step` on relaunch; spike detector + clip fraction <5% + grad/param <0.1 are the in-run health signals the Arena's status should eventually surface. [TODO daemon watchdog + health fields in status]

## Safety rules (hard)

1. NEVER start or continue a training job on battery (GPU −53%).
2. NEVER `num_workers>0` for in-memory token data (Windows spawn duplication; 5–50x slower).
3. NEVER plain `python` — MS Store stub. `py -3.10 -E` or `E:\Python310\python.exe` only.
4. NEVER kill a job without checkpoint safety: latest `ckpt_latest` (model+optimizer+step) verified recent BEFORE stop; zero-checkpoint run = total loss. R2: never kill training without explicit human approval.
5. NEVER stop a job that is mid-checkpoint-write — give the grace window before the kill-tree fallback.
6. NEVER start a second heavy job while one runs (manager guard + GPU/RAM pre-flight).
7. NEVER "fix" a live run by editing the train script — Python reads the file once at launch; edits are inert until the next launch.
8. NEVER auto-relaunch a job without resume semantics (`--resume --start-step`).

## Verification gates (run these to PROVE the arena works)

```
# 1. daemon up
Invoke-RestMethod http://127.0.0.1:4777/health

# 2. idle baseline
Invoke-RestMethod http://127.0.0.1:4777/api/training/status   # active:null, jobs: 2

# 3. start
Invoke-RestMethod -Method Post -ContentType 'application/json' -Body '{"id":"verify-release","approved":true}' http://127.0.0.1:4777/api/training/start
#   → {"id":"verify-release","status":"running"}
# 4. observed liveness: poll status twice ≥2s apart → last log line ADVANCES (never assume running)
# 5. process alive + CPU grows: (Get-Process npm).CPU twice over 20s
# 6. GPU busy: nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader,nounits
# 7. stop
Invoke-RestMethod -Method Post -ContentType 'application/json' -Body '{}' http://127.0.0.1:4777/api/training/stop
#   → {"status":"stopped"}; status → active:null; log tail ends "job cancelled by user"
# 8. process CONFIRMED dead (PID check quoted) — the old acceptance gate
# 9. negative paths: start without approved → "explicit training approval required";
#    start twice → "another Training Room job is already running"; unknown id → "not allowlisted"
# 10. [TODO] crash path: Stop-Process -Force on the child → status reports crashed + exit code
# 11. [TODO] resilience: kill daemon mid-job, restart → orphan re-adopted with its log tail
# 12. [TODO] real trainer: py -3.10 -E job with --resume survives a forced kill, resumes at ckpt step
```

## Audit checklist (before claiming Phase 5 done)

- [ ] Job configs in `training/manifest.json` are allowlisted command+args; real trainer uses `py -3.10 -E` (never plain python)
- [ ] Trainer has OOM-retry wrapper + `empty_cache()` cadence + ckpt ≤ 500 steps + `--resume --start-step` (training-sop gates)
- [ ] Start returns pid; daemon logs pid + job metadata to `.aide\training\` [TODO]
- [ ] Logs: ring buffer capped, ANSI stripped, lines assembled across chunk boundaries [TODO]
- [ ] Status: active/stopped/crashed derived from observed process + advancing log tail (verify-first, never assumed)
- [ ] Stop: cooperative sentinel → grace window → taskkill /F /T fallback; active clears on exit only [TODO]
- [ ] Crash: TRAINING_CRASHED logged with exit code; watchdog auto-relaunch with resume, bounded retries [TODO]
- [ ] Daemon restart re-adopts orphan jobs from persisted state [TODO]
- [ ] Health: nvidia-smi poll + RAM pre-flight wired into status [TODO]
- [ ] Single-active + approval guards tested via the negative-path gates
- [ ] Battery check, RAM check, GPU-contention check before every real launch

## Sources

- Node.js child_process docs — kill() semantics on Windows (TerminateProcess, "forcefully and abruptly"), `options.detached`, stdio backpressure: https://nodejs.org/api/child_process.html
- SO — graceful kill of a detached child on Windows (signals impossible; readline/cooperative patterns): https://stackoverflow.com/questions/34600653/graceful-kill-off-a-detached-node-js-spawned-child-process-in-windows
- SO — child.kill('SIGINT') force-kills on Windows (2026): https://stackoverflow.com/questions/79974632/node-spawn-trouble-with-doing-a-graceful-shutdown
- pnpm/pnpm#12406 — kill tree at spawn site with `taskkill /F /T /PID`; Job Object KILL_ON_JOB_CLOSE as native alternative; npm @npmcli/promise-spawn: https://github.com/pnpm/pnpm/issues/12406
- MDN — Server-sent events: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
- caduh (2026) — SSE vs WebSockets vs polling decision: https://www.caduh.com/blog/long-polling-vs-websockets-vs-sse
- wolf-tech (2026) — real-time decision matrix (polling wins for ≤10s staleness): https://wolf-tech.io/blog/nextjs-15-sse-vs-websockets-vs-polling-real-time-decision-matrix-2026
- NVIDIA KB 3751 — useful nvidia-smi queries (`--query-gpu=... --format=csv`, `-l` cadence): https://nvidia.custhelp.com/app/answers/detail/a_id/3751
- Baeldung — NVIDIA GPU monitoring (`--query-gpu`, `--query-compute-apps`): https://www.baeldung.com/linux/nvidia-gpu-monitor-state
- oneuptime (2026) — nvidia-smi monitoring, CSV exporters, compute-app PID attribution: https://oneuptime.com/blog/post/2026-03-02-how-to-monitor-gpu-usage-with-nvidia-smi-on-ubuntu/view
- DigitalOcean — GPU utilization monitoring (loop mode, query-gpu): https://www.digitalocean.com/community/tutorials/monitoring-gpu-utilization-in-real-time
- Local authority (this machine): `C:\Users\Grey_\.agents\skills\training-sop\SKILL.md` (verified per-stage numbers) and `C:\Users\Grey_\.agents\skills\device-training-1060\SKILL.md` (FP32-only, num_workers=0, battery, 27% bubble, health check)
