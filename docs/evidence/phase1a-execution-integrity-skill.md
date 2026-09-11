---
name: phase1a-execution-integrity
description: Local repair procedure for reproduced execution-integrity failures; not a runtime skill pack.
---

# Research and repair discipline

Baseline: phase1a-regression-before.json, 8 passing / 13 failing, zero cancelled/skipped.

- Direct dispatch trusted a model argument via truthiness and treated sandbox selection as approval. Derive permission from tool metadata and trusted pending session decisions; direct routes without such state must reject mutation before creating directories.
- decide() treated every decision except reject/abort as approve. Validate exact enum in the service, consume pending authority once, and require an exact approve result before execution.
- The async skills factory was not awaited; both registry and provider errors were discarded. Preserve the scorer; fail observably for broken configured context; distinguish empty matches from injected content.
- A tool returned ok:false without throwing, but the loop recorded success. Require ok === true and preserve failed execution separately from verification.
- Completion/tool-success is not task verification. No independent requirements/test evidence exists in the current agent path. Expose incomplete/unavailable instead of inferring test success from arbitrary command output.
- cipher-state.append swallowed filesystem errors before the audit wrapper saw them. Return structured persistence results without throwing by default. Record success only after awaited write/flush/close; do not infer subscriber delivery.
- EventHub silently returned void on schema rejection. Return explicit accepted/rejected at this authority. Keep subscriber delivery separate and prove it with a real facade WebSocket fixture.
- Native Windows glob argument harness/*.mjs was not expanded by rg; use rg -g '*.mjs' harness. No retry with the same invalid glob.
- Baseline had delayed startup/output (111.7 s total); it completed normally with all assertions reported. PID 2684 had already exited when targeted stop was attempted. Confirm live ancestry before any termination; never kill by process name.

Use isolated fixtures, retain before/after evidence, run sequentially, validate required schemas, and stop for any further production-file expansion. Do not launch operator models or training jobs.

Typecheck first pass: TS7016 at the new fixture's static facade import. The facade has no sibling declaration. Keep the typed adapter local to the approved test file (dynamic URL import with an explicit inspected interface); no production facade/declaration change and no compiler suppression. The general declaration skill's sibling-file recommendation is outside this phase's boundary and is unnecessary for a test-only adapter.

Affected regression run: phase1a-affected-1.json, 57/59 passing, zero cancelled/skipped. STOP before retry:

- Audit session HTTP 500: new context audit rows have error:null on success/no-match, while AuditEvent.error is z.string().optional(). Correct this specific shared field's nullability and add a read-route regression; do not loosen the audit schema globally. This is inside the approved boundary.
- Prompt-tier cleanup ENOTEMPTY: test-agent-loop-tier.mjs starts sessions to inspect the synchronous prompt, then immediately recursively removes their workspaces in afterEach. Evidence writing now awaits persistence and overlaps that teardown. Fix the test lifecycle by awaiting terminal session status before removing the fixture, without changing prompt assertions or suppressing cleanup errors. This test file is outside the approved list: collaborator approval required before editing. Do not disable persistence to accommodate premature test cleanup.
- Initial repaired execution-integrity run was 29/29 passing (phase1a-regression-after-1.json). That result is narrower than the affected regression run; Phase 1A is NOT complete.

Approved tier repair uses a promise resolved by the existing done/error/aborted event, emitted after evidence persistence. afterEach awaits that promise before removal. No sleep/retry/ENOTEMPTY suppression; all 16 assertion lines across four tests match HEAD.

Full architecture run 1 environment diagnosis: py --list-paths selects a Windows Store Python 3.13 executable; py -3 -c print(1) fails with Access is denied. ExerciseEngine tries that launcher before other candidates and correctly reports verifier unavailable, producing two test failures. The existing E:\Python310\python.exe runs successfully and has debugpy installed (importlib probe true). Use AIDE_PYTHON=E:\Python310\python.exe only in the verification child environment, then rerun the affected Python tests and full battery. No system PATH edit, package install, or source expansion. Preserve the first run's failures and debugpy skip.

Diagnostic filename mistakes: exercise-engine.test.ts, dap-real.test.ts and dap-manager.test.ts do not exist. Actual files are exercise-routes.test.ts and dap-contract.test.ts. Use rg --files or rg over the known directory rather than guessing test filenames.

Full architecture run 1 process checks: sandbox tasklist /FI "PID eq 6872" /FO CSV /NH returned ERROR: Access denied, while the identical elevated query returned the live node.exe PID. Thus process-manager's alive-before assertions failed before cleanup, leaving interval children 6872/6204 under the verified process-manager test worker 17692. Both children were identity-checked and stopped, with zero survivors verified. Preserve the failed run as requiring manual cleanup. Run the focused process tests and full architecture battery with elevated process-query permission plus the explicit Python environment. Do not alter process-manager or relax its assertions for a sandbox restriction.

After user resume, the sandbox helper failed before applying the final documentation patch with helper_unknown_error: apply deny-read ACLs. Elevated read-only checks confirmed no patch changes. The apply_patch.bat wrapper then truncated the multiline argument (last line must be End Patch). Inspection showed a native codex.exe --codex-run-as-apply-patch wrapper: invoke that native patch entrypoint directly with explicit approved execution to preserve the single multiline argument. Do not change ACLs or bypass approval. Recycled test PIDs belonged to svchost/WMIADAP: never kill by stale ID alone. Operator generation restarted under its supervisor; preserve it once heavy testing is finished.

Phase-1A closeout staging: `git add -p -- AGENT_NOTES.md` with PTY failed before presenting a hunk because the Windows PTY CreateProcess call returned OS error -1073283067. Do not retry the same interactive mechanism. Build a minimal unified patch against HEAD containing only the Phase-1A journal insertion, apply it to the index with `git apply --cached`, verify the cached diff excludes the adjacent Phase-0 entry, then remove the temporary patch through `apply_patch`. This keeps unrelated journal work in the working tree.

The first cached-patch check then reported `corrupt patch at line 11`: its header declared 6 original/8 resulting lines, but its body had only 4 original/6 resulting lines. The index remained unchanged. Correct the header to `@@ -5,4 +5,6 @@`; verify with `git apply --cached --check` before applying. Unified diff hunk counts must equal context-plus-removal/addition body counts.
