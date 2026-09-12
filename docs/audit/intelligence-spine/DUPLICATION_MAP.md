# Duplication / Complexity Map

This is a routing and authority classification, not a deletion plan. No module is declared globally dead merely because the canonical caller does not use it.

| Concern | Implementations | Classification | Bounded direction |
|---|---|---|---|
| Frontend | typed browser; root app.js | Intentional compatibility after 1C | typed is normal owner; legacy explicitly launched; preserve until capability parity |
| HTTP edge | facade compatibility format; TS envelope; legacy bare routes | Intentional compatibility | preserve versioned serialization, audit actor authority at edge and backend |
| Conversation | stream; enriched non-stream; legacy ModelManager/Operator | Dangerous split-brain for intended context semantics | common request/context pipeline with explicit direct-mode distinction |
| Resident/workflow | Resident summary; AgentLoop; standalone harness; legacy Workflow | Migration shadow plus competing live paths | retain advisory Resident; make one workflow endpoint canonical |
| Agent tools | XML agent loop; direct tools; terminal/tasks/fs REST | Dangerous split authority | one operation authorization contract with appropriate human UI intent |
| Git | TS GitService; legacy inline runGit; shadow checkpoint Git | Intentional compatibility + dangerous policy divergence | preserve TS service; share policy; scope checkpoint ownership |
| LSP | TS LspManager; daemon LspManager; browser bridge/providers | Compatibility managers; browser is client, not duplicate backend | TS owns mapped routes; prove remaining legacy consumers before retirement |
| DAP | TS manager/routes; legacy manager/routes | Intentional compatibility / migration shadow | protocol ownership before deletion; execution permission shared |
| Providers | ProviderService, BYOKService, legacy ProviderManager | Dangerous consent/state split | one revocable network/inference policy; adapters may retain protocol differences |
| Local models | TS ModelRuntime, legacy ModelManager | Compatibility + shared-process ownership risk | preserve identity/adoption checks; coordinate lifecycle, do not kill foreign engines |
| Role routing | role chat selector; BYOK plan/act; standalone reason/build/verify; expert/Telegram heuristics | Dangerous implicit semantics | logical roles with per-invocation facts, no automatic concurrent models |
| Skills | runtime excerpt loader; scaffold/credo; skills/developer-discipline helpers; packed library | Necessary layers plus shadow utilities | one selected methodology manifest, no duplicate giant prompt |
| Memory | chat history, recall sessions, blocks, bus, digests, patterns, rollups | Different purposes but missing ownership contract | classify stores; prevent false facts and stale cross-path semantics |
| Verification | Agent policy; Veritas; checks; sandbox; desktop assertions; text gates | Dangerous split truth | independent required evidence plus separate execution/review/heuristic labels |
| Events | EventHub; cipher-state; egress journal/log; artifacts; trajectories | Different delivery/durability needs, incomplete correlation | shared IDs and terminal reconciliation; do not collapse guarantees |
| Subagents | schemas/routes and null-service tests | TEST-ONLY / unregistered migration shadow | do not advertise live; integrate only after authority/reviewer protocol |
| Desktop policy model | hook definition/tests vs actual Telegram/control path | TEST-ONLY / shadow | reconcile confidence≠authority and proposal≠execution before activation |
| SandboxFlow | scripts/batteries; apply helper | SHADOW, not a live daemon route found | quarantine; repair apply-equivalence before any product adoption |
| Selfimprove/watchdog | TS startup scheduler + repo-root script + workspace status route | Dangerous ownership mismatch for non-repo workspaces | pass explicit workspace and publish runner outcomes; no training expansion |

Evidence anchors: [route ownership](../../../common/facade-route-map.json), [composition](../../../node/src/openapi.ts), [legacy server](../../../daemon/server.mjs), [AgentLoop](../../../node/src/services/agent-loop.mjs), [harness](../../../harness/orchestrator.mjs), [TS LSP](../../../node/src/services/lsp.ts), [legacy LSP](../../../daemon/lsp-manager.mjs), [memory](MEMORY_AUDIT.md).

## Complexity cost

The costly duplication is not merely duplicate files. It is multiple interpretations of authority and truth: a tool requires a pending decision in one path, a body boolean in another, and no decision in a third; a context-rich non-stream chat coexists with the ordinary stream that bypasses it; verified means different things to different evaluators.

Preserve distinct platform/protocol adapters. Consolidate policy and evidence semantics before removing code. “Newer TS” is not a parity certificate. No deletion is proposed as the first repair.

