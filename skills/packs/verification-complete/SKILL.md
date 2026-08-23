---
name: verification-complete
description: The full-verification standard and Standard Operating Procedure — after you do everything, NEVER assume it worked. Go through and run actual tests and real tasks that verify the work works COMPLETELY through and through — smoke tests are forbidden as proof. Research-grounded: NASA SWE-066/SWE-104/SWE-191 and NASA-GB-8719.13 (test levels, independent verification, requirements traceability, regression), stateful workflow verification (execute real workflows, inspect durable state, assert invariants), Sonar AC/DC Verify pillar (mandatory, comprehensive, automated, zero-trust, AI cannot verify AI), Qwen /verify deep-verification lane (A/B against base, vacuity checks, adversarial audit), and mutation testing (tests must fail when code is broken). Use at the end of every task, before every "done", and whenever a claim of working needs proof.
---

# Verification-Complete

A smoke test proves the thing started. This skill proves the thing WORKS —
through and through, end to end, in the real environment, on the real task, with
the real state checked. "Done" means verified, and verified means the battery
below was executed and recorded.

## The Doctrine

1. **Smoke tests are not verification.** Lint/typecheck/parse/single-happy-path
   runs are gatekeepers, not proof. The verification that matters is: execute the
   REAL task like a real user would, and assert the REAL outcome and the REAL
   durable state — not "request returned 200" but "the record exists, the state
   converged, the workflow is correct."
2. **Behavioral confidence, not just structural confidence.** Structural checks
   (parses, compiles, coverage numbers) tell you the change is plausible.
   Behavioral proof tells you the product still works: the user action happened,
   the system responded, the intended outcome was true.
3. **Verify state, not just output.** After each meaningful step, inspect the
   durable state: files created, DB rows, records, logs, artifacts, downstream
   effects. If the page says success but the state is wrong, it FAILS.
4. **The generator is never the verifier.** (Sonar: AI cannot review AI; NASA:
   independent verification is most effective.) Review and verify in a separate
   pass. Never grade your own output in the same context that produced it.
5. **Tests must be able to fail.** (Mutation testing / vacuity checks.) A test
   that still passes when the implementation is broken is fake. Prove the test
   has teeth: revert the fix and watch the test fail; check for vacuous
   assertions; never modify tests to make them pass.
6. **Independent confirmation on anything that ships.** At minimum, replay the
   exact commands yourself and read the output. For a release: run the full
   gate matrix, adversarial-audit the counts, and re-run any test whose procedure
   was flawed or aborted (NASA lesson 0938).

## The Standard Operating Procedure (SOP) — every task ends this way

**STEP 1 — Write the acceptance battery BEFORE you call anything done.**
   Enumerate the REAL tasks the deliverable must perform (the user journeys, the
   model gates, the workflows). Each item has: the exact command/action, the
   expected observable outcome, and the expected durable state. This battery is
   the definition of done.

**STEP 2 — Execute the real task end to end.**
   Run each real task in the real environment (real model, real checkpoints, real
   data, real render, real preview). No mocks for the thing under test. Seed
   deterministic inputs so results are repeatable.

**STEP 3 — Assert the outcome AND the state.**
   After the task completes, check: (a) the user-visible outcome matches intent,
   and (b) the durable state is correct — artifacts exist and are parseable, no
   corruption, no silent divergence. Assert invariants (e.g. "spec parses AND
   novelty ≥ floor AND kind matches brief"), not just "no exception thrown."

**STEP 4 — Cover the boundaries, not just the happy path.**
   Run the failure paths: empty/malformed/invalid input, worst case, limits,
   the error branch, the second call, the concurrent case, full operational range
   (NASA: unit and integration testing at minimum must test the full range of
   parameters). Test what the system must NOT do as well as what it must do.

**STEP 5 — Prove the tests have teeth.**
   For every check that passes, ask: would it fail if the work were broken?
   Verify by reverting/breaking the change and confirming the test fails, or by
   adversarial review of the assertions. If the test cannot fail, it is not a test.

**STEP 6 — Regression.**
   Re-run the checks for what already worked (existing capabilities, earlier
   gates) to prove the new change did not break them (NASA SWE-191). A change
   that improves one format/gate by regressing another is not done.

**STEP 7 — Record and report.**
   Log every executed test with its observed result in AGENT_NOTES. Report
   observations, not expectations. Disclose anything not exercised (the
   unverified remainder) explicitly. A partial result honestly reported beats a
   full result falsely claimed.

## Gate

The task is done only when every item in the acceptance battery passed in the
real environment, the teeth check held, regression passed, and the results are
logged. If any item failed or was skipped, the task is NOT done — fix, re-run,
or name the gap out loud and ask the user before claiming anything.
