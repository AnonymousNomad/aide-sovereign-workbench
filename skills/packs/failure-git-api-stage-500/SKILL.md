---
name: failure-git-api-stage-500
description: Diagnose legacy Git API acceptance failures where an approved stage or commit request returns 500. Use whenever scripts/test-git-api.mjs fails inside a nested or full battery run.
---

# Git API Stage 500

## Procedure

1. Stop at the first failed request. Record method, route, status, response
   body, daemon PID, port, workspace, and daemon stderr.
2. Verify the test port is owned by the current test daemon. Never trust a
   response from a stale fixed-port process.
3. Reproduce `node scripts/test-git-api.mjs` in isolation. Use an ephemeral
   port or an explicit free-port probe; do not retry a hardcoded production or
   test port blindly.
4. Run the equivalent `git` command directly in the temporary repository and
   compare its stderr/exit code with the daemon route result. Check repository
   initialization, identity config, index locks, path validation, and cwd.
5. Apply the smallest root-cause fix. Do not turn a failed Git operation into
   HTTP 200 or hide the daemon error.
6. Rerun the focused script, then the arch Git route test, then the complete
   battery. Verify the daemon and all child processes are gone after each run.

## Anti-Patterns

- Asserting only HTTP status when the body contains the actual Git error.
- Assuming a fixed port is free because the previous process was expected to
  exit.
- Reusing the worktree or temp repository from a failed attempt.
- Treating a nested battery failure as a Git-service regression without a solo
  reproduction.
