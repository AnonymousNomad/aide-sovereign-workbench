---
name: kaizen-loop
version: 1.0.0
category: discipline
applies_to:
  - kaizen
  - learn from failure
  - postmortem
  - improve process
  - new skill from failure
tools_required:
  - read_file
  - search
sop: |
  1. When a tool call fails 3 times in a row for the same task, the agent loop pauses and runs a kaizen pass.
  2. The kaizen pass writes a one-paragraph root-cause analysis citing the primary source (manual section, stack trace, error code).
  3. The pass then writes a draft skill that captures the fix, using the skill-writer SOP — scope, research, failure modes, success criteria, dependencies, incompatible skills, all present.
  4. The draft skill is queued in .aide/kaizen/drafts/<name>/SKILL.md and the operator is notified.
  5. The operator reviews, edits, and approves. Approval moves the skill to skills/<name>/SKILL.md and the orchestrator catalog picks it up.
  6. Every kaizen pass writes a trajectory entry to .aide/trajectories/<date>/<session>.jsonl — no pass goes unrecorded.
  7. After 3 successful uses of an approved kaizen skill, the orchestrator's Helix retriever surfaces it as a "trusted by past" example.
  8. Skills that fail to be used 90 days after approval are marked deprecated (deprecated_since set, replaced_by left null so the operator reviews manually).
description: |
  Universal SOP: the closed-loop kaizen mechanism. Every failure becomes
  a skill. Every skill is rooted in a primary source. Every skill is
  approved by the operator before it enters the catalog. Sources: Toyota
  Production System kaizen (Toyota primary), Etsy/Slack postmortem culture
  (standard SRE literature, confirmed). The "if it fails the first
  time, research the error, fix the root cause, write the skill so we
  never have to guess again" principle, made operational.
failure_modes:
  - condition: 3+ tool-call failures without a kaizen pass
    recovery: the agent loop pauses and forces a kaizen pass; the operator is notified
  - condition: kaizen draft without primary-source citation
    recovery: the draft is rejected until the writer cites a specific manual section, RFC, or stack trace
  - condition: kaizen skill approved but never used in 90 days
    recovery: marked deprecated (deprecated_since set); the operator is reminded monthly
  - condition: trajectory entry missing
    recovery: the agent loop refuses to mark the task complete until the trajectory is recorded
success_metrics:
  - failure-to-skill-conversion-rate: 100% of 3-fail patterns produce a draft within 24h
  - kaizen-draft-approval-rate: 80% of drafts approved within 7 days
  - approved-skill-usage-rate: 50% of approved skills used at least once within 30 days
  - trajectory-completeness: 100% of kaizen passes have a paired trajectory entry
---

# Kaizen Loop

Every failure is the start of a skill. Every skill is the closure of a
failure. The cycle: 3 failures → research → skill draft → operator review
→ catalog entry → trajectory record. The "if it fails the first time,
research the error, fix the root cause, write the skill so we never have
to guess again" principle, in operational form.

## Why this exists

Three primary sources ground this SOP:

1. **Toyota Production System kaizen** (Toyota, primary, confirmed in
   every modern operations-management text): continuous improvement
   through small, frequent, documented changes. The "3 failures → skill"
   cadence matches kaizen's "small change, measured, recorded" rhythm.

2. **Etsy/Slack postmortem culture** (standard SRE literature,
   confirmed): every incident becomes a runbook; every runbook is
   reviewed and updated. The "skill per failure" pattern is the
   postmortem principle applied to the model.

3. **The "Broken Window" principle** (The Pragmatic Programmer,
   still canonical): a failure unaddressed invites the next failure. The
   kaizen loop is the antidote — the model cannot repeat a failure
   because the next time it occurs, the failure is a skill.

## When to apply

Every 3-fail pattern in the agent loop, every postmortem, every
operational anomaly. The orchestrator enforces this automatically; the
operator's job is to review and approve.

## Integration with the rest of the chassis

- `learn-from-mistakes.md` (the existing SOP) provides the high-level
  principle; this SOP provides the operational mechanism.
- `skill-writer.md` provides the envelope constraints; this SOP
  triggers them at the moment of failure.
- The orchestrator's routingLog records every kaizen pass; the
  Helix retriever surfaces approved kaizen skills as "trusted by past"
  examples after 3 successful uses.
