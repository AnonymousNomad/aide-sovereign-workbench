# Orchestrator Audit

## Implementations and owners

| Component | Reachability | Behavior |
|---|---|---|
| AgentLoop (`node/src/services/agent-loop.mjs`) | LIVE registered agent/start/decision/status | Stateful XML tool loop, plan/act modes, approvals, context injection, transcript, terminal evidence. |
| `harness/orchestrator.mjs:createHarness` | SHADOW relative to production chat/agent; scripts/tests consume | reason→build→optional patch-format repair→verify model→Veritas; returns proposal; apply always throws. |
| `daemon/operator.mjs:Operator.run` | LIVE legacy /api/operator through facade default | ask/plan/agent prompt modes, tree/Git context, proposed tool JSON; no tool execution. |
| `daemon/workflow.mjs:WorkflowManager` | LIVE /api/workflow/plan and /apply through legacy fallback | same-model plan then patch; parse check; request approved:true applies patch. |
| `daemon/sandbox-flow.mjs` | SHADOW / script-battery-only integration found | scratch proposals, ≤3 attempts, command verification and apply helper. |
| `services/orch-context.mjs` | LIVE /api/orch/context | Hardware/model/activity snapshot; not a workflow controller. |
| TelegramBrain | LIVE optional bridge | Separate one-proposal conversation/confirmation loop into desktop service. |
| DesktopPolicyHook | TEST-ONLY consumer found | Model proposal and confidence-labelled outcome; no actual desktop executor. |
| Subagent routes | TEST-ONLY registered factory | Contract defaults + null-service tests; no buildRoutes registration/runtime factory. |

Evidence: [composition](../../../node/src/openapi.ts#L430), [agent state machine](../../../node/src/services/agent-loop.mjs#L229), [standalone harness](../../../harness/orchestrator.mjs#L36), [legacy entry](../../../daemon/server.mjs#L482).

## Agent state machine

start → running → awaiting_approval → running → done/error/aborted. Mode is plan or act. Strict decisions compare pending UUID and reject double consumption. Plan disallows mutations except an approval-requested switch. Execution failure becomes a model observation; no automatic rollback.

25 outer iterations and 3 consecutive mistakes bound normal agent looping. Architect/editor adds up to 8 second calls, then silently returns to one-call behavior. Both roles use the same callback; tool-producing “architect” replies can directly enter execution. Successful tools reset mistake count.

A completion tool anywhere in a response is handled before any sibling tools, so a reply containing a requested write plus completion can finish without the write. F09's unverified policy prevents a VERIFIED claim, but terminal done and arbitrary completion prose can still mislead consumers.

## Unbounded and hidden behavior

- Pending approvals have no expiry in AgentLoop and no generic cancel endpoint for a currently running model request.
- BYOK fetch has no timeout/abort signal. Bounded loop counts cannot bound a hung inference.
- Session map has no observed eviction/retention cap. Transcript is capped by message count, not tokens; oldest task/context messages can disappear.
- Checkpoint starts asynchronously before tool.execute and errors are swallowed. It is neither a committed before-state guarantee nor part of terminal await.
- Advisory Promise.race limits waiting, not cancellation of the underlying expert work.
- Agent model selection uses role chat each turn; effective context was resolved once and model fallback/change is not retained.
- Standalone policy max_turns is declared but not consumed by a looping workflow. It does not implement the intended multi-step orchestrator just because it has three provider slots.

## Truth boundary

The AgentLoop is the strongest candidate for the existing controlled-execution authority. It still combines state, prompt assembly, permissions, execution and evidence. Keep it as the migration starting point; extract/clarify responsibilities only through tested seams. Do not promote legacy Operator or standalone harness simply because their labels resemble the target roles.

Acceptance requires a single traceable workflow from conversation entry, with typed state transitions, budget/cancel handling, trusted tool authorization, independent evidence and human-facing terminal state. Merely renaming createHarness or adding Planner/Coder/Reviewer labels is insufficient.

