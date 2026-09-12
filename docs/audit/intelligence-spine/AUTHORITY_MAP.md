# Authority Map

Baseline: bdbaff6. LIVE here means production source registration is traced; it does not automatically mean live-model acceptance.

| Intended authority | Actual owner(s) | Status and boundary |
|---|---|---|
| Conversation / continuity | `browser/src/chat/chat.ts` history and `chat-store.ts`; Resident summary separate | DUPLICATED / PARTIAL. Chat sends transcript; Resident owns no conversation. |
| Resident | `browser/src/resident/resident.ts:createResidentPanel`; `routes/resident.ts:createResidentService` | LIVE adviser: summary/context/push-summary/decisions. In-memory lastSummary/decision list, no model. |
| Workflow | `agent-loop.mjs:createAgentLoop`; legacy `operator.mjs`, `workflow.mjs`; standalone `harness/orchestrator.mjs` | DUPLICATED. AgentLoop canonical only for agent API. No global workflow owner. |
| Execution permissions | AgentLoop approval promise/decide; direct tool deny; WorkspaceService booleans; route-local terminal policy; desktop grants; plugin trust | DUPLICATED / BYPASSABLE. No authenticated actor or unified operation capability. |
| Inference | ModelRouter + ModelRuntime, ProviderService, BYOK service, legacy ModelManager/ProviderManager | DUPLICATED. Local default is enforced for role routing, not universal egress. |
| Methodology | `skills-loader.mjs`, scaffold, static credo; other skill libraries | PARTIAL. Agent excerpts are live; no complete dependency/conflict/maturity authority. |
| Memory | ChatStore, memory-recall, blocks, cipher-state, memory-spine, Helix patterns/rollups | DUPLICATED / PARTIAL. Different readers and retention policies, no central fact precedence. |
| Verification | Agent required-evidence policy, generic Veritas/check runner, sandbox, desktop autoAssert, chat gates | DUPLICATED. Agent honest but cannot pass; generic proof can be fabricated through weak inputs. |
| Provenance | EventHub, cipher-state/audit, trajectory/verification files, egress logs, artifacts, chat history | PARTIAL. Acceptance, subscriber delivery and disk persistence are distinct. |

## Runtime map

```text
npm start / Vite / staged Tauri -> typed browser
  Resident panel -> /api/resident/* -> deterministic probes
  Chat panel -> /api/chat/stream -> ModelRouter -> local runtime OR ProviderService
  Shared API client -> facade 4777 -> TS 4778 for mapped routes
                                  -> legacy 4779 for unmapped routes

Other / optional callers:
  /api/chat -> scaffold + RAG + recall + gates -> ModelRouter
  /api/agent/start -> AgentLoop -> XML parser -> approval -> agent-tools
       |-> Resident context + skill excerpts
       |-> local role "chat" OR BYOK plan/act closure
       |-> terminal trajectory + always-unverified policy -> audit/events
  /api/operator, /api/workflow/* -> legacy Operator/Workflow -> legacy model manager
  Telegram /ask -> TelegramBrain -> ModelRouter -> desktop proposal -> YES -> desktop.act

Standalone/test infrastructure:
  createHarness -> reason/build/verify providers -> Veritas -> non-applying proposal
  sandbox-flow -> scratch code + command runner -> optional raw real-file apply
  desktop-policy-hook -> confidence-labelled proposal (no actual executor)
  subagent route factory -> test-only registration, not buildRoutes
```

Sources: [startup](../../../scripts/start.mjs#L192), [facade map](../../../common/facade-route-map.json), [composition](../../../node/src/openapi.ts#L319), [agent setup](../../../node/src/openapi.ts#L430), [chat](../../../node/src/routes/chat.ts), [legacy](../../../daemon/server.mjs#L482), [Telegram](../../../node/src/openapi.ts#L603).

## Authority crossings

- A model is not an HTTP caller by itself. The local agent's parsed writes correctly wait for session decisions. Once a caller or approved program can access REST, however, unprotected Git/task/grants/decision routes provide another authority. Loopback and CORS cannot authenticate human intent.
- The model output `attempt_completion` controls terminal done; the backend's separate verification remains false. User-facing consumers must preserve that distinction.
- A desktop-policy module calls confidence-selected proposals “executed” despite no execution. It is not currently imported by production; do not institutionalize its status contract.
- BuildRoutes is a large composition root. It mixes context, provider policy and dispatch closures, but is not itself a durable orchestrator. Turning Resident into the same kind of service container would create another god object.
- Intended solution boundaries: conversation/session API, workflow lifecycle, operation authorization, inference adapter, context assembly, independent evidence evaluator and provenance journal. Extend existing authorities; do not add a parallel universal agent framework.

