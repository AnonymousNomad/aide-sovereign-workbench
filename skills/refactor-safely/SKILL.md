---
name: refactor-safely
version: 1.0.0
category: refactor
applies_to:
  - refactor
  - restructure
  - cleanup
tools_required:
  - read_file
  - write_file
  - bash
sop: |
  1. Before any refactor, run the existing tests and confirm they pass. A refactor on a red baseline is a fix, not a refactor.
  2. Identify the smell. Name it: "long method," "feature envy," "shotgun surgery." Cite the canonical source. Without a named smell, the refactor is a rewrite.
  3. Plan the change as a series of TDD cycles. Each cycle: red test, green test, refactor. One cycle = one commit.
  4. Make the smallest change that addresses the smell. Prefer Rename > Extract Method > Move Method > Replace Conditional with Polymorphism. Catalog order is the priority order.
  5. After each cycle, re-run all tests. Green before the next cycle. If red, revert that cycle's commit, do not stack on top.
  6. Update the trajectory: which smell was addressed, which cycle, which tests verify the behavior, which commit SHA.
description: |
  Refactor safely: red-green-refactor cycles, smallest change per cycle,
  re-run all tests after each cycle, revert if red. Sources: Martin
  Fowler's Refactoring (refactoring.guru, primary, Chapter 1: the
  definition), Kent Beck on TDD red-green (en.wikipedia.org, confirmed),
  the Working Effectively with Legacy Code discipline (Feathers,
  canonical, 2004-present), The Pragmatic Programmer's "Refactoring"
  chapter. Refactoring on a red baseline is a fix, not a refactor.
failure_modes:
  - condition: refactor on a red baseline
    recovery: revert; fix the failing tests first; the refactor becomes a separate cycle
  - condition: change without a named smell
    recovery: name the smell from the canonical catalog; if you can't, the change isn't a refactor
  - condition: change stacks without re-running tests
    recovery: revert; re-run tests after every cycle; green before the next
  - condition: change touches more than one smell
    recovery: split into multiple refactor commits, each with one named smell
success_metrics:
  - red-baseline-refactor-rate: 0% — no refactor starts on red
  - one-smell-per-commit: 100% — each refactor commit addresses exactly one canonical smell
  - test-re-run-rate: 100% — tests re-run after every cycle, green before the next
  - catalog-coverage: the 5 most-used smells (rename, extract, move, inline, replace-conditional) cover 80%+ of all refactors
---

# Refactor Safely

Refactor on a green baseline. TDD cycles, smallest change per cycle, re-run
tests after each. Name the smell from the canonical catalog before changing
code. Catalog order is priority order: Rename, Extract, Move, Inline, Replace.

## Why this exists

Four primary sources ground this skill:

1. **Martin Fowler's Refactoring** (refactoring.guru, primary, Chapter 1):
   the definition. "Refactoring is a disciplined technique for restructuring
   an existing body of code, altering its internal structure without changing
   its external behavior." The discipline: red, green, refactor.

2. **Kent Beck on TDD red-green** (en.wikipedia.org, confirmed): the
   test that fails is the bug's fingerprint. The test that passes is the
   refactor's safety net.

3. **Working Effectively with Legacy Code** (Feathers, 2004-present,
   canonical): the seams of the system are where you refactor. Without
   seams, you refactor by guess.

4. **The Pragmatic Programmer's "Refactoring"** (canonical, 1999-present):
   refactor early, refactor often, leave the code cleaner than you
   found it.

## The 6 steps

1. **Green baseline.** Tests pass.
2. **Name the smell** from the canonical catalog.
3. **Plan TDD cycles.** One cycle = one commit.
4. **Smallest change** that addresses the smell.
5. **Re-run all tests** after each cycle. Green before the next.
6. **Update the trajectory** with the smell, the cycle, the tests, the SHA.

## Integration

- The `minimal-diff` SOP (L0): this skill produces the smallest possible
  diff per cycle. One smell = one cycle = one commit.
- The `verify-before-claiming` SOP (L0): the test that passes is the
  evidence. The skill requires a passing test before every commit.
- The `fail-closed` SOP (L0): a red cycle is reverted, not stacked
  on. The discipline is failure-stop, not failure-ignore.
- The `developer-credo` (L0.5): the credo says the next action is
  research, not retry. This skill is the operational form: name the
  smell, plan, execute, verify.
