---
name: audit-probe-discipline
description: Local Phase-0 diagnostic procedure for quoting, stale runner references, and restricted Windows inventory queries.
---

# Audit probe discipline

Scope: audit tooling only; no product changes or runtime skill registration.

## Observed failures

- A Node `--input-type=module -e` probe lost double quotes through Windows PowerShell native argument serialization. Its import was invalid JavaScript. This was a diagnostic failure, not a product test result.
- `failure-battery-memory-pressure-504` references `scripts/run-bounded-arch.mjs`, absent at HEAD 536d089. The existing runner is `scripts/run-arch.mjs`; CI bounds execution in its workflow.
- Sandbox CIM and Get-NetTCPConnection reads returned Access denied. Use normal escalation, not an unrestricted workaround.
- A tool orchestration call had an extra closing delimiter and failed before executing. Keep orchestration statements simple and balanced.
- The first full-wiring probe reached the facade but agent/start exceeded its 10-second observation deadline while its context resolver consulted the real model inventory. A scripted chat callback does not isolate model discovery. Use the existing modelRuntime injection with a real ModelRuntime loaded from an empty fixture manifest to isolate skill injection. Preserve the timed-out run; do not label it a pass or increase product timeouts.
- A changed llama-server PID belonged to the operator's Python parent (13768), not the audit. Verify ancestry before attributing processes; do not terminate an operator process.

## Procedure

1. Inspect the error before retrying. Separate failed tools, expected negative probes, and product defects.
2. Put substantial diagnostic JavaScript in an audit-only `.mjs` file using apply_patch; execute `node <file>`. Do not interpolate source into native command arguments.
3. Verify referenced runner paths with rg --files or Test-Path before invoking them. Inspect the actual runner for process, network and write effects.
4. Request escalation for necessary inventory reads rejected by the sandbox. Continue independent source inspection while approval is pending.
5. Never start another model or a heavy battery alongside operator workloads. Record deferred checks and their reason.
6. Keep fixtures isolated, preserve raw outputs and JSON results, and verify audit-owned processes have exited. Do not modify product code to make an audit green.
7. Use rg --files to discover paths before reads (no guessed .githooks, desktop/src-tauri, or scripts/lib paths). Missing documentation references are findings, not permission to invent a runner.

## Verification

Run the file-based diagnostic, confirm it parses and records the asynchronous factory return type, and retain earlier command failures in the evidence ledger. Confirm test commands use files present in this checkout. Report denied/deferred inventory honestly.
