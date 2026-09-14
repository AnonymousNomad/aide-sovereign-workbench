# Phase 0 — system map

Audit date: 2026-09-12 Asia/Katmandu (raw evidence timestamps use UTC). Baseline: `536d08996d269d86aef997c5a514cd498c5686b8`. Scope: reconciliation, not architecture modification. Read [REPORT.md](REPORT.md) for decisions and evidence limits.

## Actual launch paths

```text
npm start -> scripts/start.mjs
  4173: repository-root static server -> index.html -> app.js
        app.js HTTP API -> 127.0.0.1:4777
  4777: scripts/facade.mjs -> common/facade-route-map.json
        mapped HTTP routes -> TS :4778; default -> legacy :4779
        TS JSON success envelope removed; errors rewritten to legacy shape
        /ws -> TS :4778; SSE streams forwarded
  4778: node/src/server.ts -> openapi.buildRoutes -> routes/services
  4779: daemon/server.mjs -> legacy managers

Separate Vite frontend: browser/index.html -> browser/src/main.ts
  development :5173; preview :4173
  /api and /ws proxies -> :4778 directly
  services/api.ts requires the TS envelope {ok, data}

Desktop: desktop/tauri.conf.json -> frontend/ staging
  desktop/prepare.mjs copies root index.html + app.js + styles.css
  desktop/src/main.rs attempts packaged stack-launcher.mjs
  packaged lifecycle has NOT been exercised in this audit
```

Sources: [start.mjs](../../scripts/start.mjs), [root HTML](../../index.html), [app.js](../../app.js), [Vite](../../browser/vite.config.ts), [facade](../../scripts/facade.mjs), [desktop staging](../../desktop/prepare.mjs), [desktop launcher](../../desktop/src/main.rs).

These are source-traced launch configurations. Runtime probes used temporary workspaces and ephemeral ports, not a live production instance on 4173/4777. No claim of default-GUI acceptance is made.

## API ownership

The runtime build registered **204 unique method/path operations**: 203 documented operations across 193 OpenAPI paths, plus raw `/api/openapi.json`. The facade map has 39 prefixes, five exact entries, and one WebSocket upgrade entry. Of the registered TS operations, **173 select TS and 31 select legacy** under the current map. No duplicate method/path registrations were observed inside this TS build. This does not imply the TS and legacy implementations are deduplicated.

| Registered TS family still selecting legacy | Operations | Consequence |
|---|---:|---|
| `/api/chat` descendants | 3 | Streaming and history miss the TS path; only exact `/api/chat` is mapped |
| `/api/training` | 13 | Legacy status/start/stop overlap; other TS functions cannot be assumed reachable |
| `/api/workbenches` | 5 | Browser bundle consumer bypasses this discrepancy via Vite today |
| `/api/workbench` | 4 | Worktree operations need ownership/parity decisions |
| `/api/onboarding` | 4 | TS implementation alone does not establish product-edge availability |
| `/api/system-map` | 1 | Introspection route omitted from map |
| `/api/openapi.json` | 1 | Raw TS route omitted from map |

Full method/path inventory: [runtime-probe-extended.json](evidence/runtime-probe-extended.json). Counts and families: [inventory.json](evidence/inventory.json). The legacy target in the isolated facade fixture pointed to its TS server to avoid launching another daemon; route ownership is computed from the actual map, not a claim that all 31 legacy destinations were live-probed.

## Execution and context

| Concern | Current owner/path | Important boundary |
|---|---|---|
| Stateful coding loop | `routes/agent.ts` -> `services/agent-loop.mjs` -> parser/tools | Legacy app.js calls it; TS browser currently exposes chat, not agent start/decision |
| Chat | `routes/chat.ts` -> ModelRouter -> ModelRuntime/provider | Streaming chat is not the governed coding loop |
| `/api/orch/context` | `services/orch-context.mjs` | Read-only situation snapshot, not an execution authority |
| Resident assistant | `routes/resident.ts`; browser resident panel | Workspace observations injected separately; preserve advisory role |
| Skills | `createSkillsLoader` in `openapi.ts` -> loop skillProvider | Async factory not awaited; exception swallowed by resolveStringProvider |
| Micro-experts | Single expertsService in buildRoutes; `harness/micro-experts.mjs` | Advisory machinery exists; local agent advisory guard depends on provider override (source concern) |
| Models | `services/model-router.ts`, `model-runtime.ts` | Roles/health/context exist; coder/planner/reviewer governance not yet established |
| Tools | `services/agent-tools.mjs` | Session approval loop differs from direct `/api/agent/tool` dispatch |
| Standalone harness | `harness/orchestrator.mjs` | Separate diff/verdict protocol, not the live XML-tool agent contract |

Source anchors: `node/src/openapi.ts:428`, `:649`, `:682`; `node/src/routes/agent.ts:82`; `node/src/services/agent-loop.mjs:175`, `:263`, `:378`; `browser/src/services/api.ts:233`; `app.js:396`.

## State, events and durable evidence

- Workspace service, session store, task service, Git service and LSP/DAP managers are composed in `node/src/openapi.ts`. Community/plugin/replay stores retain legacy implementation modules as adapters; shared persistence is intentional but concurrent writers need ownership review.
- Agent session map is in memory. Terminal-state artifacts go to `.aide/trajectories/*.traj.json` and `.aide/verifications/*.verification.json`. These writes are asynchronous and errors are swallowed; a terminal status is not proof of durable evidence.
- `services/audit-trail.mjs` writes through `harness/cipher-state.mjs` to `.aide/cipher-state.jsonl`. `/api/audit/events`, `/session`, `/bundle` expose records. Writes are best-effort and unsupported event types are discarded.
- `node/src/events.ts` validates channel payloads before WebSocket delivery. `AgentStreamEvent` omits `verification`, although the loop emits it. The audit reproduced schema rejection and observed its log entry.
- Memory uses `harness/memory-spine.mjs`, Helix join/retention and `routes/memory.ts`. Digest reads trigger refresh; session completion also triggers digestion. `digest()` starts the Helix cascade before awaiting new day digests, unlike `listDigests()`; freshness requires further testing. Chat memory recall is separate from proof of skill-guided coding.
- RAG uses `index-service.mjs`, chunking/BM25, optional embedding gate, and watcher wiring. With no embeddings URL, lexical retrieval is the fallback. No index-content export or external embedding calls were performed.
- BYOK egress journal is `.aide/egress/journal.jsonl`; situation context also reads `.aide/logs/egress.log`. Reconcile meanings before presenting a unified privacy count.
- Closed-loop scheduling is in **TS server main** (`node/src/server.ts:244`): boot kick plus six-hour schedule for `scripts/selfimprove.mjs`. The handoff's legacy-daemon ownership statement is stale. The status route reports configuration/logs, not proof that a watchdog has run successfully.

## Verification and release surfaces

`scripts/run-arch.mjs` serializes the architecture suite; Windows omits force-exit and uses `http-close-shim.mjs`. CI's bounded execution is in `.github/workflows/ci.yml`; `scripts/run-bounded-arch.mjs` does not exist. `scripts/acceptance-p0.mjs` creates its own stack and scripted BYOK provider. `scripts/acceptance-real.mjs` exercises the legacy daemon, not the proposed canonical browser journey. `scripts/harness-real-model.mjs` exercises the separate harness and scores parse/Veritas results before application.

Root `pre-push` defaults to staged `.mjs` syntax checks; full architecture testing is opt-in with `AIDE_FULL_BATTERY=1`. `core.hooksPath` points to `E:\aide-sovern-workbench`, a verified junction to this repository, so that spelling is not a broken hook path. A staged-file check at push time does not cover already-committed changes when the index is clean.

CI uses Node 26; desktop CI declares Node 22. Desktop shell, install/upgrade/rollback/uninstall, and clean-clone offline acceptance remain unverified. Do not run staging as a diagnostic: it recursively replaces generated directories.
