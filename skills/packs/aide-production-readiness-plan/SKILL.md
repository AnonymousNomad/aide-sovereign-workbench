---
name: aide-production-readiness-plan
description: Master plan to take the AIDE Sovereign Workbench from current state (3 services + 1 engine, contract-drifted, engine-load racy) to a working production IDE that you can actually use. Encodes the audit of the 2026-08-28 incident (chat 500s, engine-load sometimes-fails, desktop 502s, contract drift), the chosen 4-phase rebuild path (audit → drift+engine fix → plan-from-baseline → execute), the success criteria for each phase, and the doctrine that governs every step. Use at the START of every AIDE session before any code work, when blocked, or when the user asks for a rebuild / production-readiness pass.
---

# AIDE Production Readiness Plan — from "I cannot use it" to "ship it"

## The incident that triggered this plan (verified 2026-08-28)

Per `E:\aide-sovereign-workbench\AGENT_NOTES.md` line 8 (CURRENT STATUS), three
user-facing surfaces were broken simultaneously and stayed broken for a month:

1. **Chat returns 500 "response violates the contract"** through BOTH the legacy
   daemon (port 4777) AND the arch-ts server (port 4778). Root cause:
   `openapi.json` drifted from the runtime zod schemas. The engine direct
   (port 8091) works fine; the failure is the AIDE route layer, not the model.
   Fix is one command: `cd E:\aide-sovereign-workbench && npm run contracts`.

2. **Engine loads sometimes, sometimes doesn't.** Root cause: Vulkan probe
   contention (documented in `aide-engine-lifecycle-doctrine`) — the Vulkan
   binary's `--list-devices` HANGS while any engine is loaded, and the
   probe failure is racy on retry. The "fix" in the doctrine says "never cache
   failures," but the actual production path still hits the race.

3. **Desktop control returns 502** on `/api/desktop/status` — same drift class
   as #1 (`pending_approvals` not in the `DesktopStatusResponse` contract).

The previous agents marked all three as "out of scope" for the in-house model
focus. That call was wrong: these are the surfaces the user actually touches,
and they are blocking real product use.

## The doctrine that already exists (do not rewrite)

The 2026-08-28 audit (this session) found that the doctrine for the rebuild
**already exists** in `E:\aide-sovereign-workbench\skills\packs\`. It is just
not being loaded consistently. The operator's discipline requires every fix
to reference these packs BEFORE writing any code:

| Pack | What it governs | When to load |
|---|---|---|
| `aide-ide-research` | 12-point research base (Eclipse Theia, Monaco, DAP, xterm, llama.cpp, packaging, etc.) | Start of any AIDE task |
| `aide-engine-lifecycle-doctrine` | Scoped-kill, drain-wait, early-exit, twin-orchestrator, Vulkan probe | Engine won't start, dies unexpectedly, or loads race |
| `aide-aide-stack-launch-and-recover` | 3-service + 1-engine launch, the 7-row threat matrix, the 7 pitfalls | Stack is dead or half-alive |
| `aide-credo-guardrail` | Code + Lens scaffold injected into every model session | Composing any system scaffold |
| `aide-debugging-discipline` | Verified-trap table, server-won't-start checklist | Anything misbehaves |
| `aide-master-roadmap` (in global tree) | Top-level thesis, standing laws, week plan | Session start, when request doesn't match a phase skill |

**R8 (Hard Rules) says: load the skill BEFORE guessing the fix.** R5 of
`aide-ide-research` says: "Facts come from the research base above or from
re-verification. Never invent API shapes." The plan below is grounded in both.

## The 4-phase rebuild (audit, drift fix, plan, execute)

### Phase 0 — Doctrine loaded + audit written (this skill, this session)

**Done in this session:**
- Read AGENT_NOTES, identified 3 blocking issues from documented evidence
- Loaded 11 governing skills (developer-code-and-credo, hard-rules,
  project-governance, continuous-improvement-sop, aide-ide-research,
  aide-engine-lifecycle-doctrine, aide-aide-stack-launch-and-recover,
  aide-credo-guardrail, aide-debugging-discipline, production-readiness,
  aide-master-roadmap, aide-rseries-refactor)
- Wrote THIS skill with the success criteria, the doctrine references, and
  the evidence base

**Success criteria:** This file exists in
`E:\aide-sovereign-workbench\skills\packs\aide-production-readiness-plan\SKILL.md`
and `AGENT_NOTES.md` has a new entry citing it.

**Evidence:** `git log --oneline` shows the new file in the worktree.

### Phase 1 — Drift fix + engine lifecycle lock (next session, ~1 session)

**Sub-phase 1A: Fix the OpenAPI contract drift**

- **Command:** `cd E:\aide-sovereign-workbench && npm run contracts`
- **Verify drift is gone:** `git diff openapi.json` should be empty
  (regenerated == committed). If `git diff` shows a non-empty diff, the
  zod contracts are STILL drifted from the routes — investigate, do not
  commit.
- **Verify chat works end-to-end:** start the stack via the canonical
  launcher (`E:\aide-sovereign-workbench\logs\launch-aide.mjs`), then
  `curl -X POST http://127.0.0.1:4777/api/chat -H 'Content-Type: application/json' -d @<body-file>`.
  Save the response (redact any secrets) to `docs/evidence/chat-green.md`.
- **Verify desktop status:** `curl http://127.0.0.1:4778/api/desktop/status`
  must return 200 with the documented `DesktopStatusResponse` shape, no 502.

**Sub-phase 1B: Lock the engine lifecycle**

- **Read** `node/src/services/model-runtime.ts` and `daemon/model-manager.mjs`.
  Confirm the four laws from `aide-engine-lifecycle-doctrine` are in BOTH:
  scoped-kill, drain-wait, early-exit, twin-orchestrator harmony.
- **If the arch twin lacks any of them** (most likely drain-wait and twin
  cooperation), port the missing pieces — but ONLY after the contract
  drift is fixed, because chat must work to verify the engine during testing.
- **Verify Vulkan probe:** start the stack with NO engines running, then
  `curl -X POST http://127.0.0.1:4778/api/models/start -d '{"id":"aide-cipher-4b"}'`
  — must report `device: Vulkan0`. If `device: cpu` with a
  `SILENTLY IGNORED` warning, the probe ran while an engine was up.
  Stop everything and retry.

**Sub-phase 1C: Verify the in-house model actually chats through the facade**

- **Spawn the cipher engine** via the arch API (NOT standalone). Use the
  launch flow from `aide-aide-stack-launch-and-recover`.
- **Send a real chat prompt** that is reproducible: "Say 'ok' and nothing
  else." Save the response. Expected: HTTP 200 with `text: "ok"`,
  `modelId: "local:aide-cipher-4b"`, `harness.injected: true`.
- **Send a second prompt** that exercises a known failure case from
  `docs/evidence/capability-audit-summary.md` (e.g., a long prompt that
  overflows the served context) and confirm the rescue path fires (per
  commit `fa22fe3` the overflow rescue refits the history).

**Phase 1 success criteria:**
- `curl /api/chat` returns 200 with real model output (not 500, not 502)
- `curl /api/desktop/status` returns 200 with valid `DesktopStatusResponse`
- Engine loads on first start with `device: Vulkan0`
- Engine survives a second consecutive start (proves the Vulkan probe is
  no longer racy — start, stop, start, all green)

**Phase 1 evidence:** `docs/evidence/production-readiness-phase1.md` with
the curl outputs, the engine status JSON, and the git diff for `openapi.json`.

### Phase 2 — Plan from a known-good baseline (session after Phase 1)

**DO NOT START PHASE 2 until Phase 1 evidence is in `docs/evidence/`.**

Phase 2 produces a full rebuild plan that respects the verified state from
Phase 1. The plan covers:

1. **In-the-Box law compliance** — every capability works from bundled assets.
   List any current features that would break on an air-gapped machine.
2. **Performance budget** — the 47 tok/s CPU baseline is unacceptable; the
   97 tok/s Vulkan baseline from the qwen-1.5b battery (AGENT_NOTES line 46)
   is the floor target. Models slower than that need a replacement or
   a runtime tweak.
3. **Feature parity audit** — read `aide-vscode-parity-roadmap` and the
   master roadmap, mark every "shipped" / "pending" / "blocked" with
   the actual current state. The 2026-08-28 audit showed several items
   marked shipped were actually broken (the contract-drift class).
4. **Skill pack production-readiness** — every doctrine pack in
   `skills/packs/` must have an up-to-date "what changed" entry.
5. **CI / gate battery** — the project has an arch test suite, tsc, eslint,
   veritas. Phase 1 must end with all of those green; Phase 2 documents
   the gate additions needed for the rebuild (e.g., a real chat e2e test
   that runs every CI build).

**Phase 2 success criteria:** A single file
`docs/evidence/production-readiness-roadmap.md` that names every feature,
every gate, every skill that the rebuild must satisfy, with current-state
columns filled in from observed evidence.

**Phase 2 evidence:** That file, plus an `AGENT_NOTES` entry that points
to it and to the Phase 1 evidence.

### Phase 3+ — Execute phase by phase, with each phase producing its own skill

Each phase from the Phase 2 roadmap gets:

1. A new skill in `skills/packs/` that names the phase, the success criteria,
   the evidence, the doctrine, the threats
2. Implementation in code, matching existing conventions
3. A live verification battery (curl, engine test, UI test)
4. An `AGENT_NOTES` entry with timestamp, actor, files touched, evidence

R8 enforces the loop: any failure that recurs twice in one phase gets
the engine stopped, the doctrine re-read, and a fresh skill/fix attempt
before the third try.

## Threat matrix (Phase 1 specific)

| Threat | Mitigation |
|---|---|
| Contract regen produces a worse diff than the current openapi.json | Compare `git diff openapi.json` line count before/after. If the diff is large (>200 lines), investigate route-by-route instead of bulk-accepting. The facade route map (`common/facade-route-map.json`) is a separate file and may need its own regen. |
| Vulkan probe still hangs when starting the engine | The doctrine says the probe hangs only WHILE an engine is up. If it hangs on a fresh start with no engine running, the GPU driver or the Vulkan binary itself is wedged — restart the daemon (kill by PID per the scoped-kill law), then retry. Document the hang in AGENT_NOTES. |
| The engine starts but the model status is `pending` or `warming` for >90s | Cold Vulkan load is 72-90s per `aide-inhouse-model-runtime` §0. Anything beyond 90s is a real bug, not startup. Check `logs/engine-<id>.err.log` for the `0xFFFFFFFF` exit-code signature (which means `--no-mmap` was reintroduced — investigate, do not retry). |
| Chat returns 500 again after the regen | The zod contracts are still out of sync with the routes. Read the route handler, read the zod schema, identify the field, regen contracts, retry. Do NOT "fix" by silencing the validator. |
| Drift fix breaks the browser build (vite complains about new types) | `npm run build:frontend` is part of `check:arch`. If it fails, the contract change is in a type the browser uses — port the browser client to match, do not weaken the contract. |

## Pitfalls (learned the hard way, encoded so we don't repeat them)

1. **The doctrine already exists.** Load it. Do not reinvent.
2. **The global skill tree is partial.** Project-specific work references
   `E:\aide-sovereign-workbench\skills\packs\`, not `C:\Users\Grey_\.agents\skills\`.
3. **The master `AGENT_NOTES.md` is at `E:\FSI-FELON\AGENT_NOTES.md`** per
   `hard-rules` R1, but the IDE project's journal is
   `E:\aide-sovereign-workbench\AGENT_NOTES.md`. Both are append-only.
   Both get entries; do not move or rewrite either.
4. **Two-process IDE architecture** (Eclipse Theia, per
   `aide-ide-research` §1) — never put filesystem or process-spawn code
   in the browser. The browser talks to the daemon over WebSocket or REST.
5. **OpenAI-compatible is the contract** for the local engine. Any chat
   route that doesn't return OpenAI-shaped JSON is wrong.
6. **The chat route goes through the facade** (port 4777) by default, not
   the arch directly. The facade proxies to either the legacy daemon
   (port 4779) or the arch (port 4778) per the route map. If chat 500s
   on 4777 but works on 4778, the facade route map is the problem.
7. **The engine is a separate process** with a 4GB mmap load. Do not try
   to start it from inside the arch. Spawn it as a sibling.
8. **Vulkan probe contention** — the probe hangs while an engine is up.
   This is the doctrine, not a bug. Plan around it.
9. **The user has been stuck for a month.** This plan exists because
   previous agents marked blocking work as "out of scope." R6 says never
   claim done on unverified work; the corollary is never claim "out of
   scope" on work that blocks the user.
10. **The `start.mjs` script in `scripts/` is a developer convenience.**
    The canonical launcher for production is
    `E:\aide-sovereign-workbench\logs\launch-aide.mjs` (per
    `aide-aide-stack-launch-and-recover`).

## Verification gates (Phase 1 — the only phase with hard gates right now)

1. **Contract regen is a no-op.** `git diff openapi.json` after
   `npm run contracts` is empty. If it is not, the contracts were never
   the problem; investigate the routes.
2. **Chat returns 200 through the facade with a real model response.**
   `curl -X POST http://127.0.0.1:4777/api/chat -d @<body>` returns
   `{text: <non-empty>, modelId: <correct id>, harness: {injected: true}}`.
   Save the full response (with secrets redacted) to
   `docs/evidence/production-readiness-phase1.md`.
3. **Desktop status returns 200 with the documented contract shape.**
   `curl http://127.0.0.1:4778/api/desktop/status` returns the
   `DesktopStatusResponse` zod schema, no 502.
4. **Engine loads on a fresh start with device=Vulkan0.** No
   `SILENTLY IGNORED` warning in the engine error log.
5. **Engine survives a stop-start cycle without Vulkan probe contention.**
   Start, stop, start, all green. This proves the probe is no longer
   racing the engine lifecycle.
6. **The full test battery is green.** `tsc -p tsconfig.node.json --noEmit`,
   `tests/arch/*` runner, the project's `npm run check:arch`. Any failure
   is a Phase 1 blocker, not a "next session" issue.

## Reference graph

This skill does not stand alone. The audit it documents depends on:

- `aide-ide-research` (12-point research base, R2 of that skill)
- `aide-engine-lifecycle-doctrine` (the three simultaneous truths, the four laws)
- `aide-aide-stack-launch-and-recover` (launcher command, threat matrix)
- `aide-debugging-discipline` (the verified-trap table)
- `aide-credo-guardrail` (the discipline injected into every model session)
- `aide-rseries-refactor` (template for engineering skills with research +
  flow + rules + pitfalls + threats + gates)
- `developer-code-and-credo` (the developer discipline that governs me)
- `hard-rules` (R1: append-only notes, R8: fail twice → research → skill → act)
- `project-governance` (the persistence protocol)
- `continuous-improvement-sop` (find → fix → encode → log loop)

## What this plan does NOT cover (out of scope, by design)

- The in-house model (Cipher 4B) training. That is the
  `aide-cipher-*` family of skills and the `production-readiness` skill in
  the global tree. The model is the engine's job; the engine is the IDE's
  job. Different lanes.
- The Android build pipeline (`aide-android-build`, `aide-phase8-android-build`).
  That is a separate product surface, deferred per the master roadmap.
- The Telegram bridge's deep polish. The `running: false` fix from
  `aide-aide-stack-launch-and-recover` is enough for Phase 1.
- Cloud handoff (`aide-cloud-handoff`, `aide-cloud-economy`). AIDE is
  offline-first; cloud is opt-in per `aide-master-roadmap` law #2.
- The from-scratch 139.7M cipher model. That is a different program;
  it has its own `aide-cipher-living-system` and `aide-cipher-self-healing-sop` skills.
