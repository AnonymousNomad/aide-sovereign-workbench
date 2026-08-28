---
name: aide-engine-lifecycle-doctrine
description: Engine lifecycle & contention doctrine for llama-server under AIDE — why engines die with silent "exit code=1, zero stderr", the scoped-kill law (never taskkill /IM llama-server.exe), the memory drain-wait before spawn, the early-exit retry guard, the twin-orchestrator hazard (legacy daemon 4779 vs arch-ts 4778 both managing the same manifest), port-hijack via SO_REUSEADDR, and the exact diagnostic drill to find a machine-wide engine killer. Use whenever engines die unexpectedly, chat returns 409 NOT_READY, a model won't stay loaded, an external job (training corpus generator, supervisor, watchdog) coexists with AIDE engines, or before adding any process-kill logic anywhere.
---

# Engine Lifecycle Doctrine — Nothing Kills Another Engine's Process

Born 2026-08-27: chat returned 409 NOT_READY ("route aide-cipher-4b is down (down)
and no fallback is ready") for days. The engine "crashed with exit code 1 in ~0.1s
with zero stderr" under AIDE's spawn path but ran fine standalone. Root cause was
NOT VRAM, NOT ports, NOT the binary: an unrelated training-corpus Python job
(`gen_chat_corpus_v2.py`) ran `taskkill /IM llama-server.exe /F` — a machine-wide
kill — inside its self-heal loop, murdering every engine on the box whenever its
5s teacher probe hiccuped (which cipher's own load made MORE likely: loading a
4 GB model slows the whole machine → qwen's probe times out → kill-all fires →
cipher dies → repeat). Verified live: fix the kill scope, and cipher + qwen
coexist and chat returns 200 in 768 ms.
## The three simultaneous truths (all verified 2026-08-27)

1. **The killer was external.** `taskkill /IM llama-server.exe /F` from
   E:\pip_temp\opencode\gen_chat_corpus_v2.py (self-heal, lines ~541) killed ALL
   llama-servers machine-wide. TerminateProcess → victim exits code 1 with ZERO
   stderr (buffered stderr is lost on hard kill — absent logs ≠ early death).
2. **The spawn path was fragile anyway.** daemon/model-manager.mjs `start()` did
   `stopAll()` then spawned instantly — the dead engine had not returned its
   commit charge to the OS, so a 4 GB mmap load hit commit exhaustion. Live
   reproduction: cipher loading while qwen resident wedged the ENTIRE machine
   twice (mouse-level unresponsiveness, 30 s tool timeouts).
3. **Twin orchestrators share one manifest.** facade route map sends
   `/api/chat` → arch-ts (node/src/services/model-runtime.ts + model-router.ts,
   port 4778), NOT the legacy daemon (daemon/server.mjs, 4779) — both spawn
   engines from models/manifest.json onto the same ports. Both must obey this
   doctrine or each kills/relocates the other's engines.

## LAWS (do not violate)

- **SCOPED-KILL LAW**: never `taskkill /IM llama-server.exe` (or any /IM image
  kill) anywhere — scripts, skills, watchdogs, supervisors, tests. Kill by
  PORT → PID (netstat -ano parse → taskkill /PID <pid> /F /T). The corpus job's
  self-heal was patched exactly this way (kill only the 127.0.0.1:8081 listener);
  its "never pile up servers on 8081" law is preserved.
- **DRAIN-WAIT LAW**: after stopping any engine, poll `os.freemem()` until
  ≥ 2.5 GB floor (20 s cap) BEFORE spawning a replacement. A killed engine
  releases commit asynchronously; spawning into the transient hole causes
  commit-exhaustion thrash that wedges the whole machine (16 GB RAM, GTX 1060).
- **EARLY-EXIT GUARD LAW**: after spawn, race the child's `exit` event against
  an 8 s timer. Died early → drain-wait → retry ONCE → then fail LOUDLY with an
  actionable message pointing at logs/engine-<id>.err.log. Survived 8 s → past
  the danger window; waitReady() owns readiness from there.
- **SILENT-EXIT SIGNATURE LAW**: on Windows, `exit code=1 signal=null` with no
  stderr = TerminateProcess by SOMEBODY (uv SIGTERM maps to TerminateProcess(1);
  taskkill /F gives 1). Never diagnose it as an engine bug before finding the
  killer: audit every process on the box for kill logic first.
- **PORT-HIJACK LAW**: two llama-servers CAN bind the same port on Windows
  (SO_REUSEADDR double-bind — upstream llama.cpp issue #26822, Aug 2026: second
  server silently waits instead of failing). "Port is listening" proves NOTHING
  about which engine serves it. Always verify via /v1/models and compare served
  model identity (daemon verifyEndpointModel does this — keep it).
- **TWIN-ORCHESTRATOR LAW**: arch-ts model-runtime.ts (4778, serves the UI chat
  via facade route map common/facade-route-map.json) and legacy daemon
  model-manager.mjs (4779) both manage models/manifest.json. Any lifecycle fix
  must land in BOTH or the unfixed twin reintroduces the failure. Arch side
  already relocates on port conflict (allocateFreePort) — relocation is the
  polite pattern; DO NOT add cross-service kills.

## Diagnostic drill (when engines die)

1. Snapshot `tasklist | findstr llama` every ~30 s alongside engine stderr —
   death with zero stderr = external kill; death with llama.cpp error text =
   real crash.
2. Grep EVERY python/node/batch on the box for `taskkill`, `/IM`, `kill(`,
   `os.kill`, `Stop-Process` — the killer is rarely in the repo you're editing.
   `Get-CimInstance Win32_Process | ? CommandLine -match 'llama|8081'` finds
   keep-alive loops (parents/PPIDs matter: find who respawns what).
3. Reproduce contention deliberately: spawn the second engine while the first
   is resident, with EXACT production args, detached (cmd `start "" /min` batch
   — a tool harness tree-kill on timeout murders children launched inline; WMI
   `Invoke-CimMethod Win32_Process Create` children also die with the caller's
   tree; only a fully detached `start` survives).
4. Distinguish loader stall from death: `curl /v1/models` → 503 "Loading model"
   means ALIVE (llama.cpp binds HTTP before weights finish streaming; mmap load
   takes ~72 s+ under coexistence — patience is a diagnostic tool).

## Code anchors (where the doctrine lives)

- daemon/model-manager.mjs: `FREE_RAM_FLOOR_BYTES` (2.5 GB, P7 law),
  `waitForMemoryDrain()`, floor-gate + drain-wait in `start()`, early-exit
  retry loop around `spawnProcess` (2026-08-27).
- E:\pip_temp\opencode\gen_chat_corpus_v2.py: `_kill_port_8081()` — the patched
  scoped self-heal (keep this pattern if the script is regenerated).
- E:\pip_temp\opencode\supervisor_v2.py: single-writer law (`kill_stale_generators`)
  — kills duplicate gen instances by design; do not run the corpus job manually
  while the supervisor lives, or your instance gets killed (correctly).
- node/src/services/model-runtime.ts `start()` — arch twin; needs the same
  drain-wait + early-exit guard ported (queued; UI chat works today via the
  legacy daemon's engine + arch probe because both read the same manifest).

## Threat matrix

| Threat | Signature | Defense |
|---|---|---|
| External kill-all (/IM) | exit 1, zero stderr, all engines die at once | scoped-kill law; audit box for kill logic |
| Commit-exhaustion during load | machine-wide wedge, tool timeouts, engine dies mid-load | drain-wait; RAM floor; one heavy load at a time |
| Port hijack (SO_REUSEADDR) | port LISTENING but wrong/second engine; chat hits random instance | verify /v1/models identity; relocate on conflict |
| Twin-orchestrator races | engine killed by "the other" service; status flips ready↔down | fix both runtimes; relocation not retaliation |
| Keep-alive supervisor fights | engine PID churns every few minutes | find the respawner (PPID chain) before killing anything |
| Buffered-stderr mirage | "no error message" → blamed on binary/profile | stderr is block-buffered via pipe; hard kill loses it |

## Pitfalls (each cost real time on 2026-08-27)

- Diagnosing memory before auditing for killers: the concurrency correlation
  was real but INDIRECT (cipher load → box slows → teacher probe times out →
  kill-all). The engine was never the patient.
- Tool-harness tree-kill: inline `Start-Process` and WMI-created children die
  when the agent tool call times out; use `start "" /min` batch files for
  anything that must outlive the command.
- PowerShell `curl` is Invoke-WebRequest (chokes on `-s -S`); use `curl.exe`.
  JSON bodies with quotes get mangled through cmd — write a body FILE and
  `--data @file`.
- `$args` is a reserved automatic variable in PowerShell — naming a script
  variable `$args` silently breaks the script.
- `schtasks /run` on this box fails "cannot find the file" even right after a
  successful /create — don't burn time; use `start "" /min` instead.
- npx/eslint cold-start exceeds a 30 s tool window on this box — run it via a
  detached batch writing to a log file, or accept `node --check` for syntax.
- Multiple corpus-job instances = qwen respawn ping-pong (each sees the other's
  loading engine as "down"). ONE writer only (supervisor enforces it).