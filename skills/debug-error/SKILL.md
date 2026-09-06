---
name: debug-error
version: 1.0.0
category: debug
applies_to:
  - debug
  - error
  - trace
  - failure
  - investigate
tools_required:
  - read_file
  - search
  - bash
  - git_diff
sop: |
  1. Reproduce the failure first. Cannot reproduce = cannot fix. Run the failing command, capture the full output, store it as a trajectory entry.
  2. Read the error message verbatim. Quote it back in the analysis. Then read the 5 lines BEFORE and the 10 lines AFTER. The bug is rarely at the line the error points to.
  3. Form one falsifiable hypothesis. "It is X because Y, which we can test by Z." Not "it might be the thing."
  4. Test the hypothesis with a minimal change. Cite the file:line. If the hypothesis is wrong, the test fails and the next hypothesis starts from the original failure.
  5. Never retry a 4th time on the same error. After 3 attempts with similar stack traces, the kaizen-loop skill triggers. The next action is research, not retry.
  6. After the fix, add a regression test that reproduces the original failure. The test must fail without the fix and pass with it.
  7. Record the root cause in the trajectory store. File:line, error code, hypothesis, fix, citation. This is the audit trail.
description: |
  Debug errors with discipline. Reproduce, read context, form a falsifiable
  hypothesis, test it minimally, never retry a 4th time, add a regression
  test, record the root cause. Sources: The Pragmatic Programmer's
  "Debugging Time" chapter (canonical, 1999-present), Chrome DevTools
  debugging philosophy (chromedevtools.github.io, primary), TDD's red-green
  cycle (the test that fails is the bug's fingerprint), Martin Fowler's
  "When to Make a Method Private" (refactoring.guru, primary).
failure_modes:
  - condition: error is in a library, not your code
    recovery: read the library's docs for the function that failed; cite the doc section in the analysis
  - condition: error only happens in production, not locally
    recovery: capture the production state (env vars, request, logs); do not guess
  - condition: fix introduces a new bug
    recovery: revert immediately; the fix is wrong; the original bug is still there
  - condition: 3-fail pattern without root-cause analysis
    recovery: kaizen-loop skill triggers; research before the 4th attempt
success_metrics:
  - first-attempt-fix-rate: 50% of errors fixed on the first hypothesis
  - time-to-reproduce: median 5 minutes from error to reproduced
  - regression-test-coverage: 100% of fixed bugs have a regression test
  - kaizen-trigger-rate: 100% of 3-fail patterns produce a kaizen draft within 24h
---

# Debug Error

Reproduce, read context, form one hypothesis, test minimally, never retry
the 4th time. The discipline is the test-first cycle applied to bug fixing.

## Why this exists

Four primary sources ground this skill:

1. **The Pragmatic Programmer's "Debugging Time" chapter**
   (canonical 1999-present): reproduce, read context, hypothesize, test
   minimally. The discipline.
2. **Chrome DevTools debugging philosophy** (chromedevtools.github.io,
   primary): pause on exception, read the call stack, step through the
   state. The model does the same with `read_file` and `search`.
3. **TDD's red-green cycle** (en.wikipedia.org, confirmed): the test
   that fails is the bug's fingerprint. A regression test that reproduces
   the original failure is non-negotiable.
4. **Martin Fowler's "When to Make a Method Private"** (refactoring.guru,
   primary): the fix lives at the right level of abstraction. Refactor to
   the right place, not the convenient place.

## The 7 steps

1. **Reproduce** first. Cannot reproduce = cannot fix.
2. **Read** the error verbatim, then 5 lines before, 10 lines after.
3. **Hypothesize** with one falsifiable claim.
4. **Test** minimally. Cite file:line.
5. **Stop** after 3 similar failures. The 4th attempt is research, not
   retry. Kaizen-loop triggers.
6. **Regression-test** the original failure. Without the fix, the test
   fails. With the fix, it passes. Always.
7. **Record** the root cause in `.aide/trajectories/<date>/<session>.jsonl`.
   File:line, error code, hypothesis, fix, citation.

## Integration

- The `verify-before-claiming` SOP (L0) requires a regression test as
  evidence. This skill produces that test.
- The `kaizen-loop` skill triggers after 3 failures. This skill is
  the upstream trigger.
- The `fail-closed` SOP says: do not guess-and-continue. This skill is
  the operational form of that rule.
