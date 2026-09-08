---
name: failure-lsp-completion-timeout
description: Diagnose a legacy-daemon LSP completion timeout without masking lifecycle or process defects. Use whenever scripts/acceptance-real.mjs or an equivalent real TypeScript-language-server probe returns LSP request timed out.
---

# LSP Completion Timeout

## Procedure

1. Stop the chained battery at the first timeout. Record the exact route,
   request method, status, timeout, and child process boundary.
2. Verify known test ports and list only test-owned Node/LSP children. Never kill
   active Python training or corpus processes.
3. Reproduce `node scripts/acceptance-real.mjs` in isolation before changing a
   timeout. Capture daemon stderr and the language-server command, exit state,
   and request sequence.
4. Compare the sequence with `tests/arch/lsp-contract.test.ts`: initialize,
   initialized, didOpen, request, response, shutdown, exit. Check for duplicate
   initialization, missing readiness, URI rewrites, framing loss, or a dead
   child.
5. Instrument the boundary with bounded stderr/exit diagnostics. Do not turn a
   timeout into a success, add an arbitrary delay, or raise the timeout before
   identifying the mechanism.
6. Apply one minimal protocol/lifecycle fix, then run the focused acceptance and
   LSP contract tests separately. Restart the full battery only after both pass.
7. Verify zero test-owned children/listeners and remove temporary evidence after
   every run.

## Known AIDE Risk

`daemon/lsp-manager.mjs:start()` performs an internal initialize/initialized
handshake. `scripts/acceptance-real.mjs` also sends an explicit initialize and
initialized sequence. Treat this as a protocol question to verify, not an
assumption that either sequence is harmless. The manager must also expose enough
child stderr/exit evidence to distinguish a slow TypeScript server from a
framing or lifecycle defect.

## Anti-Patterns

- Increasing the 15-second request timeout without a measured cause.
- Adding sleeps to make a race less visible.
- Skipping completion or accepting a 500 as a valid degraded result.
- Killing all Python or Node processes during cleanup.
- Rerunning `npm test` repeatedly while the focused acceptance failure is still
  unexplained.
