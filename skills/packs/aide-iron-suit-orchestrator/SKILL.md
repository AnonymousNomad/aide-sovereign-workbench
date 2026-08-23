# I — Iron Suit Orchestrator (the harness IS the product)

Capstone doctrine skill for AIDE. Master router: aide-master-roadmap. THE thesis: AIDE is an Iron Man suit for every model — any model, local or cloud, plugged into the suit gets abilities it lacks alone: unlimited context (X1 Helix Memory), verification (X2 Veritas), tools, resilience (R), and discipline (aide-model-sop). The user's workflow is orchestrated; the model does cognition, the suit does everything else.

Research base: Berkeley Compound AI Systems (control logic in code beats monolithic prompts; DSPy modular optimization; FrugalGPT routing cascades); "LLM Harnesses: wrapper matters more than the model" 2026 — SAME MODEL swings 35 points (42.2% CORE-Agent scaffold vs 77.8% Claude Code on CORE-Bench Hard) purely via harness; Vercel v0 deleted 80% of tools -> success 80%->100%, tokens -37%; LangChain coding agent top-30 -> top-5 Terminal-Bench changing only the harness; "if you're not the model, you're the harness"; Anthropic architecture ladder with RESTRAINT principle.

## Division of Labor (the suit contract)

| The suit (AIDE orchestrator) owns | The model owns |
|---|---|
| Context assembly + memory (X1) | Reasoning about what it's given |
| Verification gates before display (X2) | Producing candidate outputs |
| Tool execution, schemas, arg normalization (A1) | Choosing which tool + intent |
| State, session continuity, failover (R) | Staying coherent within a turn |
| Procedure injection (SOPs — aide-model-sop) | Following the injected procedure |
| Personalization library per user/project (X2 flywheel) | General capability |

Rule of thumb from the evidence: when output quality disappoints, FIRST tighten the harness (tool scope, context quality, verification) — model swap is the LAST resort, not the first. Track per-harness-change deltas in AGENT_NOTES so we build our own evidence like Vercel did.

## Orchestrator Services Map (all exist as phase skills — this file routes)

1. **Loop**: ReAct-style while-loop w/ turn cap; tool errors returned to model as OBSERVATIONS for self-correction, never thrown (error-handling pattern).
2. **Tool scope discipline** (Vercel lesson): start minimal per task type; add tools only when a recorded failure demands it. Fewer well-scoped tools > more tools.
3. **Context management**: smallest set of high-signal tokens (Anthropic guidance): compaction of old turns + just-in-time retrieval (X1) instead of pre-loading.
4. **Verification**: guides (feedforward: inject conventions BEFORE generation) + sensors (feedback: computational checks first — parse/types/tests — inferential LLM-judge only where semantic) (Fowler split).
5. **Architecture restraint ladder** (Anthropic 2026): Agent Skill (stable procedure) -> Subagent (context isolation for noisy subtasks) -> Multi-agent (parallel independent work) -> Dynamic Workflow (runtime orchestration). Take the LIGHTEST rung the task structure demands; escalate only on concrete failure (context pollution / unmanageable parallelism / weak verification).
6. **Routing** (FrugalGPT lineage): role-based model selection (plan/act/utility/embed) + escalation ladder utility->act->plan->user; per-step routing decisions logged.
7. **Traces as artifacts**: every session = inspectable trace (prompts, tool calls, verifications, diffs, accept/reject). Traces feed X2 flywheel extraction AND are the debug surface. Local-only storage.
8. **Operational metrics** (Arize doctrine): success rate, retries, tool efficiency, error-recovery rate, tool-hallucination rate, cost-per-successful-trajectory (tokens for local models = time). Dashboard in RUN view; regressions in these metrics = harness bugs, not prompt tweaks.

## Personalization Layer (smarter about THIS user, THIS project)

- Per-workspace: X2 library (skills/insights w/ verified net-effect), project core-memory block (conventions/build cmds), A2 index, B2 problem history.
- Per-user: style/preferences block, acceptance-rate priors per task-type/model, frequently-used flows surfaced proactively.
- All local-only (privacy law); export/import as portable profile — the suit's fit travels with the user, not locked to one machine.

## Future-Proofing Test (from the scaffolding metaphor)

Every harness feature must PASS: "when a stronger model is plugged in, does this feature still help (or at least get out of the way)?" Features that compensate FOR weakness must degrade gracefully (e.g., aggressive arg-normalization relaxes when the model emits valid calls consistently — measured, not assumed). Scaffolding comes down as the structure stands.

## Tests FIRST

1. Loop returns tool-error as observation: scripted failing tool -> next turn contains error text, run continues, no crash.
2. Tool-scope reduction: task-type fixture runs with minimal toolset; adding unused tools changes nothing but token count (assert smaller).
3. Restraint ladder advisor: synthetic task features -> recommended rung matches expectation matrix.
4. Trace artifact: complete session writes valid trace JSON; replay of trace against stub reproduces same tool sequence.
5. Metrics: seeded session histories -> dashboard aggregates exact; regression alert fires on injected drop.
6. Stronger-model passthrough: with stub "strong" model emitting perfect calls, normalization layer no-ops (measured pass-through rate).

## Gate

Unit+arch green; metrics dashboard live on own dogfooding sessions (we ARE the first user); journal. This skill never "completes" — it's reviewed whenever any harness behavior changes (continuous-improvement-sop).
