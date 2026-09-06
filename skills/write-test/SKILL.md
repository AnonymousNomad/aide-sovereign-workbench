---
name: write-test
version: 1.0.0
category: test
applies_to:
  - test
  - test first
  - tdd
  - unit test
  - regression test
tools_required:
  - read_file
  - search
  - bash
  - write_file
sop: |
  1. List the behaviors you need to verify. Each behavior becomes one test. Without a list, you're guessing.
  2. Write the test FIRST. The test must fail before the code exists. If the test passes, you wrote the code first. That's a fix, not a test.
  3. The test must be small: one assertion, one behavior, one name. "test_user_can_login_and_logout_and_reset_password" is three tests.
  4. The test must be fast: under 100ms per test, under 1s per file. Slow tests don't get run.
  5. The test must be deterministic: same input, same output, every time. No time-of-day, no network, no random.
  6. Run the test. RED. The test must fail. If it passes, the test is wrong (the behavior already exists) or the system is wrong (the behavior is missing). Investigate before continuing.
  7. Write the SIMPLEST code that makes the test pass. "Simplest" means: no abstractions, no future-proofing, no edge cases not covered by the test.
  8. Re-run the test. GREEN. If it fails, the simplest code is wrong. Iterate, do not guess.
  9. Refactor while the test is green. Now you can rename, extract, move, replace. The test holds the behavior while you improve the structure.
  10. Add the next test. Repeat.
description: |
  Test-driven development: red, green, refactor. One test, one behavior,
  one assertion, one name. The test is the contract; the code is the
  response. Sources: Kent Beck's "Test-Driven Development by Example"
  (canonical, 2003), BDD's Five Whys + test-first discipline
  (agilealliance.org, confirmed), the "Red-Green-Refactor" cycle
  (en.wikipedia.org, primary), The Pragmatic Programmer's "Test
  Automatically" chapter. Without a test that fails, the code you write
  is a fix, not a feature.
failure_modes:
  - condition: test passes before the code exists
    recovery: the test is wrong; investigate why the behavior is already there
  - condition: test runs in >100ms
    recovery: the test is too broad; split it, or the system under test is doing I/O it should not
  - condition: test is non-deterministic
    recovery: mock the non-determinism (time, network, random); the test must pass or fail on every run
  - condition: 3+ tests fail together
    recovery: run them individually; one is the root cause
  - condition: 3+ tests fail in the same module
    recovery: the module is doing too much; the failure is a structural smell
success_metrics:
  - test-first-rate: 100% of new behaviors have a failing test before code
  - test-fast-rate: 95% of unit tests run in <100ms
  - test-deterministic-rate: 100% of tests are deterministic; flaky tests are marked for rewrite
  - red-green-cycle-time: median <10 minutes per cycle
---

# Write Test

Test-driven: list, write, fail, code, pass, refactor. One test, one
behavior, one name. The discipline is the test-first cycle.

## Why this exists

Four primary sources ground this skill:

1. **Kent Beck's "Test-Driven Development by Example"** (canonical,
   2003): the test is the contract; the code is the response. The
   cycle is red, green, refactor.
2. **BDD's Five Whys + test-first discipline** (agilealliance.org,
   confirmed): the test is the specification; the implementation is
   the response.
3. **Red-Green-Refactor cycle** (en.wikipedia.org, primary): the test
   that fails is the fingerprint. The test that passes is the safety net.
4. **The Pragmatic Programmer's "Test Automatically"** (canonical,
   1999-present): without a test, you're guessing.

## The 10 steps

1. **List** the behaviors. Each becomes one test.
2. **Write the test first.** Must fail before the code exists.
3. **Small:** one assertion, one behavior, one name.
4. **Fast:** under 100ms per test, under 1s per file.
5. **Deterministic:** same input, same output, every time.
6. **Run.** RED. The test must fail.
7. **Simplest code** that passes. No abstractions, no future-proofing.
8. **Re-run.** GREEN. If it fails, the simplest is wrong; iterate.
9. **Refactor** while green. The test holds the behavior.
10. **Repeat** for the next test.

## Integration

- The `verify-before-claiming` SOP (L0): a test that fails is
  evidence. A test that always passes is not evidence. This skill
  produces the evidence.
- The `minimal-diff` SOP (L0): one test = one concern = one commit.
- The `developer-credo` (L0.5): the credo says "verify every claim."
  This skill is the operational form.
- The `debug-error` skill: when a test fails, debug-error is the
  upstream step. This skill produces the regression test that
  debug-error demands.
