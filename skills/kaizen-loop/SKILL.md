---
name: kaizen-loop
version: 1.0.0
category: discipline
applies_to:
  - failure
  - 3-fail pattern
  - postmortem
  - research then fix
tools_required:
  - read_file
  - search
  - write_file
sop: |
  1. When a tool call fails 3 times in a row for the same task, pause. Do not retry a 4th time.
  2. Write a one-paragraph root-cause analysis citing a primary source: the manual section, the stack trace line, the error code, the spec.
  3. Ask "what would prevent this exact failure class from happening again?" That answer becomes the skill.
  4. Write the skill using the skill-writer SOP envelope: scope, research, failure modes, success criteria, dependencies, incompatible skills.
  5. Save the draft to .aide/kaizen/drafts/<skill-name>/SKILL.md. The orchestrator picks it up on the next routing.
  6. Record the kaizen pass to .aide/trajectories/<date>/<session>.jsonl with the root cause, the primary source, the fix, and the skill that resulted.
  7. After 3 successful uses of an approved kaizen skill, the Helix retriever surfaces it as a "trusted by past" example in future routing.
  8. Skills that go 90 days without use are marked deprecated; the operator reviews monthly.
description: |
  The closed-loop mechanism: every failure becomes a skill, every skill
  is research-backed, every skill is operator-approved. Sources: Toyota
  Production System kaizen (continuous improvement, primary), Etsy/Slack
  postmortem culture (standard SRE literature), The Pragmatic
  Programmer's Broken Window (still canonical). When a tool call fails
  3 times in a row, the agent loop pauses and triggers this skill.
  The result is a draft skill in .aide/kaizen/drafts/, with a
  primary-source citation, ready for the operator's review.
failure_modes:
  - condition: 3 failures in a row without a kaizen pass
    recovery: agent loop pauses and forces a kaizen pass; the operator is notified
  - condition: kaizen draft missing primary-source citation
    recovery: draft is rejected until the writer cites a specific manual section, RFC, or stack trace
  - condition: kaizen pass without a trajectory entry
    recovery: agent loop refuses to mark the task complete until the trajectory is recorded
  - condition: skill approved but never used in 90 days
    recovery: skill is marked deprecated (deprecated_since set); the operator is reminded monthly
  - condition: 3-fail pattern recurs despite an approved kaizen skill
    recovery: kaizen-loop escalates to a deeper root-cause analysis; secondary review
success_metrics:
  - 3-fail-to-skill-rate: 100% of 3-fail patterns produce a draft within 24h
  - draft-approval-rate: 80% of drafts approved within 7 days
  - approved-skill-usage-rate: 50% of approved skills used at least once within 30 days
  - trajectory-completeness: 100% of kaizen passes have a paired trajectory entry
---

# Kaizen Loop

Every failure is the start of a skill. Every skill is the closure of a
failure. When 3 attempts at the same task fail with similar errors, the
agent loop pauses and triggers this skill. The result is a draft skill
that captures the root cause and the fix, with a primary-source citation.

## Why this exists

Three primary sources ground this skill:

1. **Toyota Production System kaizen** (Toyota, primary, confirmed in
   every modern operations-management text): continuous improvement
   through small, frequent, documented changes. The 3-failure trigger
   matches kaizen's "small change, measured, recorded" rhythm.

2. **Etsy/Slack postmortem culture** (standard SRE literature,
   confirmed): every incident becomes a runbook; every runbook is
   reviewed and updated. The "skill per failure" pattern is the
   postmortem principle applied to the model.

3. **The Pragmatic Programmer's Broken Window** (still canonical): a
   failure unaddressed invites the next failure. The kaizen loop is the
   antidote.

## The 5 steps

1. **Pause** after 3 failures on the same task. No 4th retry.
2. **Research** the root cause. Cite the primary source: the manual
   section, the stack trace line, the error code, the spec.
3. **Write** the skill. Scope, research, failure modes, success
   criteria, dependencies, incompatible skills. All 9 checks.
4. **Save** the draft to `.aide/kaizen/drafts/<skill-name>/SKILL.md`.
5. **Approve** by the operator. Approval moves the skill to
   `skills/<name>/SKILL.md` and the orchestrator catalog picks it up.

## Integration

This skill is downstream of `learn-from-mistakes.md` (the high-level
principle) and upstream of `skill-writer.md` (the envelope
constraints). The kaizen loop is the trigger; the skill-writer SOP
is the contract; learn-from-mistakes is the philosophy.

The 3-successful-uses-surfaces-as-trusted-by-past rule means: kaizen
skills graduate into the standard catalog over time. Failures become
the most reliable skills in the operator's toolbox.
