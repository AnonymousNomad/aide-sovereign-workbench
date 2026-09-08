# AIDE Architecture — Canonical Direction (FROZEN 2026-09-08)

Source of truth for what AIDE's architecture IS, and where every legacy feature goes next.

## 1. The Canonical Path (FROZEN)

Feature work happens **only** along this path, in this order:

```
browser/src              (UI: views, store, services, editor host)
  │  typed contract client (fetch + zod validation both directions)
  ▼
node/src                 (TS backend: routes/*.ts + services/*.mjs, zod .strict() at every edge)
  │  single edge into the product
  ▼
common                   (contracts: zod schemas, openapi.json, facade-route-map.json, fixtures)
  │
  ▼
capability services      (modelhub, git, lsp, dap, rg, training, etc. — off the registry, containers-strict)
```

Rules that are now non-negotiable:

1. **No new subsystem until the P0 acceptance path proves the existing system works end-to-end.** (Collaborator directive, 2026-09-08.) Add nothing that grows right-of-way for unproven machinery. Finish first.
2. **New route families** go through the full route-slice checklist (`C:\Users\Grey_\.agents\skills\aide-route-slice-sop\SKILL.md`): contract → service → route → openapi wiring → facade map → restart order → live verify through :4777.
3. **The facade (`scripts/facade.mjs`) is the single product edge** on :4777. It routes `/api/<prefix>` to the TS backend (port 4778) or the legacy backend (port 4779) per `common/facade-route-map.json`. Nothing else is exposed.
4. **The legacy stack (`app.js`, `daemon/server.mjs`) is a migration inventory, not a development surface.** Any new feature with a legacy-shaped ancestor gets a TS-era contract. Legacy routes are ported or consciously dropped via §4.
5. Every user-facing surface the product ships must be testable through the facade on :4777. "Works on 4777" is the only valid green.

## 2. Process Topology (VERIFIED live topology, 2026-09-08)

| Port | Process | Role |
|------|---------|------|
| 4173 | Vite dev server / frontend | UI (browser/src) |
| 4777 | `scripts/facade.mjs` | Product edge, dispatch per route map |
| 4778 | `node/src/server.ts` | TS backend (canonical) |
| 4779 | `daemon/server.mjs` | Legacy backend (migration inventory) |

Model engines run on private ports (8081–8099 range) spawned by the daemon; no engine is ever exposed to the product edge directly.

## 3. Route Ownership (VERIFIED count, 2026-09-08)

- `common/openapi.json`: 159 documented `/api/*` paths, 166 total routes, 540,524 bytes.
- TS backend route families (`node/src/routes/*.ts`, 37 families): agent, audit, byok, chat, closed-loop, commands, dap, dataset, desktop, editor-options, eval-export, exercise, experts, fs, git, handoff, hint, index, learner, lsp, memory, modelhub, models, notifications, onboarding, orch, problems, providers, rg, routing, session, system-map, tasks, telegram, training, workbenches.
- Facade map: 21 `/api/*` prefixes + 3 exact + 1 upgrade (`/ws`) → TS. Everything else defaults to **legacy**.
- **Legacy dispatch: 77 distinct URL patterns in `daemon/server.mjs`.** (The collaborator audit said "87 handlers"; the measured distinct `request.url` pattern count is 77 — 76 `/api/*` + `/health`.)

## 4. Migration Checklist — the 77 legacy handlers

Bucket definitions:

- **A = facade already routes to TS** (or exact-match in facade map): cutover candidate; verify shape parity through :4777, then flip in the map.
- **B = TS contract exists in openapi but facade defaults to legacy**: TS parity exists; flip the facade prefix + shape test.
- **C = legacy-only (no TS contract, no facade route)**: port to TS or consciously drop. Decide explicitly — silent legacy is forbidden.

### 4.1 Bucket A — facade already → TS (verified): 3
| Route | TS target |
|---|---|
| `GET/POST /api/file`, `POST /api/file/write` | /api/file exact → ts |
| `POST /api/chat` | /api/chat exact → ts |
| `/api/health*` | /api/health prefix → ts |

### 4.2 Bucket B — TS contract exists, facade still legacy (parity-check then flip): 27
| Route | TS contract |
|---|---|
| `GET /api/dap/status` | dap |
| `POST /api/dap/start` | dap |
| `POST /api/dap/stop` | dap |
| `GET /api/git/status` | git |
| `GET /api/git/diff` | git |
| `GET /api/git/log` | git |
| `GET /api/git/branches` | git |
| `POST /api/git/stage` | git |
| `POST /api/git/commit` | git |
| `GET /api/lsp/status` | lsp |
| `POST /api/lsp/start` | lsp |
| `GET /api/models/status` | models |
| `POST /api/models/import` | models |
| `POST /api/models/start` | models |
| `POST /api/models/stop` | models |
| `GET /api/providers` | providers |
| `GET /api/search` | index |
| `POST /api/search/replace` | index |
| `GET /api/session` | session |
| `PUT /api/session` | session |
| `GET /api/tasks` | tasks |
| `POST /api/tasks/run` | tasks |
| `POST /api/tasks/stop` | tasks |
| `GET /api/tasks/status` | tasks |
| `GET /api/training/status` | training |
| `POST /api/training/start` | training |
| `POST /api/training/stop` | training |
| `GET /api/workspace` | (workspace service surface) |

### 4.3 Bucket C — legacy-only (port or consciously drop): 47
| Route | Decision |
|---|---|
| `GET/POST /api/academy*` (5: session, certificate, check, complete, catalog) | **PORT** → TS exercise family exists already (exercise, hint). Extend to catalog/checkpoint. |
| `POST /api/arena/run` | **DROP** (no product surface) |
| `GET /api/artifacts` | **PORT** → map onto training export surface (`eval-export`, `training/exports`) |
| `GET /api/blueprint` | **DROP** (legacy overlay, superseded by routed MAP surface) |
| `GET/POST/PUT/DELETE /api/community*` (4) | **PORT** → community store CRUD contract (workbenches-adjacent) |
| `GET /api/dap/state`, `POST /api/dap/request` | **DROP** (raw JSON-RPC proxy; TS DAP uses typed sub-routes) |
| `GET /api/diagnostics` | **PORT** → TS problems/notifications surface |
| `POST /api/git/checkout` | **PORT** → git service |
| `POST /api/git/push` | **PORT** → git service |
| `GET/POST /api/handoff/*` (3) | **PORT** → handoff service exists in TS |
| `POST /api/lsp/notify`, `POST /api/lsp/request`, `POST /api/lsp/stop` | **DROP** (raw JSON-RPC proxy; TS LSP typed routes) |
| `GET /api/model/ready`, `POST /api/model/start`, `GET /api/model/status`, `POST /api/model/stop` (singular) | **DROP** (superseded by `/api/models/*` plural in TS) |
| `GET /api/models` | **PORT** → TS models list contract |
| `POST /api/models/profile` | **PORT** → models/fit surface |
| `POST /api/models/register` | **PORT** → models import contract |
| `POST /api/operator` | **DROP** (legacy orchestration; TS orch/agent supersede) |
| `POST /api/patch/apply` | **PORT** → editor/fs apply contract |
| `GET/POST /api/plugins*` (5) | **PORT** → extension host contracts (aide-arch-extensions surface) |
| `POST /api/providers/chat` | **DROP** (TS byok/providers chat supersede) |
| `GET/POST /api/replays` (2) | **PORT** → project-replay surface |
| `POST /api/terminal/run` | **PORT** → task-service/terminal contract |
| `GET /api/workspace/tree` | **PORT** → workspace service tree surface |
| `POST /api/workflow/apply`, `POST /api/workflow/plan` | **DROP** (legacy workflow; TS orch + agent decision supersede) |

### 4.4 Migration order (depends on nothing new being built first)

1. Flip **Bucket B** (27) — parity exists, pure facade-map + shape-test work. This removes 35% of legacy traffic with zero new subsystems.
2. Port **Bucket C** items marked PORT (28) behind TS contracts as part of the consumer acceptance path they serve.
3. DROP the 19 marked DROP — verify no `browser/src` caller references them first, then delete the legacy branch and its manager.
4. When Bucket C is empty, delete `daemon/server.mjs` legacy dispatch entirely and repoint the facade default to TS (full cutover).

## 5. What is NOT canonical

- `app.js` (1,691 lines legacy UI glue) — migration inventory.
- `daemon/server.mjs` (legacy dispatch) — migration inventory.
- Raw LSP/DAP JSON-RPC proxies in legacy — dropped, not ported.
- Any route that only answers on 4779 with no facade entry — candidates for DROP.
- Electron-as-final-shell (README says Tauri blocked → Electron, but `package.json` and `desktop/` carry Tauri config) — **decision pending, single shell only. Do not add a second shell.**

## 6. Test Tiering (target)

| Tier | Scope | Gate |
|---|---|---|
| 1 | typecheck + eslint | <15s |
| 2 | contracts drift (openapi.json vs zod) | <30s |
| 3 | arch battery (`tests/arch/*`) | <3m |
| 4 | browser contract + acceptance through facade :4777 | <5m |
| 5 | runtime: model engine + chat + BYOK capture | <10m |
| 6 | release: clean-clone install + consumer journey | per release |

CI runs 1–4 always. 5–6 on release/PR-marked jobs and `AIDE_FULL_BATTERY=1` pre-push.

## 7. Capability Certificate (evidence doctrine)

Every shipped claim carries a verification artifact in `docs/evidence/`: route, test output, live :4777 probe, screenshots/GIF, logs. "Should work" is not a certificate. (See `verification-complete`.)