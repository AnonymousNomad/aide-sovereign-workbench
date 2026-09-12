# Intelligence Spine Architecture Audit

Baseline: `bdbaff6eeb435a7a9ffe18551843ed24d4f97a58` — `fix(launch): establish canonical Covert frontend ownership`. Branch: `covert-production`. Audit date: 2026-09-12. Scope: source tracing, isolated tests and non-mutating executor probes; no implementation or release certification.

## Conclusion

Covert has a canonical frontend and facade, but **does not have one canonical Resident → Orchestrator → Harness intelligence path**. The typed frontend's ordinary conversation uses a thin streaming inference route. A different non-streaming route owns retrieval, memory and scaffold composition. A third path, AgentLoop, owns XML tool execution and interactive approvals. Resident is a deterministic workspace adviser. The separate reason/build/verify harness is not wired into these production requests.

The architecture contains useful reliability mechanisms, but their benefits are conditional on which path the caller enters. No same-model, same-task controlled evidence supports a public claim of overall improvement.

## Evidence and scope

- Current branch, HEAD and Git status verified. No tracked modifications at entry. Twenty-one pre-existing untracked files are protected; see [EVIDENCE.json](EVIDENCE.json).
- Source evidence takes precedence over the historical handoff and Phase 0 reports. Those documents were read as leads, not accepted as current truth.
- `node --test tests/arch/agent-execution-integrity.test.ts`: **29 passed, 0 failed, 0 cancelled, 0 skipped**, 8,376.8994 ms.
- In-memory probes reproduced weak verifier semantics, empty sandbox verification, a history-budget overflow, local/provider advisory asymmetry, streaming context bypass, and the first-500-memory cutoff.
- Real facade → real TS server → real Git route dispatched staging from an untrusted Origin without approval. The Git executor was replaced with an in-memory capture: **no Git mutation occurred**.
- No UI, native desktop, external provider, real model, full battery, training or destructive operational probe ran.
- Source-inspection and synthetic execution are explicitly distinguished below. A hypothetical exploit is not reported as an observed real-world compromise.

## Severity register

| ID | Severity | Finding | Evidence / reachability |
|---|---|---|---|
| F01 | P0 | Capability APIs do not authenticate the actor or bind approvals to a trusted caller. Git mutations/tasks need no approval; other routes trust request booleans. CORS does not prevent dispatch. | Facade/ArchServer/Git composed probe returned 200 and invoked the captured stage executor; [permissions](PERMISSIONS_AUDIT.md). LIVE / BYPASSABLE. |
| F02 | P0 | Generic Veritas can produce VERIFIED from empty evidence or a truthy string `passed:"false"`. | Actual exported functions reproduced this. Report/standalone-harness consumers exist. Current AgentLoop forces passed:false and is protected from this specific positive claim. [verification](VERIFICATION_AUDIT.md). |
| F03 | P0 | Desktop panic force-kills all matching allowlisted image names, including processes it did not launch. | `desktop-control.mjs:325`, `panic()`, reachable through desktop API. Source-confirmed data-loss risk; deliberately not executed. |
| F04 | P1 | Normal chat, enriched chat, Resident, agent and legacy workflow are disconnected authorities. | Browser `send()` → `chatStream`; agent API absent from typed browser client. [request flow](REQUEST_FLOW.md). |
| F05 | P1 | Skills inject excerpts, not a complete governed methodology bundle. No dependencies/conflicts/version or selection evidence. | Loader: 274 registry entries, top 3, first 1,200 characters each. Production injection regression passes. [skills](SKILLS_AUDIT.md). |
| F06 | P1 | Memory can fossilize old/unverified claims: only first 500 rows read; assistant prose becomes “outcome”; recalled data placed in system messages. | Synthetic 501st fact invisible with degraded:false; source paths. [memory](MEMORY_AUDIT.md). |
| F07 | P1 | Prompt fitting can exceed budget and silently discard task/context while metadata still describes pre-fit injection. | 512-token input budget → estimated 612, overflow:false. Agent truncates to 80 messages; router fit not fed back to agent provenance. |
| F08 | P1 | Planner/Coder/Reviewer are not governed independent roles. Local expert advisory is unwired; subagents are contracts/test routes only. | Local advisory calls 0 versus provider 1; same agent chat closure; no production subagent registration. [routing](MODEL_ROUTING_AUDIT.md). |
| F09 | P1 | AgentLoop cannot independently verify requested artifacts/tests. Every terminal task uses code-change policy and passed:false. | `buildExecution()`, `emitVerificationOutcome()`; missing verifier is represented honestly but prevents target capability. |
| F10 | P1 | Provenance cannot fully explain an action: missing actual model identity, selected skill versions, memory facts, invocation/tool IDs and final evidence reconciliation. | Audit previews truncated; post-publication/callback states differ from saved snapshot. [provenance](PROVENANCE_AUDIT.md). |
| F11 | P1 | Network authority is split across provider credentials, BYOK consent, embedding env, model manifests and unrestricted approved commands. | BYOK closure checks consent at resolution only; provider chat and embeddings use separate rules. No actual egress attempted. |
| F12 | P1 | Checkpoint is not a reliable before-state: asynchronous commit races the mutation and temporarily renames nested .git directories. | `agent-loop.mjs:437`; `agent-checkpoints.mjs`. Exceptions swallowed. No destructive probe. |
| F13 | P2 | Dormant execution modules are unsafe to promote unchanged: sandbox replaces whole files with replacement fragments; policy hook labels high/missing confidence “executed” without executing. | Source-confirmed, no production registration found. [harness](HARNESS_AUDIT.md). |
| F14 | P2 | Bounded iterations do not bound all waits/resources: pending approvals, BYOK fetch, sessions and timed-out advisory jobs lack unified cancellation/limits. | Loop/provider/Telegram/policy-hook source. No unbounded runtime stress test. |
| F15 | P1 | Stream truth is incomplete: malformed frames/EOF can become normal completion; UI persists partial answers after error frames without durable failure state. | Runtime parser, chat route and browser `send()`; source-confirmed, adversarial stream probe deferred. |
| F16 | P2 | Memory/observability stores have incompatible ownership and freshness: cascade starts before digest; selfimprove defaults to code repo, not active workspace. | `routes/memory.ts`, `server.ts:238`, `selfimprove.mjs:31`; pattern injection lacks a production reader. |
| F17 | P2 | Evidence packaging overstates coverage: handoff calls a service battery real-model acceptance; expert test duplicates wrapper implementation. | `acceptance-real.mjs` has no model invocation; `agent-expert-advisory.test.ts` reimplements wrapper. |
| F18 | P2 | Best-of-N measures surface heuristics, may reject valid TODO/apology content, and reports picked:-1 if all candidates fail. | `gates.mjs`, `chat.ts:gatedChat`; no code correctness proof. |

Counts: **3 P0, 10 P1, 5 P2**. P0 describes severity of the demonstrated defect, not a claim that every request is currently exploitable or dishonest. Dormant promotion hazards are deliberately P2.

## Thirteen direct answers

1. **Real architecture:** typed Vite UI → facade → TS/legacy services; separate streaming chat, enriched non-stream chat, approval-driven AgentLoop, legacy Operator/Workflow and Telegram brain. See [authority map](AUTHORITY_MAP.md).
2. **One canonical Resident→Orchestrator→Harness?** No. Resident supplies deterministic observations; it is not conversational control authority.
3. **Can a path bypass permission authority?** Yes, capability REST routes are outside the AgentLoop approval authority. The direct `/api/agent/tool` write bypass is repaired. No unapproved write was observed through that repaired route. Raw inference alone has no tool executor.
4. **Skills in production inference?** Yes, on the registered agent route; actual production route-to-chat-callback regression passes. No skill injection on normal streaming chat. Injection does not prove that a model followed the skill or that downstream fitting preserved it.
5. **Memory benefit or stale contamination?** Both are plausible. Non-stream chat retrieves bounded prior summaries and fresh file windows, but stale first-500 retention, unverified outcomes, system-role injection and missing truth precedence make contamination credible. Normal stream does not recall it.
6. **Role separation?** No. Plan/act are tool-availability modes; architect/editor uses the same callback. Standalone reason/build/verify permits one provider in all slots. No independent review acceptance protocol.
7. **Independent execution/verification proof?** Tool completion and disk/audit outcomes can be observed. Agent requirements cannot yet be independently verified. Generic Veritas remains unsound with weak caller evidence.
8. **Why an action occurred?** Partially: task, mode, tool preview, decision and result are recorded for the agent. Actual model/skill/memory/permission provenance and complete replay are absent.
9. **Five highest-leverage repairs:** protect capability/approval boundaries; make verification evidence authoritative; connect the conversational entry to one execution lifecycle; make context/skills/memory selection budgeted and inspectable; add role/review provenance and measured ablations.
10. **Before UI transformation:** F01–F12 and F15 at their relevant boundaries; quarantine dormant execution hazards; establish a real local-model, approved, verified coding transaction. Minimal functional caller/event integration is backend product wiring, not visual redesign.
11. **After UI transformation:** rich timeline/docking polish, original sigil/creed rollout, advanced recommender, larger expert population, multi-model concurrency, Ghost replay expansion and mobile shells. Necessary security, truthful status and platform release gates must not wait for appearance.
12. **Same-model improvement plausible?** Yes: strict tool grammar, path checks, approval enforcement, bounded repair feedback, fresh snippets, task-specific SOPs and deterministic checks can improve outcomes. Today these mechanisms are split across paths and some can worsen performance. This is a mechanism argument, not a measured effect.
13. **Public claim requires:** paired A–E ablations, identical model/hardware/tasks, blinded external correctness checks, safety/false-claim metrics, token/latency costs, confidence intervals and failure publication. [Benchmark plan](BENCHMARK_PLAN.md).

## Preserve

Preserve Phase 1A direct-tool denial, one-shot session decisions, structured context failures, separate verification/execution state, fsynced audit-write receipts and validated EventHub contracts. Preserve the facade serialization compatibility mechanism, typed frontend ownership, local model identity/warmup checks, lexical RAG fallback, full skills library and existing deterministic editing/parser functions.

## Decision

Audit complete; implementation remains unauthorized. Recommended dependency order: **2A authority integrity → 2B evidence core and lifecycle → 2C canonical conversation/agent entry → 2D context/skills/memory → 2E roles/reviewer → 2F provenance consolidation → 2G paired benchmark**. Provenance requirements begin in 2A/2B, not at the end. Exact bounded slices and exclusions: [roadmap](REMEDIATION_ROADMAP.md).

No commit, push, UI redesign or Phase 2 implementation occurred.

