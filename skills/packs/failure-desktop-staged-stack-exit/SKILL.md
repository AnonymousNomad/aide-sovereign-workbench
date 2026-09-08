---
name: failure-desktop-staged-stack-exit
description: Diagnose an early exit from the packaged AIDE stack launcher without losing child evidence. Use whenever desktop-staged-stack-smoke or a packaged launcher returns nonzero before backend readiness.
---

# Staged Stack Early Exit

## Procedure

1. Stop at the first nonzero launcher exit. Record the launcher PID, ephemeral
   ports, exit code/signal, and exact staged root.
2. Before deleting the temporary workspace, read and cap each child log under
   `.aide/logs/` for the arch, legacy, and facade processes. Preserve the
   diagnostics in the test failure output or an evidence artifact.
3. Check the staged paths and runtime package boundary: Node runtime, launcher,
   `node/src/server.ts`, `common/`, facade, daemon, and every external package
   imported by the staged server.
4. Reproduce with the same staged tree and ephemeral ports. Do not switch back
   to the source server or fixed production ports, since that can hide a
   packaging-only path/dependency defect.
5. Apply one minimal staging/launcher fix, rerun the staged smoke, and verify
   both TS and legacy routes through the facade.
6. Terminate the test launcher with a Windows tree-kill or a POSIX signal as
   appropriate, then verify zero launcher/child processes and listeners before
   removing the temporary workspace.

## Anti-Patterns

- Deleting the workspace before collecting child stderr.
- Treating launcher exit code `1` as a generic readiness timeout.
- Copying the entire development `node_modules` tree without an explicit
  runtime dependency list.
- Claiming packaged-stack readiness from source-tree tests alone.
- Adding a cross-platform smoke gate whose non-Windows cleanup is a no-op.
