# Phase 0 — capability matrix

Baseline `536d089`, audited 2026-09-12. **Status describes the scoped capability, not the existence of its files.** LIVE requires a directly observed path for the stated scope. PARTIAL has material integration/evidence gaps. SHADOW exists behind a non-default route or separate implementation. TEST-ONLY is established only in a fixture/standalone test. DEAD requires proof of no required consumers; UNKNOWN is deliberately unverified. No subsystem is nominated for deletion from this matrix.

Evidence levels: S = source inspection; U/I = current unit/integration checks; R = current isolated runtime; H = historical artifact/journal only. No capability here carries fresh real-model or GUI acceptance certification.

| Subsystem / scoped capability | Status | Evidence | Missing before broader product claim |
|---|---|---|---|
| Default launch and frontend ownership | PARTIAL | S: start.mjs serves legacy HTML; Vite is independent | One canonical launcher, feature-preservation gate, lifecycle probe |
| Canonical browser editor/workspace/session/search | SHADOW | S: browser/src/main.ts, editor/*, session.ts; not default launch | Browser runtime, reload, dirty-buffer recovery and facade compatibility |
| Product facade routing | PARTIAL | R: actual facade/TS fixture; U/I: facade tests | Typed consumer envelope, missing route families, transport integration |
| TS health through facade | LIVE | R: GET health through actual facade returned 200 | Scope is health only, not whole product readiness |
| Typed browser API through facade | PARTIAL | R: real client rejects successful health as BAD_RESPONSE | Canonical wire-format contract and legacy compatibility |
| Agent session start/status and loop | PARTIAL | R: real routes/loop with scripted chat capture | Real local model, UI consumer, approval/evidence integrity |
| Skill registry/read/selection | PARTIAL | R: loader returns matching fixture skill; S: 274/274 registry paths exist | Async composition fix, error state, provenance/context budget/conflicts |
| Production skill injection | PARTIAL | R: direct skill matches; sentinel absent from model input, no skill error | Correct factory declaration/await and production-path regression |
| Session approval mechanism | PARTIAL | S: loop pauses; historical P0 journal; separate current bypass | Uniform enforcement including direct tools/sandboxes, audit proof |
| Direct tool endpoint approval | PARTIAL | R: approved:false plus string argument writes fixture file | Strict trusted approval handling and negative tests before use |
| Verification stamps | PARTIAL | R: requested code absent, zero tests, yet verified=true | Separate execution success from requirement verification |
| Agent WebSocket verification delivery | PARTIAL | R/S: emitted shape fails AgentStreamEvent; rejection logged | Contract update and real subscribed-client assertion |
| General WebSocket transport | LIVE | U/I: mapped upgrade test passes | Scope is transport; not every emitted event contract |
| Audit and trajectories | PARTIAL | R: fixture artifacts; S: audit trail/reads | Durable-write failure visibility, correlation, bounded replay data |
| Resident assistant | PARTIAL | S: wired service + browser surface + agent provider | Runtime user-state and degradation acceptance |
| `/api/orch/context` | PARTIAL | S: situation snapshot route | Measured freshness/egress semantics; not an executor |
| Standalone harness orchestrator | SHADOW | S: distinct import path/protocol; H: real-model harness artifact | Do not promote as live agent-loop proof |
| Planner/coder/reviewer roles | UNKNOWN | Architect/editor option and role vocabulary exist | Governed transitions/verdicts/repair not established |
| Micro-experts | PARTIAL | S: shared service and features; H: prior expert tests | Local-agent advisory guard and emitted provenance |
| Memory / Helix | PARTIAL | S: digest/cascade/recall; H: helix audit 23 tests | Ordering, classified writes, provenance and current real workflow |
| RAG / project brain | PARTIAL | S: index/chunks/BM25/optional embeddings | Agent context usage and retrieval quality measured on task |
| Local model runtime | PARTIAL | S: load/start/stop/context/health; H: real GGUF harness | Canonical model/tool/workspace transaction; not rerun here |
| Hardware profile | PARTIAL | S: service + map; H: 3/3 and live payload | Fresh probe/compatibility evidence across profiles |
| Model recommendation | PARTIAL | S: fixed role IDs, total-RAM weight estimate | Policy/backend/context/free-memory evaluation (P3, deferred) |
| Model hub acquisition/import | PARTIAL | S: modelhub/model routes and validation services | Lifecycle, opt-in acquisition, actual registered model acceptance |
| BYOK/providers | PARTIAL | S: consent/credential services; H: hermetic P0 provider | Optional adapter only; no external requests in this audit |
| Git | PARTIAL | S: TS service + map; H: isolated 11/11 and P0 | Canonical browser consumer/parity/recovery acceptance |
| LSP | PARTIAL | S: TS manager, browser bridge, map; H: P0 | Browser diagnostics/completion across canonical facade launch |
| DAP | PARTIAL | S: typed + raw compatibility routes, map; H: prior tests | Canonical UI debug journey, ownership and stop lifecycle |
| Terminal and tasks | PARTIAL | S: TS routes/services, legacy UI; H: P0 | Canonical UI parity, cancellation/process cleanup |
| Commands/keybindings/settings | PARTIAL | S: TS routes; some command handlers return dispatch metadata | End-to-end UI action, persistence, shortcut conflicts |
| Workspaces/sessions/recovery/handoff | PARTIAL | S: stores, checkpoints, handoff routes; H: P0 restart | Canonical dirty editor/session recovery + trajectory durability |
| Workbench bundles/worktrees | SHADOW | S: browser consumer + TS routes; map defaults legacy | Contract and facade parity before visibility |
| Onboarding | SHADOW | S: routes exist but map defaults legacy | Real first-run sovereign coding journey (P5) |
| System map | SHADOW | S: snapshot exists, facade map omits family | Reconcile map and ensure state describes executed paths |
| Learner/training | PARTIAL | S: learner mapped TS; training retains legacy default | Distinguish product training from operator corpus lane |
| Plugins/extension hosting | PARTIAL | S: TS wrapper reuses plugins/manager; H: prior plugin acceptance | Capability isolation/lifecycle; no VS Code-extension parity claim |
| Telegram | PARTIAL | S: privileged adapter routes and service | No connection or external messaging tested; remains opt-in |
| Desktop control | PARTIAL | S: grants/panic/approval policy layers | Current full privileged-action acceptance; preserve protections |
| Veritas/watchdog/selfimprove | PARTIAL | S: TS scheduler/status, harness checks; R: false verification | Correct evidence policy before closed-loop trust |
| Ghost/failure replay | PARTIAL | S: replay CRUD + audit + trajectories | No proven deterministic failure reconstruction |
| Doctor/self-heal | PARTIAL | S: diagnostics vs process-starting repair scripts | Do not confuse process availability with feature integrity |
| Pre-push/CI | PARTIAL | S: actual hook, CI workflows; U/I: 48 focused tests + tsc | Push-range coverage; current full battery; known defect gates |
| Desktop packaging/release | UNKNOWN | S: Tauri/staging/CI, version preflight | Install/upgrade/uninstall/data-preservation/offline evidence |
| Edge/mobile | UNKNOWN | Direction only for current scope | P5 platform proof of concept; no desktop-shrink assumption |

Current verification outputs: [gates.json](evidence/gates.json), [runtime-probe-extended.json](evidence/runtime-probe-extended.json), [inventory.json](evidence/inventory.json). Historical claims are not silently upgraded by current narrow tests.
