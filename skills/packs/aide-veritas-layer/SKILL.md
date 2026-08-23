# X2 — Veritas Layer (honesty, sandbox verification, every-model-gets-better-with-use)

Phase skill for AIDE X-series. Master router: aide-master-roadmap. Two mandates: (1) the IDE is HONEST about what it knows/doesn't know — for any plugged-in model; (2) the harness makes every model BETTER over time without touching weights — closed loop use -> extract -> verify -> reinforce.

Research base: EvoLib 2026 (evolving library of modular skills + reflective insights from own trajectories; consolidation merges similar abstractions; Information-Gain weighting promotes general abstractions), SkillGen 2026 (contrastive induction success-vs-failure; skills as INTERVENTIONS verified via paired with/without rollout — repairs minus regressions = net effect before deployment), LifeSkill (verifier-guided skill learning), REMem refusal robustness, project's own post-training-closed-loop + verification-complete doctrine (generate->verify->self-correct->confidence).

## Part 1 — Honesty Gates (calibration for any model)

### Claim taxonomy + gate per claim
Every assistant turn passes through Veritas BEFORE display:
| Claim type | Gate |
|---|---|
| "This code compiles/works" | MUST run it (B1 task or tree-sitter parse minimum); no run = rephrase as hypothesis |
| "X exists in your codebase" | Helix/A2 retrieval hit required; miss => "I don't have that in context/memory" |
| "Tests pass" | Test job exit code cited w/ job id |
| Factual/world knowledge | Confidence tag; no retrieval backing on local model => low-confidence chip by default |
| Unanswerable | Clean refusal template (REMem pattern): "Not in memory/index — want me to investigate?" |

- Calibration UI: answers carry provenance chips (file+span, memory entry, job id, or 'unverified'). Unverified content renders visually distinct (subtle underline) — honest by typography.
- Anti-sycophancy: when user asserts something contradicting retrieved evidence, orchestrator injects evidence block; model instructed to reconcile, not agree.

## Part 2 — Sandbox (local tools for everything, offline)

- Execution sandbox: workspace-scoped process runs through B1/task-service with resource caps (CPU s, RAM MB, wall timeout, no-network flag enforced via egress shim deny). File writes only inside workspace; temp dirs under .aide/sandbox/.
- Verification ladder (cheapest first): parse (tree-sitter) -> typecheck (LSP diagnostics delta) -> unit run -> integration run -> screenshot/DOM assert (web tasks). Orchestrator auto-selects rung by change type.
- Every agent edit lands as Monaco diff FIRST; acceptance = user click OR auto-approve policy; rejection feeds Part 3.

## Part 3 — The Improvement Flywheel (use -> better, weights frozen)

Per-workspace library `.aide/library/` of TWO abstraction types (EvoLib):
1. **Skills**: reusable procedures ("how to add an endpoint in THIS repo", "this project's test command quirk").
2. **Insights**: reflective lessons ("linter here demands X; don't forget Y").

Loop:
1. **Capture**: session close -> trajectory (prompts, tool calls, diffs, verification results, accept/reject).
2. **Contrastive induction** (SkillGen): pair failed vs nearby-successful attempts -> extract what differed -> candidate skill/insight. Utility-role model does extraction (cheap).
3. **Verify-as-intervention**: candidate stored `status:candidate`. On next matching task, A/B: half the runs get it injected, half don't; net effect = repairs - regressions tracked locally. Net positive after N>=5 pairs -> `status:active`. Negative -> archived with reason.
4. **Consolidation**: embedding-similar entries merged (EvoLib consolidation); general abstractions accumulate weight, instance-specific ones fade.
5. **Injection**: active entries retrieved per-turn (Helix retrieval path) as `[learned]` block with provenance ("learned from 7 sessions, +23% acceptance"). User-visible, editable, purgeable — full transparency, zero hidden training.
6. **Escalation to real training** (optional research track): accumulated verified trajectories are EXACTLY the post-training-closed-loop dataset format — user can opt-in later to LoRA their own local GGUF on their own data. Offline-compatible (device-training-1060 rules apply). Default OFF.

### Cross-model portability
Library entries tagged with model that produced them but transferable (SkillGen shows cross-model transfer) — a user switching models keeps their flywheel. That's the moat: improvements live in AIDE's harness, not the model.

## Tests FIRST

1. Honesty gate: stub model claims tests-pass with no job -> output blocked, rewritten as hypothesis w/ offer to run.
2. Refusal calibration: question with empty retrieval -> clean refusal string, not fabrication.
3. Sandbox escape attempts: write outside workspace, network dial inside sandboxed run -> blocked + journaled.
4. Ladder selection: pure-rename diff stops at parse/typecheck rung (no test run wasted).
5. Intervention A/B accounting: synthetic 10-run history -> net-effect computed exactly; negative candidate archived.
6. Consolidation: two near-dup skills merge, weights sum; distinct ones stay separate.
7. Injection budget: [learned] block respects token cap; highest-weight wins.
8. Transparency: library file human-readable markdown frontmatter; purge works.
9. Arch tests strict contracts; openapi zero-diff.

## Pitfalls

- NEVER present unverified claims as verified — this is the trust product.
- A/B injection must be deterministic-seeded per task (else flaky attribution).
- Extraction loops can inflate library: consolidation step is mandatory each cycle, hard entry cap per category (e.g., 200) with eviction by weight.
- Sandbox on Windows: job objects for hard kill; quote paths; deny UNC.
- Keep flywheel LOCAL counters only — no telemetry ever (V1 law).

## Gate

Unit+arch green; e2e honesty battery (10 probe questions incl. 4 unanswerable -> >=9 correct refusals/backing); flywheel e2e: 20 seeded sessions -> library contains expected insight with positive net-effect; journal. This closes X-series -> competitive thesis complete: packaged-offline + resilient + unlimited-context + self-improving + honest.
