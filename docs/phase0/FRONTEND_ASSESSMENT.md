# Frontend reconciliation against the Covert north star

Governing destination: [Covert Coder north star](../COVERT_CODER_NORTH_STAR.md), especially sections 49–50. This is source/integration analysis, not a rendered UI evaluation or visual redesign. Neither frontend has passed a fresh complete GUI acceptance journey in this audit.

## Recommendation and migration cost

Preserve working behavior in the root UI while using the existing typed browser editor/client modules as the proposed component foundation. **Do not switch default startup merely because browser/src is designated canonical.** The actual default switch requires a parity certificate. Do not create a third frontend or a second orchestration system.

This recommendation follows identifiable migration work: the legacy app has current agent start/approval polling, model import/start controls, terminal command submission, Git controls, skills browsing and privileged-adapter controls. The typed browser has separated editor/session/LSP/chat/provider modules and a shared validated client, but its main/shell do not wire equivalent agent, terminal, Git or DAP workflows. Its chat and Resident are separate overlays. A launch-only change would lose reachable controls and break facade responses.

Immediate preservation costs no surface migration. Promoting browser/src requires at least these independently verified work packages: facade serialization/routing; agent/approval consumer; terminal/tasks; Git; debug; model management; session/layout parity. These are concrete boundaries, not elapsed-time estimates. No implementation spike or user task timing has established a numeric cost comparison. Accordingly this audit proposes reuse boundaries and a gate, not an unsupported claim that one full rewrite is cheaper.

Sources: `app.js:396` agent start, `:506` workflow fallback, `:1244` terminal, `:1267` Git; `index.html`; `browser/src/main.ts`; `browser/src/shell/shell.ts`; `browser/src/editor/{host,groups,lsp-bridge}.ts`; `browser/src/services/{api,session,ws}.ts`; `browser/src/chat/chat.ts`.

## Required candidate comparison

“Potential” below means the existing web/module structure can be extended; it is not demonstrated feature completion.

| North-star question | Root index.html/app.js | browser/src | Decision / evidence needed |
|---|---|---|---|
| Real dockable Resident chat? | Conversation/agent controls exist; docking not demonstrated | Streaming chat and Resident summary are separate EXP/RUN overlays, no persistent dock | Reuse conversation and agent contracts; one dockable Resident later, no third chat service |
| Editor-first layout? | Editor and development controls exist in coupled shell | Dedicated editor host, tabs/groups and LSP modules; overlays occupy editor column | Preserve editor modules; prove simultaneous editor/Resident layout later |
| Canonical facade? | API constant targets 4777 and consumes bare payloads | Vite targets 4778; envelope-dependent client | Actual failure reproduced; fix explicit wire-format adapter before cutover |
| Live workflow events? | Agent status/approval polling, legacy workflow fallback | Shared WS transport, but no agent workflow consumer in main | Reuse WS/EventHub and session IDs; no new independent workflow engine |
| Model state? | Model management/import/start controls | Chat model picker/status/routes/context meter | Reuse lifecycle API; do not equate installed with running or ready |
| Role state? | Mode/delegation concepts, no full three-role protocol | No planner/coder/reviewer workflow state model | Needs governed role events, not three chat panels |
| Skill selection? | Registry browser/search; selection provenance absent | No task-selected skill view | Current injection is broken; fix before any loaded-skills indicator |
| Memory provenance? | Some state/metrics surfaces, no verified recall inspector | Resident summary, no scored recall/provenance inspector | Extend memory/audit contracts, not another store |
| Verification evidence? | Existing status UI cannot cure backend false stamp | Event schema drops verification; no full gate-evidence panel | Backend truth first; distinguish simulated/runtime/acceptance evidence |
| Approval flows? | Agent approval polling and privileged controls | No equivalent agent decision integration in main | Preserve policy and controls; direct-tool bypass is release-blocking |
| System Health? | Several status badges | Health/LSP/Resident status modules | Need per-subsystem state/reason/freshness; health HTTP 200 is insufficient |
| Ghost timelines? | Replay-related backend available; no reconstructed task timeline proven | No timeline consumer established | Reuse audit/trajectory IDs and structured failures; P4/P5 work |
| Resizing/layout persistence? | Some local preferences/session state; full docking persistence unknown | Editor groups and session splits exist; arbitrary dock geometry not in SessionFile | Extend versioned session/layout schema later; preserve hot-exit data |
| Tablet evolution? | Coupled DOM/handlers mean more separation work | Modules offer reuse boundaries, not a proven responsive shell | Shared services/state; platform-specific capabilities remain explicit |
| Preserve vs migrate cost/safety? | Broad existing reachable controls, coupled state and fallback execution | Better-separated reusable modules, significant functional parity gaps | Preserve now; migrate bounded behavior with evidence. No wholesale winner certified |

## Architecture that would obstruct the destination

1. Persisting separate chat, Resident and workflow executors would prevent one inspectable conversation. Keep UI modes distinct from backend authority.
2. Blindly changing Vite's port without a wire-format and route-coverage decision would break the canonical client. The workbenches panel has its own fetch helper and envelope assumptions; it must use the same client boundary.
3. Keeping workflow truth only in frontend polling/local variables would obstruct reconnect, tablet control and Ghost replay. Stable backend workflow/task/event identities must eventually own state.
4. Missing skills, discarded verification events, unqueryable audit types and best-effort persistence make truthful status indicators impossible. Fix evidence before visual state.
5. Tying skill/model metadata or UI labels to fixed models would obstruct single-model roles and hardware-aware policies. Preserve identity/role separation.
6. Treating sandbox naming or model arguments as permission would undermine every approval surface. Preserve one backend permission authority across Resident, inline actions, Telegram and direct tools.
7. Hardcoding multiple UI-specific response and session formats forever would make shell independence expensive. Use an explicit compatibility boundary and versioned state.
8. Rendering directly from unrelated polls without correlation/freshness would make health and privacy look more certain than they are. Compose views from existing canonical events/state, with UNKNOWN/DEGRADED represented.

## Future API/event contract homes — identify only

All new contract work remains subject to its own implementation authorization. Existing files are reuse points, not claims that they already meet these requirements.

| Future surface | Existing home | Gap / required semantics |
|---|---|---|
| Chat and streaming output | `contracts/chat.ts`, `routes/chat.ts`, browser chat | Facade coverage, correlation/cancellation/errors, attach-context provenance |
| Workflow state | `contracts/agent.ts`, loop session state, handoff | Objective/plan/dependencies/phase/state/reconnect durability; one workflow ID |
| Role transitions | agent modes/architectEditor; `contracts/routing.ts` | Planner/coder/reviewer transitions, model assignment, verifier separation |
| Selected skills | skills-loader; audit `primary_skill` metadata | Selected set, reason, priority, version/hash/source, dependencies/conflicts/cost |
| Memory recall | `contracts/memory.ts`, resident context, memory-recall service | Classified facts, scored recall reason, provenance, pin/expire/edit policy |
| Tool execution | `contracts/agent.ts`, agent-tools | Correlate proposal/approval/execution/result; bounded output and stable action ID |
| Approvals | AgentApproval/Decision, desktop grants/panic | Trusted scope/duration/actor; strict denial/expiry/cancel; no argument-based bypass |
| Diffs and file provenance | `contracts/patch.ts`, Git, agent previews/checkpoints | Request-to-diff linkage, base hash, ownership/reason, review and revert semantics |
| Verification | Veritas, agent verification files, audit | Required gates vs executed gates, evidence level, exit codes, artifacts; no false verified |
| Model lifecycle | `contracts/models.ts`, `routing.ts`, `modelhub.ts`, model event | Installed/running/healthy distinct; source/backend/resources/context and role mapping |
| Hardware | `contracts/hardware.ts`, shared hardware.ts | CPU architecture/storage/backend compatibility and measured/estimated distinction |
| Health | `health.ts`, `resident.ts`, `system-map.ts`, closed-loop status | Per-component state/reason/freshness, disabled vs unknown vs failed |
| Audit | `contracts/audit.ts`, audit-trail/cipher-state | Align write types with read filters; verification/resident currently missing in filter enum |
| Ghost timeline | `contracts/replays.ts`, trajectories and audit | Causal ordering, environment/model/skill references, before/after, replay limitations |
| Network activity | BYOK consent, egress journal, provider adapters | Local/offline/available/remote-active distinctions; attributable request scope/cost |
| Editor and context actions | file/workspace/editor/LSP contracts | User-attached vs retrieved scope; selection/symbol identity; same orchestrator |
| Terminal/tasks/debug | terminal/tasks/DAP/LSP contracts | Sessions/cwd/interrupt/exit/diagnostics; platform capability matrix |
| Layout and settings | `contracts/session.ts`, commands/settings/keybindings | Dock geometry/versioned migration, keyboard access, user preferences |

Event architecture constraint: extend `node/src/events.ts` and existing durable audit infrastructure with versioned, correlated records; do not create a separate UI event bus or polling backend for each panel. Ephemeral streaming deltas and durable engineering events may have different retention, but must share task/session/action identity.

## Migration acceptance before changing the default

Run the actual proposed launch command, open a local fixture project, edit/save/reload a dirty buffer, use search/LSP, run/interrupt a terminal task, inspect Git changes, exercise relevant debug controls, select/start/stop one local model, send a Resident request and approve/reject a change. Assert the facade path, WS/SSE delivery, durable state and cleanup. List any intentionally deferred capability explicitly and retain its current access until a product decision approves removal. No visual branding work is required for this gate.
