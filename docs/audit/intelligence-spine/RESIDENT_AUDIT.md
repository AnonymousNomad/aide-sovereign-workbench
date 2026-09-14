# Resident Audit

## What exists

[Browser Resident](../../../browser/src/resident/resident.ts) builds a refreshable workspace-health panel. [Resident service](../../../node/src/routes/resident.ts) exports summary, context, push-summary and decisions routes. It detects project type, manifest/test-script presence, Git state, LSP availability and model readiness. These are observations, not execution evidence.

State consists of a service-local lastSummary and decisions array plus rendered browser state. Conversation history belongs separately to [ChatStore](../../../node/src/services/chat-store.ts) and browser chat. The typed main initializes Resident separately from chat.

## Questions answered

| Question | Finding |
|---|---|
| Real runtime abstraction? | Yes, a deterministic read-mostly advisory service. The intended conversational authority is not implemented by this abstraction. |
| Conversational continuity? | No. ChatStore and browser history own it. |
| Context assembly? | Resident renders a small workspace summary for AgentLoop; it does not assemble RAG, memory or skill context. |
| Calls orchestrator? | No. AgentLoop calls Resident as a context provider, reversing the intended authority direction. |
| Direct models/tools? | Resident itself has no model inference or mutation executor; it invokes read-only system probes. Chat and agent APIs operate without passing through Resident. |
| Provenance? | Summary callback emits resident audit rows, but no conversation→workflow correlation or model/tool identity. |
| Truthful state distinctions? | Ready/attention/unavailable summarizes workspace health. Planned/attempted/executed/failed/verified/unverified/rejected/approval-required are not its governed state model. |
| Direct-model separation? | Separate code paths exist, but no explicit Resident-versus-direct interaction-mode contract. Normal chat is effectively direct streaming inference with history fitting. |
| God-object risk? | Moving all router, memory, policy, tools and verifier code into Resident would duplicate existing authorities. Resident should call a governed workflow API and render its state. |

## User-visible gaps

A user typing a repository question, planning request or code-change request into the normal typed chat gets the same chat/stream transport. No canonical intent→workflow dispatcher connects this surface to AgentLoop. AgentLoop is reachable from the legacy UI and API but not from the shared typed API client's chat methods.

Browser persistence is best-effort: save failures are swallowed. Stream error frames show a toast while partial answer content can still be saved; fallback/truncation banners are hidden in finally. These facts should become structured conversation/workflow state before visual transformation.

## Preservation and acceptance

Preserve the useful deterministic Resident probes. Do not reinterpret “test script present,” “engine available” or “workspace ready” as verified code. A future acceptance test must start from the actual typed chat action, invoke the canonical workflow, handle a genuine approval and show the exact execution/verification state returned by the backend. No persona or layout redesign is needed to specify that contract.

