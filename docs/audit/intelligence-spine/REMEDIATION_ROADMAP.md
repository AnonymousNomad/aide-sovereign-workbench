# Remediation Roadmap — Review Proposal Only

No slice below is authorized for implementation. These are likely boundaries, not permission to change every listed file. Confirm exact source/test lists before beginning each slice. Keep work on the development branch and preserve protected user material.

## Dependency ordering

```text
2A authority/bypass integrity
  -> 2B verification/evidence core and lifecycle
  -> 2C canonical conversation/agent entry
  -> 2D context + skills + memory truth
  -> 2E model roles + reviewer independence
  -> 2F complete correlated provenance
  -> 2G paired same-model benchmark
```

Provenance identifiers and negative evidence tests start in 2A/2B; 2F consolidates end-to-end coverage. Task-specific verification precedes reviewer sophistication. Device recommendations and UI appearance do not block these repairs.

## 2A — Authority and bypass integrity

**Objective:** all mutation/approval/network actions originate in authenticated caller/session policy; restore process ownership guarantees.

**Boundary / likely files:** scripts/facade.mjs; node/src/server.ts; browser/src/services/api.ts and ws.ts only for authenticated transport; common permission/operation contracts in the existing contract layer; routes/agent.ts, fs.ts, git.ts, terminal.ts, tasks.ts, desktop.ts, providers.ts, byok.ts; services/desktop-control.mjs, byok-service.mjs, providers.ts; openapi.ts embeddings/dispatch wiring. Inventory plugin/debugger/legacy mutation adapters before claiming universal coverage. Split this into reviewed subchanges rather than one sprawling patch.

**Regressions:** untrusted Origin/simple POST, missing/forged actor credential, payload approved:true, self-approval via accessible IDs, direct/sandbox aliases, task/desktop-grant escalation, consent revocation during an active session, owned-process-only panic. Use captured executors for negative cases and isolated fixtures for legitimate approved actions.

**Acceptance:** every exposed mutation route has an explicit actor/policy owner; model/tool arguments cannot mint authority; legacy human actions remain functional; a disallowed caller produces zero side effects; broad process kills are absent from normal panic.

**Dependencies:** accepted 1A/1B/1C baseline.

**Exclusions:** visual prompts redesign, skill ranking, model training/download, deleting legacy UI. Origin filtering alone is not sufficient authority.

## 2B — Verification and execution lifecycle

**Objective:** independently validate task-required evidence, reject vacuous verification, and make execution/verification outcomes accurate under failure.

**Boundary / likely files:** harness/veritas.mjs, harness/checks.mjs, harness/orchestrator.mjs; agent-loop.mjs/.d.mts; agent-checkpoints.mjs; common/contracts/agent.ts; events.ts; audit-trail and cipher-state only as required for final receipts; model-runtime stream parser and chat stream contract for F15.

**Regressions:** empty/malformed evidence, passed:"false", skipped tests, no artifact, forged PASS stdout, wrong revision, mutated test oracle, verifier error, sibling completion before pending tool, checkpoint race, event rejection, persistence failure, SSE error/EOF/malformed frames and cancellation.

**Acceptance:** a real isolated fixture code change passes a trusted requirement-bound verifier; missing evidence never passes; execution can succeed while unverified; before-state checkpoint completes before mutation if recovery is promised; final query/event/file agree on terminal facts.

**Dependencies:** 2A authority protects verifier execution and evidence writes.

**Exclusions:** general sandbox rewrite, independent model role runtime, Ghost replay UI. Dormant sandbox/policy-hook must remain unpromoted until their semantics are repaired or explicitly retired.

## 2C — Canonical Resident / conversation entry

**Objective:** normal typed user requests enter one governed request lifecycle with explicit direct-model mode.

**Boundary / likely files:** browser/src/chat/chat.ts, services/api.ts, resident/resident.ts only functional wiring; node/src/routes/chat.ts, resident.ts, agent.ts; openapi.ts; common chat/resident/agent contracts. Reuse AgentLoop as the controlled tool execution seam.

**Regressions:** ordinary question, repository question, plan-only, approved code change, denied change, verify request and cancellation from the actual browser client through facade; stream and non-stream context parity; direct mode produces no unintended tools.

**Acceptance:** one workflow ID traces user input through normalization, context, inference, permission, execution, verification and final response. Resident remains presentation/continuity authority, not a new tool executor. No alternate chat path silently omits required governance.

**Dependencies:** 2A and 2B.

**Exclusions:** dock/layout/theme/brand redesign, introducing another agent framework, broad frontend migration.

## 2D — Context / skills / memory truth

**Objective:** relevant methodology and current project facts survive final prompt budgeting with inspectable provenance.

**Boundary / likely files:** skills-loader.mjs/.d.mts; registry metadata only with migration plan; routes/chat.ts; services/history-fit.ts, model-router.ts, memory-recall.mjs, index-service.mjs/index-store.mjs; memory routes; harness/memory-blocks, memory-spine, helix-join/retention; openapi context assembly. Preserve full corpus.

**Regressions:** dependency/conflict resolution; deterministic selection; no-match versus failure; selected content survives actual request fitting; long frontmatter; instruction truncation; task preservation at tiny budgets; 501st memory; stale revision; contradicted memory; cross-workspace isolation; current-file/link containment; secret exclusion; digest ordering and concurrent reindex.

**Acceptance:** each task exposes selected skills/reasons/version/cost and retrieved facts/source/revision; budget never exceeds served input window; current repository evidence outranks stale memory; recent relevant facts remain retrievable; failures are distinguishable from no context.

**Dependencies:** 2C single request path, 2A network/data rules, 2B evidence classifications.

**Exclusions:** wholesale memory replacement, mass skill deletion, scorer sophistication without measured need, training corpus mutation.

## 2E — Model-role and reviewer independence

**Objective:** logical planner/coder/reviewer roles participate in one governed workflow, including single-physical-model operation.

**Boundary / likely files:** model-router.ts, provider/BYOK role adapters, agent route/loop, common role/workflow contracts, expert-advisory integration. Do not wire dormant subagent APIs merely to satisfy labels.

**Regressions:** planner cannot mutate; coder executes approved plan; reviewer can reject; same physical model separate contexts; actual invocation identity retained; local advisory guard; fallback changes visible; context/timeout/total-call limits; required deterministic tests cannot be overridden by review prose.

**Acceptance:** auditable role transitions with per-role permissions and independent evidence. Reviewer input includes requirements/diff/test results independently retrieved, not only coder's self-summary. At least one deliberate defect is rejected.

**Dependencies:** 2B independent verifier, 2C workflow, 2D context manifest.

**Exclusions:** three simultaneous models, recommender/model acquisition, TwinMind and expert-population expansion.

## 2F — Correlated provenance and observability

**Objective:** reconstruct why the action occurred and why final status is reported.

**Boundary / likely files:** audit-trail/cipher-state; events.ts; agent-loop terminal lifecycle; chat-store/history; egress-journal; orch-context; handoff-service; selfimprove workspace invocation/status; common audit/event contracts. Reuse journals with shared IDs.

**Regressions:** correlation across request/model/context/skill/tool/approval/verifier; older session beyond recent-window limit; disk read failure; rejected event; subscriber disconnect/reconnect; missing terminal callback; consent/egress counters; active-workspace versus code-repository ownership.

**Acceptance:** a queryable engineering trace answers actor, model, context, skills, permission, operation, diff, checks and terminal result. Emission acceptance, delivery and durable persistence remain distinct. Unknown activity cannot display zero/healthy without evidence.

**Dependencies:** identifiers introduced earlier, all canonical stages stable.

**Exclusions:** full deterministic replay, uncontrolled logging, secret capture, visual Ghost timeline.

## 2G — Controlled benchmark

**Objective:** quantify whether the same model improves, at what cost and in which categories.

**Boundary / likely files:** existing benchmarks/ and scripts/harness-real-model.mjs only after inspection; isolated fixtures/test runner/evidence schema; benchmark documents. No production policy changes disguised as benchmark fixes.

**Regressions:** arm isolation, fixed model/config/hardware, independent oracle, no memory contamination, real endpoint classification, deterministic result aggregation, honest missing metrics and cancellation.

**Acceptance:** calibration then held-out paired A–E runs with complete artifacts and uncertainty. Normal typed frontend invokes the measured canonical path. Publish no improvement percentage before results exist.

**Dependencies:** 2A–2F; benchmark design/instrumentation requirements can inform earlier work.

**Exclusions:** training, cloud compute, new model acquisition, cherry-picked tasks, model self-grading.

## UI gate and deferred work

Before the major UI transformation: authority integrity; reliable recovery; explicit request entry; real selected context; role lifecycle; independent verification; coherent provenance; at least one real local-model approved coding transaction with external acceptance evidence. Prove the safety/functional spine before investing in its presentation.

After that gate: docking/layout polish, original Covert brand, rich timeline/memory/model inspectors, advanced recommendations, larger expert catalog, Ghost replay expansion and platform-specific mobile experience. Native desktop packaging/install/upgrade/uninstall evidence remains a release gate; the accepted launch commit does not substitute for it.

## Stop conditions

Stop if a slice needs unreviewed production subsystems, user-owned dirty files, tool/model acquisition, operator workload interference or destructive recovery. Report exact boundary expansion before mutation. Stop each slice at its evidence package; do not silently proceed through the roadmap.

