---
name: continuous-improvement-sop
description: Standard operating procedure for when you discover something wrong, suboptimal, or improvable in any project as you work through it. Triggered automatically when you notice a bug, a heuristic masquerading as rigor, a broken pipeline, a better pattern, a redundancy, or any deviation from the skills and research we've already established. Use to (1) capture the finding honestly, (2) classify it, (3) fix it immediately if safe, (4) write the correction into the governing skill, and (5) log it in AGENT_NOTES. This is the loop that keeps the skills and pipelines truthful instead of drifting.
---

# Continuous Improvement SOP — Find, Fix, Encode, Log

## The Rule

**When you notice something wrong or know a better way, you must act on it — not just note it and move on.** A pipeline that produces plausible-looking but fake output is worse than one that produces nothing. If a heuristic is being used where real verification is possible, fix it. If a skill exists but a new case contradicts it, update the skill. Every finding becomes a durable change in the system: a fix, a skill edit, or a documented tradeoff.

## Step 1 — Capture the finding (state it plainly)

Name the issue in one sentence. Do not soften it. Examples of what counts:

- **Fake rigor** — a mechanical transform that looks like verification but isn't (e.g. keyword-bucketing thinking into "RULE:/EVIDENCE:" without the content being a real second reasoning pass).
- **Broken pipeline** — script bug, stale path, wrong runtime flag, format drift.
- **Skill gap** — a case the existing skill doesn't cover, or a skill that now contradicts observed evidence.
- **Better pattern** — research-backed practice we're not yet applying (Orca-2 multi-strategy, verification-by-execution, 5-gate, teacher-strength-scoping, etc.).
- **Redundancy / debt** — duplicated work, dead code, garbage artifacts, stale files that will poison future runs.
- **New evidence** — a benchmark, model card, or measured result that changes an earlier decision.

## Step 2 — Classify it

| Class | Definition | Action |
|---|---|---|
| CRITICAL | Produces wrong/fake data that could enter a training corpus or model | Fix BEFORE continuing. Never let it ship. |
| SIGNIFICANT | Real but bounded inefficiency or a heuristic where rigor exists | Fix now if the fix is safe and scoped; otherwise schedule explicitly as the next task. |
| MINOR | Cosmetic, naming, or preference | Fix opportunistically; do not derail the current task. |
| RESEARCH | Needs external evidence before deciding | Record open question + what evidence would settle it; do not guess. |

## Step 3 — Fix it (if safe)

- CRITICAL and SIGNIFICANT fixes happen **immediately, in the current session**, before proceeding with the original task if the fix blocks correctness.
- Apply the fix the way the governing skill prescribes (e.g. if the issue is a fake dual-mind split, replace it with a real second-pass generation per Orca-2; if it's an unverified number, run the harness).
- Verify the fix end-to-end: run the fixed pipeline on a small sample and confirm the output is now real.

## Step 4 — Encode it into the governing skill

The fix is not complete until it's in the skill that governs the work. This is what makes improvement durable:

- Edit the relevant skill (`C:\Users\Grey_\.agents\skills\<skill>\SKILL.md`) to add the correction, an anti-pattern warning, or a stronger rule.
- If no skill governs the area, create one or extend the closest existing skill.
- Add a dated note of what was wrong and what the rule now is.

## Step 5 — Log it in AGENT_NOTES

Every finding gets an AGENT_NOTES entry:

```
**IMPROVEMENT-SOP (YYYY-MM-DD):** <class: CRITICAL/SIGNIFICANT/MINOR/RESEARCH>
Found: <what was wrong>
Fix: <what you did>
Skill updated: <which skill, what rule added>
Artifacts: <files touched>
```

Reference the skill by name (`via skill: continuous-improvement-sop`) so the loop is auditable.

## When to Trigger

- Automatically, the moment you notice any of the items in Step 1 while working through any project.
- During pipeline runs, code reviews, corpus generation, training runs, or skill usage.
- When you know a research-backed practice that supersedes the current approach (from the skills: kd-corpus-production, gold-training-docs, training-from-scratch, kd-teacher-strengths, corpus-curation, surgical-precision).

## Anti-patterns (never do these)

- Noting a problem in chat and continuing without fixing or encoding it.
- "Fixing" a pipeline by patching the symptom instead of the root cause.
- Producing output that *looks* verified but isn't (fake reasoning passes, invented numbers, assumed success).
- Skipping the skill-update step — an unfixed skill is how the same bug returns.
- Treating "it works" as "it's correct." For training data, correctness means verification, not plausibility.

## Known fixes already encoded (2026-08-05, LFM2.5 KD pipeline)

These are root causes found and fixed so the same failure never recurs silently:

- **Fake dual-mind split** — `dual_mind_distill.py` keyword-bucketed thinking into "RULE:/EVIDENCE:" lines and even emitted `</<mind_sheldon>>`. Replaced with a genuine second independent reasoning pass (`kd_batch_tracegen.py --cross-check`) where the teacher verifies/refutes its own first pass. The `traces_to_docs.py` converter now writes the real cross-check into `<mind_sheldon>`. Rule: a dual-mind block is only valid if the two paths come from genuinely distinct generation passes, not a relabeling of one text.
- **Context truncation in llama-cli** — default context is 512 tokens, so long prompts/traces were silently truncated and the teacher reasoned about a prompt it never saw. Fix: pass `-c 4096` (or larger) explicitly. Rule: when feeding a generated trace back into the model, the context flag must exceed the trace length.
- **Wrong chat template** — LFM2.5 needs `--jinja` (embedded GGUF template). `--chat-template chatml` plus manual `<|im_start|>` wrapping double-wraps and produces mojibake. Rule: use `--jinja` for any GGUF with an embedded template; test ONE prompt before batch generation.
- **Banner pollution** — llama-cli prints its startup banner to stdout. Parse from the first `<think>` tag and cut banner lines, don't grep the raw merged stream.

## Also check for this class of bug on any pipeline

- Default limits silently truncating inputs (context windows, `-n`, max length).
- A "verification" step that doesn't actually check anything (heuristic relabeling, hardcoded expected outputs).
- A transform that looks like the real thing but isn't (formatting without substance).
