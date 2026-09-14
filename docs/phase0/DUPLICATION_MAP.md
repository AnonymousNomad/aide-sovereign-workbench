# Phase 0 — duplication and ownership decisions

Baseline `536d089`. These are proposed dispositions, not deletions or migrations performed during the audit.

| Concern | Competing paths | Disposition | Evidence/exit condition |
|---|---|---|---|
| UI | Root HTML/app.js; browser/src; desktop staged root UI | KEEP legacy as explicit compatibility path; MIGRATE canonical launch only after parity | start.mjs/root HTML/Vite/prepare.mjs; browser lacks agent/Git/terminal/DAP parity today |
| API serialization | TS {ok,data}; facade bare/legacy error shape; browser assumes TS envelope | ADAPT at facade with explicit versioned format selection; KEEP legacy behavior until retired | Runtime real-client BAD_RESPONSE reproduced; never flip only Vite port |
| Backend dispatch | node/src routes vs daemon/server.mjs handlers | KEEP TS owner; ADAPT required legacy handlers; DELETE LATER only with consumer/parity proof | 31 registered TS operations still select legacy; existing architecture inventory is stale |
| Agent execution | agent-loop XML tools; standalone harness unified diffs; legacy workflow plan/apply | KEEP agent-loop as execution authority; ADAPT reusable verifier/scaffold libraries; DEPRECATE independent product executor after parity | app.js agent calls and workflow calls coexist; harness-real-model imports standalone harness |
| Orchestrator naming | `/api/orch/context`; Resident; agent-loop | KEEP distinct responsibilities, no new orchestrator subsystem | orch is snapshot-only; Resident is advisory/UI; loop executes |
| Skill loading | Existing skills-loader vs handoff's proposed new skill-router | KEEP/repair loader, extend one selection implementation later | Async factory bug reproduced; no parallel scorer/service in Phase 1 |
| Model management | TS ModelRuntime/ModelRouter; legacy model manager; manifest/profile metadata | KEEP TS runtime and routing; ADAPT legacy model endpoints while required | Map plural models to TS; local role health and context checked there |
| Hardware knowledge | hardware.ts probe; hardware-profile heuristic; orch hardware snapshot; model-fit | KEEP shared probe; ADAPT policy later in P3 | No benchmark justifies replacement now |
| Git | TS git-service/routes; daemon Git handlers; root UI | KEEP TS execution; MIGRATE frontend consumer/parity | `/api/git` maps TS; preserve working legacy UI until equivalent flow |
| LSP/DAP | TS managers plus raw compatibility routes; daemon managers | KEEP TS manager per process; ADAPT raw callers; DELETE LATER | Current openapi still registers notify/request/stop and state/request; old DROP labels are not current reality |
| Tasks/terminal | TS task service and terminal route; tasks manager/daemon/root UI | KEEP mapped TS owners; MIGRATE consumer | No removal before run/status/stop/output parity and owned-process cleanup |
| Memory | cipher-state, memory-spine, Helix, chat recall, legacy consumers | KEEP shared modules; reconcile scheduling/provenance | Do not invent another memory store; fix ordering only when scoped/proven |
| Audit/events | durable cipher-state JSONL; WS EventHub; egress journal; trajectories | KEEP complementary channels; ADAPT schema/persistence failure reporting | Verification WS event rejected; persistence best-effort; avoid another event bus |
| Verification | Veritas core; loop tool-success stamp; standalone harness parse check; multiple acceptance scripts | KEEP checks; separate evidence levels and correct overclaims | Both mocked and real-model scripts can pass without completed coding transaction |
| Closed loop | TS server schedule; status route described as daemon-driven | KEEP TS ownership, correct docs | server.ts main starts schedule; status configuration is not liveness proof |
| Replay | replay-store CRUD; agent trajectories; external GhostCode handoff | KEEP local artifacts; ADAPT one provenance system later | External GhostCode commit is not evidence of integration into this repo |
| Plugin/community/replay state | TS route wrappers call legacy implementation modules, sometimes same files | KEEP explicit adapters; review single writer before daemon retirement | Sharing a tested module is reuse, not automatic debt |
| Packaging | Tauri source/config; Electron discussion; copied frontend | KEEP current artifacts for inspection; DEFER shell choice and migration | No second shell or generated directory replacement during Phase 0 |

Preserve the contracts, facade routing boundary, workspace jail, human approval session flow, local provider abstractions, existing editor code, tests, memory/audit modules and all 274 skill entries. Preserve the four untracked operator corpus scripts. No DEAD designation or deletion is justified solely by duplicate filenames or outdated documentation.
