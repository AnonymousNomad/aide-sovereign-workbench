---
name: failure-ci-platform-parity
description: Diagnose cross-platform CI failures where Windows-local tests pass but Ubuntu or macOS architecture tests fail. Use when GitHub annotations identify OS-specific commands, filesystem error codes, or environment-dependent executable probes.
---

# CI Platform Parity

## Procedure

1. Read the failed GitHub annotation and identify the first failing test,
   runner OS, command, and actual error code before changing code.
2. Classify the behavior: Windows-only capability, portable behavior with
   platform-specific error codes, or a test using an environment-specific
   candidate.
3. For Windows-only operations, guard the real test with an explicit platform
   skip and keep the Windows battery as the live proof. Do not pretend Linux
   has PowerShell or desktop APIs it does not provide.
4. For filesystem errors, assert the documented cross-platform set of valid
   error codes while preserving the invariant being tested.
5. For executable resolution, create a real temporary candidate and assert
   the resolver's actual contract; never assert that a nonexistent path is
   usable.
6. Run each corrected test locally, then the full local Veritas gate. Push only
   after the local result is green, and inspect the new GitHub annotations/run
   conclusion before claiming CI recovery.

## Anti-Patterns

- Converting a platform-only test into a fake mock that never exercises the
  real platform implementation.
- Changing production behavior solely to satisfy an invalid environment test.
- Accepting every error code instead of the specific portable alternatives.
- Treating a local Windows pass as proof of a Linux CI pass.
