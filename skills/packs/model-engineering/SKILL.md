---
name: model-engineering
description: MASTER skill for a software engineer building and training models from scratch that are competitive AND production-ready. THE single entry point that ties together the entire model lifecycle — data, architecture, pretraining, post-training, evaluation, deployment, monitoring, and the SOP catalog (standard operating procedures the model must have for every task it will be asked to do). Use whenever working on any FSI-FELON model (trek/felon/cipher/Sopher) or when deciding what to do next. Load this first; it routes to the sub-skills.
---

# Model Engineering — Master Skill

## Why This Exists

You are not a researcher with a cluster. You are a solo engineer on a GTX 1060
building small, novel, from-scratch models that must be **competitive** (beat far
bigger models through quality of data, architecture, and procedure) and
**production-ready** (real users depend on them, so they must be reliable, safe,
fast, and every claim they make must be verifiable). Small models win through
*total discipline* — every phase below is mandatory. When overwhelmed, come back to
the One-Page Roadmap and do only the current phase.

## The One-Page Roadmap

Every model travels this path. Gates are binary: you do NOT advance past a red gate.

| # | Phase | Sub-skill | Gate (must pass to continue) |
|---|---|---|---|
| 0 | Mission & constraints | model-scaling | 1-page spec: who uses it, what tasks, param/VRAM/speed budget, quality bar; size probe on GPU passes (<5GB peak, heads divisible) |
| 1 | Data & corpus | corpus-curation, gold-training-docs, kd-corpus-production | Every source graded A-F; 5-gate filter applied; no F-grade tokens; SOP coverage for every target task |
| 2 | Architecture | felon-master, model-scaling (per-model) | Prototype + smoke test passes on CPU; no known anti-collapse/dead-code shortcuts; GQA head-divisibility verified; GPU probe fits |
| 3 | Pretraining | training-from-scratch | Healthy loss curve, no NaN/spikes, canary metrics sane, final model beats baselines |
| 4 | Post-training | post-training-pipeline (+sft/distill/preference/closed-loop) | SFT -> format gate -> distill -> DPO/RLVR -> final eval gate, in order |
| 5 | Web-builder capability | web-builder | Spec schema locked; renderer + design scorer deterministic; closed-loop verified samples only; see web-builder skill gates |
| 6 | Production readiness | this skill §6 | All 10 readiness checks green (below) |
| 7 | Deploy & monitor | this skill §7 | Packaged, shipping, feedback loop returns to corpus |

## Phase 0 — Mission & Constraints

Write one page: the model's job, its users, and its hard limits. Our standing
constraints: novel architecture only (no vanilla transformer, no pretrained
weights), solo dev, single GTX 1060 (6GB), everything from scratch. Quality bar:
**neurotic precision** — 98%+ confidence on what it knows, abstain below that.
Nothing ships until it is SOTA *for its size*. These constraints never change;
every phase is executed within them.

## Phase 1 — Data (the product)

Data is the entire strategy for small models. Every token must be earned.
1. Inventory every source on disk, grade A/B/C/F, record in `TRAINING_PIPELINE.md`.
2. Run every example through the 5-gate filter (noise, verification, dedup,
   structure, quality) — see corpus-curation skill.
3. Mix per model budget (Chinchilla). Shared ~1B-token base: ~50% verified code,
   ~30% docs, ~20% reasoning **including the cross-synthesis layer (10-20%)**.
4. Guarantee SOP coverage: every task type in the SOP Catalog (§7) has at least one
   training document that teaches the model its procedure.
5. NEVER feed unverified model output into any corpus. Golden rule.

## Phase 2 — Architecture

Novel but principled. Each arch must: be different in a way that matters, not be a
pretrained copy, fit VRAM, and have no silent dead code (fake dual-minds, cosmetic
swarms, dead `.data +=` memory — all caught before). Build prototype -> smoke test
on CPU -> then train. See felon-master + COLONY_MIND_DESIGN.md for the dual-mind +
liquid + colony-MoE + debate/abstain lineage.

## Phase 3 — Pretraining

See training-from-scratch skill (curriculum, hyperparameters, monitoring, spike
recovery, cloze evals, checkpointing). Track canary metrics per model (per-mind CE,
agreement, abstain rate, MoE utilization, router entropy). Sequence curriculum
512 -> 1024 -> 2048 for code models. Do not finalize until the run is healthy AND
the final checkpoint beats every baseline on the eval suite.

## Phase 4 — Post-training

Order is fixed (post-training-pipeline skill): G0 finalize pretrain -> S1 SFT (1
epoch, verified examples) -> G1 format gate -> S2 distillation (verified traces
only) -> G2 reasoning gate -> S3 DPO then RLVR (abstention reward: "98% sure or
abstain") -> G3 final eval -> S4 closed loop back into corpus. Never skip a gate.

## Phase 5 — Web-Builder Capability (website generation, 8/7 decision)

For the <=150M website-builder mission: the model emits a **structured design spec**
(JSON: kind, palette, typography, spacing scale, layout, ordered sections) which a
**deterministic renderer** turns into HTML/CSS, and a **design scorer** (deterministic
layout metrics: contrast, spacing consistency, type hierarchy, palette harmony,
balance, novelty, accessibility) grades it. Closed-loop: generate -> render -> score
-> self-correct from per-metric failures -> keep only parseable + scored specs.
Dual-mind: Spock proposes the spec, Sheldon critiques against design rules, debate
gate resolves. Curriculum: single-section -> multi-section -> full pages -> kinds ->
novelty pressure. Curated design DB = distance references for novelty, not output
templates. RLVR comes ONLY after the deterministic scorer has produced thousands of
labels. Full detail + schema in the web-builder skill. Any deviation from the locked
structured-spec + renderer design must go back to the user first.

## Phase 6 — Production Readiness (10 gates)

A model is production-ready ONLY when all of these pass on the FINAL checkpoint:

1. **Functional suite** — the task-type evals for every SOP it claims (code runs,
   tests pass, outputs execute). For trek/felon/cipher: parse, generate, debug,
   review, refactor, test, doc, security each have a scored eval set.
2. **Precision/refusal** — abstains correctly on unknown/low-confidence input;
   no confident garbage (flat-confidence collapse caught by canary metrics).
3. **Safety** — refuses or abstains on harmful requests (malware, fraud, harm)
   via both policy rules AND calibration, not just trained refusal tokens.
4. **Robustness** — stable across paraphrases, typos, adversarial prompts,
   out-of-distribution input; no prompt-injection whiplash.
5. **Determinism at low temp** — same input -> same output at temp ~0.
6. **Speed** — token/sec meets the product target (offline IDE: interactive).
7. **Memory** — fp32/fp16/quantized variants fit target hardware; no OOM.
8. **Eval integrity** — no test-set leakage (train/val/test never share corpus);
   results reproducible.
9. **No catastrophic forgetting** — retains core capabilities after post-training.
10. **Packaging** — export, tokenizer, config, version, sample runs all clean.

## Phase 7 — Deploy & Monitor

Ship in the offline IDE. Monitor: abstain rate, refusal rate, error patterns,
task-type success. Any observed failure mode becomes a gold training doc (S4 closed
loop) — the models learn from production reality, never from unverified output.

## Phase 7 — SOP Catalog (the model's procedures for every task)

The model must have an internal standard operating procedure for every task the
community can ask it. SOPs are baked into training data as gold documents so the
model EMBEDS the procedure (it doesn't recite a meta-policy, it follows the pattern).
Every SOP ends with: state assumptions, act, VERIFY, and abstain if unsure.

| Task type | The model's internal SOP | Example eval |
|---|---|---|
| Code generation | Clarify spec -> constraints -> plan -> write -> run/verify -> report edge cases | HumanEval/MBPP-style |
| Debugging | Reproduce -> minimize -> isolate root cause -> write failing test -> minimal fix -> re-run | SWE-bench-style |
| Code review | Intent -> correctness -> security -> performance -> style -> prioritized report with line refs | CodeReviewEval |
| Testing | Read code -> map branches/edges -> unit+property tests -> coverage -> adversarial cases | — |
| Refactoring | Behavior-preservation contract -> steps -> run tests before/after -> report diff | — |
| Documentation | Audience -> structure -> accurate examples (EXECUTE them) -> no hallucinated APIs | — |
| Architecture/design | Requirements -> constraints -> options with tradeoffs -> recommendation + explicit assumptions -> risks | — |
| Data work | Schema -> invariants -> pipeline correctness -> verify on sample -> edge cases | — |
| DevOps/CI | Reproducibility -> idempotency -> fail-fast -> secrets safety -> verify dry-run | — |
| Security | Threat model -> entry points -> trust boundaries -> OWASP mapping -> verify exploit doesn't fire | SecurityEval |
| Reverse engineering | Identify format/flow -> label functions -> document contracts -> never exfiltrate | — |
| Migrations/upgrades | Diff APIs -> map changes -> shim/port -> test each layer -> rollback plan | — |
| Research/explain | Claim -> cite/verify -> compare -> complexity -> uncertainty flagged | — |
| Scripting/automation | Task -> safe commands -> dry run -> guardrails (no rm -rf) -> verify result | — |
| SQL/databases | Schema -> query intent -> EXPLAIN/plan -> indexes -> verify result on sample | — |
| Web/fullstack | Data flow -> state -> auth -> API contract -> test -> accessibility | — |
| Analysis (logs/data) | Hypothesis -> clean -> analyze -> sanity-check numbers -> present uncertainty | — |
| Reporting | Facts first -> root cause -> impact -> action items -> no speculation as fact | — |
| Strategic/analytical | Constraints -> incentives -> options -> second-order effects -> recommendation (cross-synthesis layer) | — |
| Teaching | Audience -> prerequisite -> concrete examples -> verify examples -> check understanding | — |
| Chat/summarize | Comprehend -> key points -> faithful -> no fabrication -> mark uncertainty | — |
| Mentalism/behavior | Pattern recognition -> hypothesis -> evidence weighting -> ethics check -> abstain on manipulation of real people | — |

**Cross-synthesis rule:** strategic/analytical, architecture, security, and code
share the same deep pattern language (constraints, incentives, hierarchy, feedback,
boundaries, deception-vs-verification). The model must be trained to map between
them (see corpus-curation skill, Cross-Synthesis Layer) so reasoning in one domain
transfers to all.

## Current Status Board (2026-08-07)

| Model | Phase | Status |
|---|---|---|
| trek 16.9M | 3 | retrained (819M tokens, old run invalid); size-feasibility probe proves scaling path to 150M |
| **web-builder / 150M** | **0/2** | **MISSION PIVOT (user 8/7): <=150M closed-loop dual-mind website generator. Target config measured + validated (139.7M, B=4 L=512 fits 4.0GB, 2269 tok/s). Design LOCKED: structured spec + deterministic renderer + design scorer. GQA divisibility bug found + fixed. Next: second research round + web-builder design doc (spec schema, renderer, scorer).** |
| felon 28M | 1/2 | ARCH NOTED AS SCALING: 33.9M, NEVER TRAINED (stalled at corpus load). FELON_SCALE_DESIGN.md: 4 blockers + ~120M/200M target. Wait for GPU. |
| cipher 56.6M | retired | replaced by Sopher; poisoned by F-grade gen_0/1/2 data |
| Sopher/cipher v5 | 2 | ARCH BUILT + CPU smoke-tested; data phase in progress (TRAINING_PIPELINE.md); waiting on GPU |
| Pipeline | 1 | master doc + corpus-curation + cross-synthesis defined; ferrell+colony_teacher curation is next (swarm_neci corrected to grade C) |

## Discipline (surgical-precision skill + professional-developer skill)

Read, don't assume. Sandbox everything. Verify before claim. Every corpus change and
every milestone is logged in AGENT_NOTES and TRAINING_PIPELINE.md. When the user is
overwhelmed: give the One-Page Roadmap, say exactly which phase we are in, and name
ONE next action. Do not parallelize the user's attention.

**`pipeline-excellence` is the master quality bar** (newest skill, 8/9): the
Pipeline Constitution (10 non-negotiable laws: truth, verified-data, zero-dup,
comprehension, gate, train==serve, own-traces, decontamination, honest-eval,
logging), the stage-gated world-class scorecard with binary gates, the audit
loop that verifies the pipeline itself, and the Rivalry Test (name the Big Tech
practice for each stage and beat it for our budget). Load it at session start
before any data/training/gate work; it routes to all stage skills below.

The professional-developer skill is the master operating standard: deliver work
proven to work (manual + automated proof), never game the check, verification-first
control loop, report observations not expectations, disclose the unverified edge,
generator never grades its own output, complexity is a defect, and the release
checklist before any "done". Load it when starting any task and before any handoff.
