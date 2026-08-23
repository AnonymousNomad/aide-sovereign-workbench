---
name: aide-release-engineering
description: >-
  Finish AIDE IDE release blockers with verification-first engineering,
  grounded in official research. Use whenever working on the
  aide-sovereign-workbench repository: desktop daemon lifecycle and real
  installer smoke tests, DAP fixture completeness (breakpoint stepping, stack,
  scopes, variables), editor parity (search, undo history, split groups,
  recovery), real-repository benchmark batteries, live external provider tests,
  plugin network capability hardening, accessibility/usability audits, or the
  final synchronized release build. Research first, encode the decision, act
  surgically, test live, and refuse unsupported completion claims.
---

# AIDE Release Engineering

## Creed (applies to every change)

**Research, decide, implement surgically, test live, record the result, refuse
unsupported completion claims.** AIDE is a pre-production release candidate,
not a finished VS Code replacement. Every claim in README/release artifacts must
be evidence-backed and no gate is skipped to reach green.

- Success criteria first: write the explicit criteria before editing.
- Cheapest discriminating check immediately after every edit.
- Fix the work, never weaken the check (no skipped/deleted/loosened tests).
- Automated proof must FAIL if the behavior regresses.
- Log every meaningful change in `docs/RESEARCH_LOG.md` and the master
  `AGENT_NOTES.md` (via skill: project-governance).
- Baseline before changing anything: `npm run check && npm test` must pass.
- Never interrupt GPU model training (R2); do CPU-only work while it runs.

## Verified Platform Facts

### Node.js permission model (source: nodejs.org/api/permissions.html, Node 24/25 release notes)

- Flag is `--permission` since Node 24.0.0 (`--experimental-permission` was a
  semver-major removal). Using the old flag = `bad option` crash on modern Node.
- Deny-by-default when enabled: fs, network, child processes, worker threads,
  native addons, WASI, FFI, runtime inspector.
- Grants: `--allow-fs-read=<path>` (path-scoped), `--allow-fs-write=<path>`,
  `--allow-net` (Node 25+, NOT in 24), `--allow-child-process`,
  `--allow-worker`, `--allow-addons`, `--allow-wasi`, `--allow-ffi`.
- `--permission-audit` mode reports violations without denying — use it to
  discover required grants before enforce mode.
- Runtime assertion: `process.permission.has('net')` etc. — fail loudly on bad
  config.
- **Seat belt, not a sandbox**: official docs say it does NOT provide security
  guarantees against malicious code. Deny network/child-process by default is
  blast-radius reduction, not a complete boundary. OS-level isolation
  (separate OS user / container / seccomp) is still required for untrusted code.
- CVE-2026-21636: v25 UDS connections bypassed `--allow-net` restrictions.
  Verify the running Node line's status before claiming network denial is
  airtight. Keep egress control at the network layer regardless.

### Debug Adapter Protocol (source: microsoft.github.io/debug-adapter-protocol, debugpy wiki, overview.md)

- Mandatory sequence: `initialize` first (server returns capabilities) →
  server sends `initialized` → client sends `launch`/`attach` → client sends
  `setBreakpoints` (REPLACES all breakpoints for that source, not incremental;
  unsettable breakpoints are returned `verified: false` and later corrected via
  `breakpoint` event) → `setExceptionBreakpoints` (if supported) →
  `configurationDone` → debuggee runs.
- On any stop, the adapter sends `stopped` (reason: breakpoint/step/exception/
  pause/entry; includes threadId). The client then runs the inspection
  waterfall: `threads` → `stackTrace` → `scopes` (per frame) → `variables`
  (per scope) → nested `variables`.
- Object references (`frameId`, `variablesReference`) are ONLY valid during the
  current stopped state and become invalid when execution resumes; reset
  numbering on each stop. `threadId` persists for the session.
- Control: `continue`, `next`, `stepIn`, `stepOut`, `pause` (all reference
  threadId). Debuggee launched: `terminate` (graceful) then `disconnect`
  (forceful) if it does not exit; always end with a `terminated` event.
- debugpy: adapter speaks DAP over stdin/stdout; launch scenarios require
  breakpoints set before `configurationDone`. Real breakpoint stepping requires
  a live debuggee fixture — session-event recording alone is not readiness.
  DEBUGPY CLIENT QUIRKS (verified 1.8.21 from source + wire probes): the
  `initialized` event is sent DURING launch/attach handling (not after
  initialize); the `launch` RESPONSE is deferred and only sent when the client
  issues `configurationDone` (`clients.py` line 282 `return
  messaging.NO_RESPONSE # will respond on "configurationDone"`) — awaiting the
  launch response before configurationDone hangs forever; the adapter process
  is long-lived and exits only after the client closes the channel (stdin
  EOF) — close it after `terminated` for a clean exit; pydevd reports reason
  `breakpoint` (not `step`) when a `next` lands in a comprehension frame on
  the same physical line as a breakpoint (keep breakpoint lines single
  frame-free statements); pydevd quotes dict keys and string values in
  `variables` responses (`'items'`, `'Fizz'`) and zero-pads list indices
  (`02`).

### Editor parity (source: code.visualstudio.com/docs/editing/codebasics, userinterface, custom-layout, microsoft/vscode Working Copies wiki)

- Find in file: highlights in editor + overview ruler; `closeOnResult`; query
  history restored across restarts.
- Search across files: results grouped by file with hit counts, click-through
  preview, replace with pending-diff preview, replace-all scoped per file.
- Undo/redo: editor model owns an undo stack; dirty state is derived from it;
  save clears the stack baseline; backups (hot exit) are deleted after save.
- Editor groups: split (Ctrl+\\), open-to-side, close group, move tabs,
  per-group MRU (Ctrl+Tab), group navigation (Ctrl+1..3), empty groups close
  by default. One TextDocument model can back multiple editor views.
- Recovery: persist session state (open files, active file, layout) without
  persisting secrets/prompts/source; restore on boot; unsaved edits restored
  from backups and marked dirty.

### Tauri desktop + NSIS installer (source: v2.tauri.app/distribute/windows-installer, tauri-apps issues #9950/#15134, PR #14479, real CI smokes)

- Sidecars: `bundle.externalBin` resolves to `src-tauri/{name}-{target-triple}.exe`.
  Rebuilds can serve a stale cached copy from `target/release/` — re-copy and
  checksum before bundling; log sidecar path/size.
- NSIS does NOT replace unversioned sidecar binaries on same-version reinstall,
  and a RUNNING sidecar holds a file lock that hangs the installer. Fix:
  `NSIS_HOOK_PREINSTALL` with `nsis_tauri_utils::KillProcessCurrentUser
  "<sidecar>.exe"` before file replacement. Tauri v2 uses the Windows Restart
  Manager for graceful main-app close on upgrade.
- Install modes: per-user default (%LOCALAPPDATA%, no admin); perMachine or
  both need admin. WebView2: downloadBootstrapper (default) / embedBootstrapper
  / offlineInstaller (~127MB) / fixedVersion / skip.
- Installer smoke tests (CI): silent install `/S /D=<dir>`, bounded timeouts
  (per-install cap ~480s + job timeout so hangs fail fast), stop app + sidecar
  process tree BEFORE the upgrade install, verify the registry Uninstall key,
  expected version metadata, then launch and smoke the sidecar/daemon health.
- Cleanup: no orphaned runtimes — the shell owns the daemon lifecycle
  (start on boot, terminate on app exit, crash cleanup). Windows child
  processes should be tied to a Job Object so the whole tree dies together.

### Real-repository benchmark battery (source: swebench.com harness/evaluation docs)

- Metric core: FAIL_TO_PASS (resolution) + PASS_TO_PASS (maintenance).
  Resolution: FULL = f2p==1 && p2p==1; PARTIAL = 0<f2p<1 && p2p==1; else NO.
- Reproducible environment per task (container/isolated workspace), apply
  patch, run tests, grade. Report per instance: patch_exists,
  patch_successfully_applied, resolved + raw logs.
- Record: public prompts, exact environment, latency, memory, patch acceptance,
  test pass rate, failures. No decorative mockups — screenshots/recordings of
  verified workflows.
- Cache by run_id: a new prediction requires a new run_id or it reuses stale
  results.

### Accessibility / usability (source: W3C WCAG 2.2, WebAIM checklist)

- WCAG 2.2 AA baseline: 2.4.7 Focus Visible (never `outline: none` without a
  replacement), 2.4.11 Focus Not Obscured (sticky UI must not fully cover
  focus — scroll-padding-top fix), 2.5.8 Target Size Minimum 24x24 CSS px
  (or spacing exception), 2.5.7 Dragging Movements needs a single-pointer
  alternative, 3.2.6 Consistent Help, 3.3.7 Redundant Entry,
  3.3.8 Accessible Authentication. 4.1.1 Parsing is removed in 2.2.
- ARIA APG composite widgets: Tab enters the widget, arrow keys navigate within
  (roving tabindex). Command palette, tab panels, tree, toolbar must follow it.
- Manual, non-automatable passes: full keyboard traversal (order, traps,
  visible focus), screen-reader pass (names, roles, states, status messages),
  200% reflow at 320px, contrast 4.5:1 text / 3:1 UI, reduced motion.
- Usability: every primary action has a searchable command + keyboard path
  (command palette); state changes are announced; no keyboard traps.

## Workflow SOPs (each = research → decide → act → test → record)

### Plugin network capability hardening
1. Spawn plugin children with `--permission` (never `--experimental-permission`)
   plus explicit grants derived ONLY from the plugin manifest's declared
   capabilities: default `--allow-fs-read=<pluginDir>`; add `--allow-fs-write=
   <pluginDir>`, `--allow-net`, `--allow-child-process` only if declared and
   trust-gated. Never grant network/child-process by default.
2. Keep: path-escape check (entry resolves inside pluginDir), `--no-addons`,
   stdin JSON payload, stdout JSON-only contract, 10s timeout, bounded output,
   trust-before-execute, no UI-process load.
3. Tests: untrusted plugin refused; entry escaping pluginDir refused; manifest
   WITHOUT network capability is denied network (probe with a fetch that must
   fail with ERR_ACCESS_DENIED); manifest WITH network capability gets
   `--allow-net`; invalid JSON output rejected; timeout kills the child.

### DAP fixture completeness (breakpoint stepping, stack, scopes, variables)
1. Launch a REAL debuggee fixture (debugpy on a small Python program) through
   the DAP manager and record the wire sequence.
2. Assert the full lifecycle: initialize → initialized → launch →
   setBreakpoints (before configurationDone) → configurationDone → stopped
   (reason breakpoint) → threads → stackTrace → scopes → variables → nested
   variables.
3. Assert stepping: continue/next/stepIn/stepOut produce new stopped events
   with changed state; object references reset per stop; threadId stable.
4. Assert teardown: terminate → disconnect → terminated event; no orphaned
   debuggee process remains.
5. Expose to UI only what the fixture proves; keep honest status.

### Editor parity (search, undo history, split groups, recovery)
1. Search: in-file find with highlight + query history; cross-file search
   grouped by file; replace with preview; replace-all per file; results
   click-to-navigate.
2. Undo: per-file undo stack with dirty-state sync; undo/redo round-trips
   byte-exact; save resets baseline; new edits after undo branch the stack.
3. Split groups: split active editor (Ctrl+\\), open-to-side, per-group tabs,
   group close/move, MRU navigation; same document model backed by multiple
   views stays consistent.
4. Recovery: persist only non-secret UI state atomically; restore on boot;
   unsaved edits restored as dirty; no prompts/credentials/source persisted.
5. Each feature: unit test + UI audit entry + daemon endpoint test. Tests fail
   on revert.

### Desktop daemon lifecycle + installer smoke tests
1. Local (no Rust): verify desktop prepare bundles daemon source + runtime,
   start/health/terminate the daemon process, assert clean exit and no orphans.
2. CI (Windows GitHub Actions): tauri build; installer smoke — silent install
   `/S /D=`, verify registry Uninstall key + version, launch app, daemon health
   HTTP 200, sidecar process alive; kill process tree; silent upgrade; verify
   version bump; uninstall; assert no leftover processes. Bound every install
   with a timeout and add job-level timeouts.
3. Rust compilation remains BLOCKED locally until cargo exists — record it as
   an open gate, do not claim desktop readiness.

### Real-repository benchmark battery
1. Use the existing acceptance/orchestrator harness against a real repo task
   set (not demo files): public task prompts, exact environment recorded.
2. Report per task: patch applied (yes/no), tests run (FAIL_TO_PASS +
   PASS_TO_PASS), resolution status, latency, memory, raw output, failure
   reasons. Never claim a pass without the raw test log.
3. Different run_id for different predictions; publish results JSON.

### Live external provider tests
- Local mode remains default; provider adapters only run with user-supplied
  credentials, keep credentials server-side, never persist keys or prompts in
  artifacts. Live tests are explicitly unrun without credentials — record that
  as an intentional gap, never fabricate provider responses.

### Accessibility + usability audit
1. Automated: UI audit script + axe-style scan (if tooling available) for alt,
  labels, contrast candidates, ARIA name/role/value, missing `aria-live`.
2. Manual (non-automatable): keyboard traversal of every interactive element
  (visible focus, logical order, no traps), screen-reader pass, 200% zoom /
  320px reflow, contrast 4.5:1 / 3:1, reduced motion, 24x24 target sizes,
  focus never obscured by sticky UI, command palette reachable by keyboard.
3. Fix defects by criterion, re-audit, record results in RESEARCH_LOG.

### CI pipeline hang — `node --test` never exits on ubuntu-latest (OPEN as of 2026-08-21)

**What/why:** since Phase 5/6 every push leaves the `verify` job red: the
architecture-tests step runs past its ceiling and is killed externally. Local
Windows gates are green (check:arch 188/188, ci-run-all ~55s), so the trigger
is CI-environment-specific. Branch protection requires the `verify` check, so
this blocks the release gate entirely.

**Verified mechanism (local repro, Node v26.4.0):** `--test-timeout` only
MARKS a hung test/hook as timed-out — the runner still awaits the underlying
promise forever. The file never completes, so `after()` hooks never run, so
any handle cleanup placed there never executes, and the open handle keeps the
child alive. A "timed out" line in output does NOT mean the runner moved on.

**Attempted fixes (do not retry blindly):**
1. `--test-timeout=90000` on check:arch (c50209d) — insufficient alone (see
   mechanism above).
2. `closeAllConnections()` before `httpServer.close()` in `after()` across 9
   test files (a6ff483) — correct hygiene, KEEP, but did NOT clear the hang
   (run #146 still killed at exactly 900s by `timeout 900`, exit 124).
   Explained by the mechanism: if the hang is inside a TEST BODY (not a
   hook), `after()` never runs at all.
3. Step split + `timeout 900` wrapper + ps-dump (4833c46) — proved no leftover
   child processes annotation appeared; kill is clean, hang is internal.

**Diagnostic in flight:** f17dc97 wraps the arch step with
`timeout -k 30 900`, tees output to /tmp/arch-out.txt, and on failure dumps
the last 80 lines as `ARCH_TAIL1`/`ARCH_TAIL2` `::error::` annotations plus
leftover processes as `ARCH_PS`. This names the exact hung test file/case.

**SOP for the next cycle:**
1. Poll run status via REST (unauthenticated works for public repos):
   `/repos/AnonymousNomad/aide-sovereign-workbench/actions/runs`.
2. Fetch annotations:
   `/repos/.../commits/<sha>/check-runs` → `annotations_url`. Logs endpoint
   needs `actions:read` (token lacked it); annotations do NOT need auth.
3. Read ARCH_TAIL*: last COMPLETED test names the hang point (the next test
   after it, or a named timed-out test, is the suspect).
4. Fix surgically in that test (missing dispose/close/abort), or convert an
   unawaited promise. Never weaken or delete the test.
5. Re-push, verify green END-TO-END (verify job + veritas step).
6. Veritas exit-1 is the SAME root cause: harness/checks.mjs runs
   `npm run check` internally with execFile timeouts (compile 120s, tests
   300s) — fixing the hang fixes veritas; verify separately.

**Threat matrix (issue → impact → status):**
- Hung test body awaited forever → file never completes → after() skipped →
  process leak → step killed at ceiling → verify red → release blocked.
  CONFIRMED mechanism; specific test UNKNOWN until #148 annotations.
- WS sockets left open by tests failing before socket.close() →
  httpServer.close() callback never fires → PROCESS-STILL-ALIVE class.
  Mitigated (a6ff483) but hang persisted → likely NOT the whole story.
- ubuntu-latest vs Windows env delta (IPv6 localhost, pipe/EPIPE behavior,
  no Defender) → candidate discriminator; not yet isolated.
- Stale runs #135–#140 stuck in_progress forever (pre-timeout workflow
  version) → queue noise; cancel via API/UI (needs actions:write token).
- Local machine stalls masquerading as failures: wedged git fsmonitor (use
  `git -c core.fsmonitor=false ...`) and Invoke-RestMethod without
  `-TimeoutSec` (always set one).

**Pitfalls (each cost a run):**
- Bare `tsc`/`eslint` in `run:` steps → exit 127 (no node_modules/.bin on
  PATH) — use `npx` (573bb44 → af1fe5d).
- Treating a "timed out" test marker as "runner moved on" — it did not.
- Playwright `selectOption({label: regex})` is invalid — resolve the value
  via getAttribute first.
- TS `erasableSyntaxOnly` + `exactOptionalPropertyTypes`: conditional
  spreads / normalizeOptions, never direct optional-prop assignment.

### Synchronized release build
1. `npm run check`, full `npm test`, `npm run veritas` (compile, tests, Git
  whitespace, manifest validation, path boundaries, secret scanning) all pass.
2. Benchmarks + arena results fresh; README claims limited to what the release
  proves; release assets = checksums + known limitations published.
3. Status stays pre-production release candidate; no VS Code parity claim.

## Release Gates

- No claim without recorded numbers; a failed gate is recorded, not hidden.
- Plugin execution: trust + capability-gated permission model enforced.
- DAP: real debuggee fixture passes the full lifecycle before readiness.
- Editor: search/undo/split/recovery each have failing-on-revert tests.
- Desktop: no production-ready claim until installer smokes pass on CI.
- Benchmarks: raw logs published; no fabricated pass rates.
- A11y: audit fixes verified per criterion.
- Training/GPU processes are never interrupted (R2).

## References

Detailed sources with URLs: `references/sources.md` (same directory).
