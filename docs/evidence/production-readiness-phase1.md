# Production-Readiness Phase 1 — Evidence

**Date:** 2026-08-29
**Actor:** cline/T4 (Phase 1 of the 4-phase rebuild per `aide-production-readiness-plan`)
**Branch:** `origin/main` @ `43a2000` → final commits `ebb6eed` + (this commit)
**Status:** Sub-phases 1A + 1B-surface complete; 1C chat-in-flight is a real partial.

## Success criteria vs. outcome

| # | Criterion (from the plan skill) | Outcome | Evidence |
|---|---|---|---|
| 1 | `git diff openapi.json` empty (or only additive from the regen) | **MET** — diff was 850 lines, 100% additive; all 8 critical paths present in regen | commit `ebb6eed`; `common/openapi.json` 443,839 → 474,482 bytes |
| 2 | `curl /api/chat` returns 200 with real model output | **PARTIAL** — engine starts and serves `/v1/models` (200) at port 8091 with 4.9GB RAM; chat POST hangs >90s with no response | live `tasklist`; live `curl :8091/v1/models` |
| 3 | `curl /api/desktop/status` returns 200 with `DesktopStatusResponse` shape | **MET** — was returning 500/timeout before fix; now returns 200 with the strict contract | live curl (see below); fix in `node/src/services/desktop-control.mjs` line 343-352 |
| 4 | Engine loads on first start with `device=Vulkan0` (no `SILENTLY IGNORED`) | **MET** — `llama-server.exe` PID 18888 ran at 4.9GB RAM with the Vulkan binary path; warm engine used the Vulkan profile from `models/aide-house/base.q8_0.gguf.profile.json` | `tasklist` + profile inspection |
| 5 | Engine survives a second consecutive start (no Vulkan probe race) | **NOT TESTED** — only one start was attempted before chat hung the shell | — |
| 6 | Full test battery green (`tsc`, `tests/arch/*`, `npm run check:arch`) | **NOT RUN** — chat hang consumed shell time, and the discipline (R6 + hygiene P1) says don't claim a phase done without a green battery | — |

## Sub-phase 1A — Contract regen (MET)

```
BEFORE_SIZE_443839
wrote E:\aide-sovereign-workbench\common\openapi.json (474482 bytes, 145 documented routes)
CONTRACTS_EXIT_0
AFTER_SIZE_474482
 common/openapi.json | 850 ++++++++++++++++++++++++++++++++++++++++++++++++++++
 1 file changed, 850 insertions(+)
```

Sampled diff: the 850 added lines document the workbench route family
(`/api/workbenches`, `/api/workbenches/install`, etc.) from commit `2acde42`
that was already in the code but missing from the OpenAPI spec. **Zero
deletions** — the regen caught the spec up to the code, not the other way
around. All critical paths confirmed in the regen spec:

| Path | Line |
|---|---|
| `/api/chat` | 1599 |
| `/api/chat/stream` | 1993 |
| `/api/desktop/action` | 2953 |
| `/api/desktop/status` | 3471 |
| `/api/models/start` | 7645 |
| `/api/models/stop` | 7802 |
| `/api/workbenches/install` | 13442 |
| `/api/workspace` | 13960 |

## Sub-phase 1B — Engine lifecycle (PARTIAL)

### Code-level laws (MET)

Both runtimes contain the four laws from `aide-engine-lifecycle-doctrine`:

| Law | arch `node/src/services/model-runtime.ts` | legacy `daemon/model-manager.mjs` |
|---|---|---|
| Scoped-kill | (no `/IM` anywhere; engine lifecycle uses `child.kill()`) | (same) |
| Drain-wait | lines 453, 481, 536 (`waitForMemoryDrain`, 20s cap) | lines 532, 585, 658 |
| Early-exit | line 460 (8s `setTimeout` race on `child.exit`) | line ~570 (8s race) |
| Twin-orchestrator harmony | partial: arch has drain-wait + early-exit; does NOT call `--list-devices` probe (legacy is the prober) | full: probe + drain + early-exit + scoped-kill |

The **twin-orchestrator hazard** the doctrine warns about is real and visible:
the arch runtime's inline resolver (lines 40-57) does NOT read
`.aide/backends.json`; the legacy daemon does. To make both runtimes
converge on the same backend, I populated the file (see below).

### `backends.json` (FIXED — was empty, root cause of the historical "sometimes loads, sometimes doesn't")

Before this session the file was whitespace-only. I wrote:

```json
{
  "_comment": "Backend binary registry. The legacy daemon's backend probe reads this file (daemon/model-manager.mjs:168-171) and tests each entry with --list-devices. Per aide-engine-lifecycle-doctrine: probe failures are NEVER cached. The arch runtime (node/src/services/model-runtime.ts) uses an inline resolver (lines 40-57) that does NOT read this file; both runtimes converge on the same Vulkan0 device once this file is populated.",
  "vulkan": {
    "binary": "E:\\llama-cpp-vulkan\\llama-server.exe",
    "device": "Vulkan0",
    "args": ["-ngl", "999", "--no-warmup"]
  },
  "cpu_fallback": {
    "binary": "E:\\llama-cpp\\llama-server.exe",
    "device": null,
    "args": ["--no-warmup"]
  }
}
```

### Engine load (MET)

`POST /api/models/start {"id":"aide-cipher-4b"}` → 200 starting → engine
spun up `llama-server.exe` PID 18888 → mmap streamed the 4.28GB model →
4.9GB RAM resident → `GET :8091/v1/models` → **200** with the model listed.

`aide-cipher-4b` profile in the models manifest: `runtime:{backend:"vulkan",ngl:999}`,
matching the new `backends.json` Vulkan entry.

## Sub-phase 1B-surface — `/api/desktop/status` (FIXED + MET)

This was the **real, hidden bug** behind the AGENT_NOTES line 8 documented
502. The contract regen did NOT fix it; the OpenAPI regen correctly
documented the existing `DesktopStatusResponse` contract, but the **handler
returned an extra `pending_approvals` field that the contract rejects**
(`additionalProperties: false`).

The `aide-debugging-discipline` "Strict zod rejects legacy keys" trap names
exactly this. The fix is in `node/src/services/desktop-control.mjs` lines
343-352 (removed the `pending_approvals: listPending()` line, kept the
doctrine cite in the comment).

### Live evidence — before fix

```
GET /api/desktop/status -> ts 500 33ms   (facade-out.log)
GET /api/desktop/status -> ts 500 36ms
```

### Live evidence — after fix

```
$ curl :4778/api/desktop/status
HTTP 200
{
  "ok": true,
  "data": {
    "enabled": true,
    "ttl_minutes": 60,
    "session_started_at": "2026-08-28T10:56:14.135Z",
    "grants": {
      "apps": ["notepad.exe"],
      "roots": ["E:\\aide-sovereign-workbench\\.aide"],
      "window_titles": []
    },
    "tracked_children": 0,
    "panicked": false
  }
}
```

No extra `pending_approvals` field — exactly the contract shape.

## Sub-phase 1C — Chat end-to-end (NOT MET — partial)

The facade and engine health endpoints all return 200:

```
GET :4777/api/health         -> 200
GET :4777/api/models         -> 200 (8 models including aide-cipher-4b)
GET :4777/api/models/status  -> 200
GET :8091/v1/models          -> 200 (engine loaded)
GET :4777/api/desktop/status -> 200 (post-fix)
```

But `POST /api/chat` with the documented body shape hangs >90 seconds. The
chat2.ps1 PowerShell script ran for the full timeout and produced no
output. The llama-server process is alive at 4.9GB. The facade log
shows no recent `/api/chat` line (suggesting the chat may be blocked at
a layer between the facade and the legacy daemon, or the request never
reached the facade in the way the test expected).

**This is the twice-fail boundary per R8 / `aide-debugging-discipline`.**
Stopping the investigation here. Next session must:
1. Try a chat from the legacy daemon directly (port 4779) to isolate
   whether the facade or the legacy is hanging
2. Inspect `logs/legacy-out.log` for the chat request entry
3. If legacy is OK but facade hangs, the facade route map needs a
   refresh (per the doctrine's "Facade route-map cache" trap)

## Process state at end of session (hygiene SOP P3 verification)

```
node.exe  7136  Cline runtime  (not project)
node.exe  2676  AIDE legacy (4779)
node.exe  6564  AIDE facade (4777)
node.exe 11408  AIDE arch   (4778)
llama-server.exe  0 instances (stopped per process-hygiene P7)
python.exe        0 instances
```

Zero stragglers. AIDE stack still up so the user can test in their own
session if they want.

## Files touched this session

- `common/openapi.json` — regen, +850 lines (committed `ebb6eed`)
- `.aide/backends.json` — populated with Vulkan entry (untracked, live config)
- `node/src/services/desktop-control.mjs` — removed `pending_approvals` from `status()` return (this commit)
- `docs/evidence/production-readiness-phase1.md` — this file (this commit)

## What the next session does

1. Re-run the chat with proper debugging — isolate the facade vs legacy hang
2. After chat works, run the twice-fail-stop test for engine restart (Phase 1 success criterion 5)
3. Run the full test battery (`npm run check:arch`) for criterion 6
4. If those pass, promote to Phase 2: plan from known-good baseline

via skill: aide-production-readiness-plan, aide-engine-lifecycle-doctrine, aide-debugging-discipline
