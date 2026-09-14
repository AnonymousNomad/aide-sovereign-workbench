# Request Flow — Ten Required Paths

Baseline bdbaff6. Source anchors are to the accepted checkout; no future-state arrows are treated as implementation.

## Status key

L = LIVE; P = PARTIAL; S = SHADOW (capability exists elsewhere but is not used on this path); T = TEST-ONLY; B = BYPASSABLE; D = DUPLICATED; ? = UNKNOWN/no applicable implemented transition found. An absent tool transition in read-only chat does not mean permission bypass: chat has no executor.

## Trace definitions and source authority

1. **Ordinary conversation:** typed `chat.ts:send` → `api.chatStream` → facade → `routeForChatStream` → `ModelRouter.chatStream` → local runtime/provider → SSE → browser history. Named Resident is a different summary panel.
2. **Repository question:** same normal stream path. User text is not a retrieval trigger here. Alternative explicit POST `/api/chat` can call `buildContextBlock` (query ≥8 chars, ≤5 hits ×20 lines) and recall when harness enabled and effective context ≥1024.
3. **Planning request:** typing “plan” into normal chat does not call AgentLoop. The separately invoked `POST /api/agent/start {mode:"plan"}` does: schema → mode → Resident/skills → model → read-only tools or approval-gated switch_mode → terminal result.
4. **Code-change request:** typed chat remains text. Separate agent/start act path executes parsed tools one by one through pending approval; legacy app.js invokes this route. Legacy workflow/plan and workflow/apply are additional paths.
5. **Tool invocation:** model XML → parser → parameter aliases/required fields → registry → plan-mode restriction → risk/approval → execute → normalized observation → next model turn. Direct REST agent/tool is read-only unless policy permits; mutations are denied.
6. **Approval-required:** same agent path → pending approval UUID and preview → decision route → exact pending-ID match and one-shot enum → execute/reject/abort. Capability REST alternatives are not bound to this approval.
7. **Verification/review:** no conversational VERIFY dispatcher. Agent terminal flow calls buildExecution → missing requirement verifier → passed:false → saved evidence/audit/EventHub. Standalone createHarness supplies a verifier-model proposal and generic Veritas; not registered as the normal workflow.
8. **Failure→repair:** agent parse/tool error → transcript error observation → same model retries; 25 iterations, 3 consecutive mistakes; optional architect/editor ≤8 cycles. Denial is an observation; no verified repair-policy state machine.
9. **Memory-assisted:** separate non-stream chat as in (2); ChatHistorySave journals last assistant prose as outcome. Agent session end digests audit but does not recall those summaries into agent inference.
10. **Skill-assisted:** agent/start → awaited createSkillsLoader → lexical selection → first 1,200 chars ×3 → system advisory → chat closure → ModelRouter history fitting → inference. Regression proves callback input; no real-model adherence measurement.

Primary evidence: [browser send](../../../browser/src/chat/chat.ts#L206), [browser API](../../../browser/src/services/api.ts#L265), [chat route](../../../node/src/routes/chat.ts#L104), [stream](../../../node/src/routes/chat.ts#L279), [agent route](../../../node/src/routes/agent.ts#L82), [loop](../../../node/src/services/agent-loop.mjs#L280), [loader](../../../node/src/services/skills-loader.mjs), [legacy UI](../../../app.js#L396).

## Transition classifications

For paths 3/4/6/7/8/10 the table describes the explicitly invoked agent API, not automatic dispatch from typed chat. Path 9 describes the alternative non-stream chat route; path 2 describes normal browser chat.

| Transition | 1 chat | 2 repo | 3 plan | 4 change | 5 tool | 6 approval | 7 verify | 8 repair | 9 memory | 10 skill |
|---|---|---|---|---|---|---|---|---|---|---|
| Entrypoint | L | L | P | P | L | L | P | L | P | L |
| Request normalization | L | L | L | L | L | L | L | L | L | L |
| Intent classification | ? | ? | P | P | ? | ? | S | ? | ? | P |
| Context acquisition | S | S | P | P | P | P | P | P | P | P |
| Memory retrieval | S | S | S | S | S | S | S | S | P | S |
| Skill selection | S | S | P | P | S | P | P | P | S | P |
| Prompt assembly | P | P | L | L | L | L | L | L | P | P |
| Model selection | L | L | D | D | D | D | D | D | L | D |
| Model invocation | L | L | L | L | L | L | L | L | L | L |
| Tool selection | S | S | L | L | L | L | S | L | S | L |
| Permission decision | ? | ? | L | L | D/B | D/B | ? | L | ? | L |
| Execution | S | S | L | L | L | L | P | L | S | L |
| Evidence collection | P | P | P | P | P | P | P | P | P | P |
| Independent verification | S | S | S | S | S | S | S | S | S | S |
| Retry/repair | P | P | P | P | P | P | S | P | P | P |
| Audit emission | S | S | P | P | P | P | P | P | P | P |
| Final human-facing result | L | L | P | P | P | P | P | P | L | P |

## Transition details and limits

- **Normalization:** strict Zod HTTP schemas; agent parser uses XML and aliases. Validation establishes shape, not caller authorization. `server.ts:handle` does not create a principal.
- **Classification:** agent mode is caller-supplied; skill ranking uses task tokens. Legacy `routeIntent` only drives Operator auto mode. Expert advisory does not dispatch workflows.
- **Assembly:** Resident and skills resolve concurrently. Loader failure emits context failed and blocks inference. Empty string gives no_match. The event has no skill IDs or content hash. Router may subsequently truncate it.
- **Inference:** local agent resolves role chat each turn and returns text only. Provider path selects plan/act at start. Actual fallback/usage/fit facts do not reach the agent audit.
- **Tools/permissions:** direct agent-tool mutation bypass repaired; Git/tasks/desktop/etc. remain separate capability APIs. See F01 and permission map.
- **Evidence:** tool exit/result is recorded; required artifact identity and required tests are not established. attempt_completion can appear beside tool calls and causes immediate completion before those calls execute.
- **Verification:** all agent terminal cases currently remain unverified. This is honest missing capability, not a remaining positive agent verification bug.
- **Repair:** error text influences another sample, but no requirement-bound stop/repair/review contract exists. Successful intervening tools reset mistake count; iterations cap total outer turns.
- **Final response:** typed chat renders streamed text. Agent API gives session ID/status/events; legacy app polls and presents done language. There is no central Resident final-response normalization with verified/rejected/incomplete provenance.
- **Resident actual path:** createResidentPanel.refresh → api.residentSummary → facade → resident service → Git/package/model/LSP probes → recommendation + in-memory decisions → panel. No skill/model/tool loop runs for a summary.

## Runtime proof

The existing 29-test integrity battery composes real facade, TS routes, AgentLoop, skill loading, disk evidence and WebSocket subscriber with a scripted chat callback. It proves those seams, not the typed UI's adoption of them and not local-model capability. Separate pure probes show stream messages unchanged and local expert consults absent.

