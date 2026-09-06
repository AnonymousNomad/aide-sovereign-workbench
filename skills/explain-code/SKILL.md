---
name: explain-code
version: 1.0.0
category: review
applies_to:
  - explain
  - document
  - understand
  - code review
  - explain code
tools_required:
  - read_file
  - search
sop: |
  1. Read the file under explanation end-to-end before writing any prose. The code is the primary source.
  2. Identify the entry point first. A function, a route handler, a CLI flag, a config key — the thing the user touches.
  3. Trace one request path from entry to return. Cite file:line at every step. "I think it does X" is not allowed; "at src/foo.ts:42 the function returns X" is.
  4. Name the contracts. The function's input types, output types, the error paths. Cite the signature at file:line.
  5. State what the code does NOT do. Misconceptions live in the gaps. "X does not validate Y" is often more useful than "X does Z."
  6. Surface any uncertainty. "I do not see a test for X" is a finding. "I am not sure why this branch exists" is a finding.
  7. Use the project's vocabulary. If the operator calls it a "handler," call it a "handler." If the code calls it a "controller," use both.
description: |
  Explain code by reading it end-to-end, tracing one path, citing every
  claim. Explain what the code does AND what it does not do. Sources:
  The Pragmatic Programmer's "Good Code Is Its Own Documentation"
  (canonical), Martin Fowler's "Refactoring Improving the Design of
  Existing Code" (refactoring.guru, primary, Chapter 3), Agile's
  "Information Radiators" (agilealliance.org). The skill is the
  operator's onboarding material; new contributors run it to come up
  to speed on a codebase.
failure_modes:
  - condition: prose is generic and not tied to file:line
    recovery: every claim must cite file:line; prose without citations is rejected
  - condition: explanation omits error paths
    recovery: surface what happens on failure; this is what new contributors need most
  - condition: explanation says "it does X" without saying "and NOT Y"
    recovery: always state what the code does not do; gaps are where bugs live
  - condition: vocab drifts from the project
    recovery: use the project's terms; if the operator uses "handler," call it a "handler"
success_metrics:
  - citation-density: minimum 1 file:line citation per prose paragraph
  - error-path-coverage: 100% of explanations include the failure case
  - gap-coverage: 100% of explanations include at least 1 explicit "X does NOT do Y" statement
  - onboarding-time: new contributors reach baseline comprehension in under 30 minutes via this skill
---

# Explain Code

Read the file end-to-end, trace one path, cite every claim. Explain what
the code does AND what it does not. The operator's onboarding material;
new contributors run it to come up to speed on a codebase.

## Why this exists

Three primary sources ground this skill:

1. **The Pragmatic Programmer's "Good Code Is Its Own Documentation"**
   (canonical 1999-present): the code is the source of truth; comments
   lie. The model's job is to read the code, not the comments.

2. **Martin Fowler's Refactoring** (refactoring.guru, primary, Chapter 3):
   "Bad Code Smells" — the long methods, the big classes, the feature
   envy. The skill surfaces these by reading the code, not by guessing.

3. **Agile's "Information Radiators"** (agilealliance.org): good
   documentation lives where the team works. This skill produces
   documentation that lives in the model's working memory, not in a
   forgotten wiki.

## The 7 steps

1. **Read** end-to-end before writing any prose.
2. **Identify** the entry point.
3. **Trace** one request path, citing file:line at every step.
4. **Name** the contracts (input types, output types, error paths).
5. **State** what the code does NOT do.
6. **Surface** uncertainty ("I don't see a test for X" is a finding).
7. **Use the project's vocabulary.**

## Integration

- The `cite-the-source` SOP (L0) requires citations. This skill produces
  them in bulk.
- The `minimal-diff` SOP (L0) prefers small, targeted changes. This
  skill explains the existing code before the change; the explanation
  becomes the regression test.
- The `learn-from-mistakes` SOP (L0): when a contributor gets a
  codebase wrong because they didn't understand it, this skill is the
  antidote. Run it before every meaningful change.
