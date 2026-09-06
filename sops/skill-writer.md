---
name: skill-writer
version: 1.0.0
category: discipline
applies_to:
  - write skill
  - new skill
  - skill envelope
  - catalog update
tools_required:
  - read_file
  - search
sop: |
  1. Every new skill goes through scope → research → primary sources → failure modes → success criteria → dependencies → incompatible skills BEFORE any code is written.
  2. Scope first: write a one-paragraph purpose statement; if it cannot be stated in one paragraph, the skill is doing too many things and must be split.
  3. Research second: at least 3 primary sources cited inline. No vibes, no "I think" — name the file:line, the RFC section, the standard, the paper.
  4. Failure modes third: at least 2 listed. Each is a {condition, recovery} pair. "Recovery" is a specific action, not a generic "retry."
  5. Success criteria fourth: at least 1. Numerical when possible (latency, accuracy, false-positive rate). No "looks good."
  6. Dependencies fifth: at least 1 declared tool + 1 declared SOP. "It works in isolation" is not a skill.
  7. Incompatible skills sixth: at least 1 if applicable. "This skill conflicts with X" is the operator's right to know upfront.
  8. Body length: between 200 and 6000 chars. Vague ramblers are rejected; thin check-the-box enablers are rejected.
  9. No new skill lands in the orchestrator's catalog without a passing grade on this SOP.
description: |
  Universal SOP: the premeditation discipline for writing a new skill.
  Every skill in the AIDE catalog is the operator's contract with the
  model — and with future operators. This SOP enforces the contract
  before the skill is written, not after. Sources: BDD's Five Whys
  (agilealliance.org), TDD's test-first cycle (en.wikipedia.org), The
  Pragmatic Programmer's "Don't Repeat Yourself" + "Broken Window" (still
  canonical 1999-present). Scope, research, failure modes, success
  criteria, dependencies, incompatible skills — in that order. The act of
  writing the skill IS the proof the skill-writer discipline works.
failure_modes:
  - condition: scope statement exceeds one paragraph
    recovery: split the skill into two and re-write the scope for each
  - condition: fewer than 3 primary sources cited
    recovery: the skill is rejected; the writer goes back to research before continuing
  - condition: success criteria are subjective ("looks good", "is fast")
    recovery: replace with a numerical threshold; if not measurable, the skill is not ready
  - condition: no incompatible skills declared
    recovery: explicit compatibility statement is mandatory; default is "no conflicts known" which is acceptable
  - condition: body length under 200 chars or over 6000
    recovery: too thin = rejected; too long = split into multiple skills
success_metrics:
  - skill-writer-completion-rate: every skill in the catalog has a 9-field frontmatter; zero exceptions
  - cited-source-density: at least 3 primary sources per skill, recorded as inline citations
  - failure-mode-coverage: zero skills with fewer than 2 named failure modes
  - body-length-distribution: 90% of skills land in 500-3000 chars
---

# Skill Writer

Every new skill is the operator's contract with the model — and with future
operators. The contract is the envelope: scope, research, failure modes,
success criteria, dependencies, incompatible skills, body. Without a
premeditated envelope, the skill is a guess that gets worse with each
refinement. This SOP enforces the contract before the skill is written.

## Why this exists

Three primary sources ground this discipline:

1. **BDD's Five Whys** (agilealliance.org, confirmed): the discipline
   of asking "why" before each proposed behavior prevents surface-level
   solutions. The skill envelope is the BDD-style "scope" for the skill.

2. **TDD's test-first cycle** (en.wikipedia.org, confirmed): the test
   is the contract; the code is the response. The skill envelope is the
   contract; the body is the response. No contract, no skill.

3. **The Pragmatic Programmer's "Broken Window"** (still canonical
   1999-present): a sloppy skill, like a broken window, invites more
   sloppiness around it. The envelope is the maintenance contract.

## When to apply

Every new skill in `skills/<name>/SKILL.md`. No exceptions. The
orchestrator refuses to add a skill that fails any of the 9 checks
above; the error message names the failing check.
