---
name: aide-advanced-orchestration
description: Advanced orchestration patterns for AIDE — multi-lens review (one model, three contexts), clarifying question engine (structured constraint-gathering before PLAN), adaptive context compression at phase handoffs, outcome-based routing preferences, and project provenance capture. Use when implementing the phase router's advanced features, designing review pipelines, or building the measurement/trust layer.
---

# Advanced Orchestration — Beyond Single-Shot Generation

## Research Base

- MSR "22 AI Systems Developers Want Built" (860 devs): bounded delegation, quality signals earlier, authority scoping.
- Feedback-Over-Form (2604.21950): execution feedback > pipeline topology for 1-3B models; early stopping load-bearing; refiner > generator.
- CodeRouter phase detection: layered signals (regex -> tool-history -> agent fingerprint); confidence transparency via headers.
- NeMo Switchyard stage router: tool activity decides capability need — errors push toward capable model, steady edits favor efficient.
- ACRouter C-A-F loop: execution-grounded memory beats static classifiers OOD; cumulative regret as streaming metric.
- SWE-Lego: step-level error masking (don't train on failed actions).
- Socratic-SWE: solving traces become training signal.

## Pattern 1 — Multi-Lens Review

One model, three sequential passes with different system-prompt lenses:
- SECURITY: injection vectors, auth bypasses, secret exposure, input validation
- PERFORMANCE: algorithmic complexity, N+1 queries, memory leaks, blocking I/O
- MAINTAINABILITY: naming clarity, coupling, test coverage gaps, dead code

Each lens produces findings; a synthesis step deduplicates and ranks by severity.
NOT three models debating — one model wearing three hats sequentially. Cheaper,
deterministic ordering, no inter-model disagreement noise.

Implementation: after CODE phase completes, run the changed files through three
review prompts. Each returns {findings: [{severity, file, line, description}]}.
Synthesis merges by file+line proximity. Findings become approval-card items.

## Pattern 2 — Clarifying Question Engine

Before PLAN, if task complexity score >= threshold OR ambiguity markers present:
generate 2-3 structured questions with expected answer types. NOT open-ended
chat — each question constrains scope:

```
ambiguity_signals: [
  /(?:add|create|build)\s+(?:a\s+)?(?:new\s+)?(?:feature|system|module)/i, // broad scope
  /(?:improve|fix|optimize)\s+(?:the\s+)?(?!specific)/i, // vague target
  /(?:and|also)\s+(?:then|after)/i, // compound request
]
questions_generated: [
  {question: "Which framework/version?", type: "enum", options: [...]},
  {question: "Should this work offline?", type: "boolean"},
  {question: "Expected data volume?", type: "string"}
]
```

Answers feed into the PLAN prompt as constraints. Reduces rework by front-loading decisions.

## Pattern 3 — Adaptive Context Compression

At each phase boundary, the harness restructures context for the NEXT phase:
- PLAN receives: user intent + workspace facts + relevant SOP lines
- CODE receives: approved spec + file contents + format contract — NOT research rationale
- REVIEW receives: diff + spec + test results — NOT implementation narration
- SHIP receives: gate results + commit summary only

Compression rules:
- Strip reasoning/narration between phases; keep only decisions and artifacts
- Preserve constraint statements verbatim (they're binding)
- Drop exploration paths that didn't lead to the chosen approach
- Cap: each phase context <= 40% of served window

## Pattern 4 — Outcome-Based Routing Preferences

Track {phase, engine_id, gate_pass, user_approved} tuples. After 5 samples per
(phase, engine) pair, prefer engines with highest pass rate. Store in profile
sidecars. No gradient descent — logged evidence informing routing choice.

## Pattern 5 — AGENTS.md Export

Export the active scaffold (credocore + task SOPs + workspace facts) as an
AGENTS.md-compatible file for cross-tool compatibility. Read-only export;
AIDE remains the source of truth.

## Provenance Capture Schema

Every phase transition logs to .aide/provenance/{project}.jsonl:
{at, from_phase, to_phase, model_id, intent_hash, gates_passed[], gates_failed[],
user_decision, files_changed_count, duration_ms}

Feeds: project replay (v2), outcome-latency metric, rework-rate detection,
model-role preference learning.

## Threats

- Prompt injection through clarifying-question answers (sanitize like any input)
- Lens outputs contradicting each other on the same line (synthesis must rank, not merge blindly)
- Compression dropping a binding constraint (constraints always survive compression — whitelist)
- Telemetry becoming surveillance (local-only, opt-in share, purge command)
