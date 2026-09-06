# Agent-Chassis Integration Decision Memo

**Audience:** AIDE T1 operator  
**Date:** 2026-09-05  
**Scope:** cockpit-to-agent wiring, bundle-card UI, and model-class skill policy. No T2 activity, no runtime process changes, and no implementation are included.

## Executive decision

Do **not** change the cockpit's `sendDescribe()` directly from `/api/chat` to the agent route yet. Ship a thin, feature-gated cockpit integration **immediately after** a small C6 integration slice connects the D1-D5 orchestrator and scaffold to the live agent service. This is a canary, not a UI rebuild: the existing chat route remains the default and the operator can return to it in one toggle.

The reason is repository-verified: `app.js` currently calls `/api/chat` (`app.js:118-145`); the live agent endpoints are `/api/agent/*` on the TS backend (`node/src/routes/agent.ts:72-150`, facade map `common/facade-route-map.json:5`); and `createAgentLoop()` still uses the legacy skill registry rather than `createOrchestrator()` plus `assembleScaffold()` (`node/src/services/agent-loop.mjs:173-194`). The proposed three-line reroute would therefore expose the old loop, not the new chassis. There is also no live `/api/agent-loop/*` route in this branch.

## Decision 1 — cockpit wiring timing

**Recommendation: C6 first, then the surgical cockpit canary.**

1. Add a tested composition adapter in the TS agent service: request -> `createOrchestrator().classify()` -> load only the bundle's SOP/skill bodies -> `assembleScaffold()` -> agent session. Persist the bundle ID, selected skill version, scaffold byte/line count, dropped layers, and routing log with the session.
2. Add a read-only preview endpoint and a run endpoint. The preview creates no agent session; the run starts `/api/agent/start` with the already-reviewed bundle ID. Keep existing per-tool approval exactly as-is.
3. Add a feature-gated, minimal cockpit branch: when **Agent mode** is explicitly on, preview the bundle, let the operator select **Run agent**, then poll/render session status and approval cards. When off, preserve the existing `/api/chat` behavior byte-for-byte.
4. Verify through the facade (`:4777`), not directly through `:4778`: local route contract tests, one scripted agent session, an approval/rejection round trip, an operator walkthrough, and an instant-toggle rollback test.

This is a local analogue of a canary: a bounded, reversible exposure of the new path while the known-good path remains selectable. Google SRE describes canarying as partial, time-limited exposure used to decide whether to continue a rollout, and emphasizes selective disablement and rollback. [Google SRE Canarying Releases](https://sre.google/workbook/canarying-releases/)

Security is a second reason not to shortcut the adapter. OWASP recommends defense in depth, least-privilege tool scopes, input validation, and human approval for destructive actions; a UI reroute must preserve these controls rather than bypass them. [OWASP LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)

## Decision 2 — C5 bundle card

**Recommendation: build a standalone, read-only “Run card” at `GET /api/agent/bundles/:id` plus printable HTML at `GET /api/agent/bundles/:id/card`.** It belongs in the TS route family and can open in a tab or iframe without touching the cockpit layout.

The card should answer the operator's actual decision in one screen:

1. **Verdict header:** task, selected model, mode, status, bundle ID, and a clear `reviewed / started / completed / failed` state.
2. **Why this skill:** primary skill + version, trigger hits, lexical score, similarity score, thresholds, and the exact deterministic routing-log sequence. Label low or rejected signals honestly.
3. **What enters context:** L0.5 credo, named L0 SOPs, L1 skill, L2 facts, total bytes/lines versus budget, and blocks dropped to fit. Show fingerprints/versions, not a chain-of-thought or raw unrestricted system prompt.
4. **Memory truth:** Helix match count, top digest identifiers/scores when eligible, and an explicit `bootstrap: no qualified history` state when it is empty or below threshold.
5. **Control and audit:** the precise tool allowlist, approval rule, session link, immutable trajectory link after completion, and one Run/Cancel control only after operator review.

The compact header plus collapsible evidence sections keeps the card usable while preserving the glass-box promise. The People + AI Guidebook recommends matching the level of explanation to user need and handling model uncertainty explicitly; NIST's AI RMF calls for documentation that supports transparency, human review, accountability, and traceability. [Google PAIR Explainability + Trust](https://pair.withgoogle.com/guidebook-v2/chapter/explainability-trust/), [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/).

Do not call a routing score “model confidence.” It is a deterministic matcher score, so label it **routing evidence**. Do not display private reasoning traces: the routing log, selected inputs, policy, and observable tool events are the actionable explanation.

## Decision 3 — model-class skill policy

Parameter count is not a reliable release criterion by itself. Treat the following as **operating envelopes to validate on AIDE's own battery**, not promises of capability. Each class gets a separate measured profile: prompt budget, maximum tools exposed, maximum turns, permitted modes, structured-output compliance, tool-selection accuracy, approval completion, and task success. Use the same pinned tasks and model/quantization/runtime settings for every comparison.

| Model class | T1 role | Skill/context policy | Write authority |
|---|---|---|---|
| 360M | deterministic UI helper, routing labeler, summaries | One micro-skill; one schema; no retrieved history; template/grammar-constrained output | None |
| 0.5B | retrieval and single-step utility helper | One micro-skill; at most one read-only tool proposal; strict structured output | None |
| 1–2B | narrow code assistant | One primary skill; compact evidence; read/search/list first; one action per turn | Proposed write only, always operator-approved |
| 3–5B (Cipher-fast is the initial candidate) | default local agent | One primary skill plus essential SOPs; bounded workspace facts; plan-act-observe loop; Helix only when threshold passes | Operator-approved tools only |
| 5–12B (future hardware/runtime) | broader implementation and review | Primary + one auxiliary skill; explicit plan/review handoff; limited retrieved examples | Operator-approved tools only |
| 30B MoE | architect/reviewer/evaluator, not a current T1 runtime target | Larger evidence window, multi-file plan/review, no privileged shortcut | Operator-approved tools only; remain `pending` on current 6GB GPU |

The 360M/0.5B rows are intentionally useful but non-agentic: they should remove latency from deterministic work, not impersonate an autonomous developer. The 3–5B class is the first candidate for the full local loop because the existing Cipher runtime and approval system can be measured there. Promotion to the next envelope requires a battery, not a subjective impression.

The evidence supports the policy rather than a parameter-based promise: Toolformer shows that external tools can improve task performance and specifies that a tool-using model must decide whether, when, and how to call a tool; ReAct supports interleaving actions with observations to maintain and update plans. [Toolformer](https://arxiv.org/abs/2302.04761), [ReAct](https://arxiv.org/abs/2210.03629)

For local models, make syntax deterministic where possible. Constrained decoding has been shown to remove tool-call syntax errors without fine-tuning, while BFCL evaluates both call structure and executable correctness—exactly the two measurements AIDE should record. [Constrained tool use](https://arxiv.org/abs/2310.07075), [Berkeley Function Calling Leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html?source=post_page-----77d3f70394eb---------------------------------------)

Never compensate for a smaller model by dumping more SOPs or workspace text into context. Long-context performance can degrade when relevant information lies in the middle, which supports the current bundle budget and selective retrieval design. [Lost in the Middle](https://arxiv.org/abs/2307.03172)

## Release gates for C6/C5

- Unit: adapter composes the selected v1 bundle and preserves L0.5-first ordering; malformed/unknown skill fails closed.
- Contract: preview and run endpoint schemas are regenerated and facade-map routing sends `/api/agent` to TS.
- Integration: one local scripted model session reaches final answer; one approved write and one rejected write are recorded; no tool runs without approval.
- UI: agent-mode-off uses `/api/chat`; agent-mode-on renders a reviewed bundle and correct session/approval state.
- Audit: bundle, tool log, approval decision, and terminal state produce one immutable local trajectory; an empty Helix stays visibly empty.
- Rollback: disabling Agent mode needs no restart or data migration and leaves the conventional chat route working.

## Limits and next action

This memo does not claim the complete product is release-ready, and it does not benchmark any model. It is a decision document for the next smallest integration slice. The correct next implementation target is **C6: orchestrator/scaffold-to-agent-loop adapter with a preview contract and battery**; the cockpit change follows only after that gate is green.
