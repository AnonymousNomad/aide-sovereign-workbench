# Phase 2A — Historical checkpoint status (superseded)

Current checkpoint C status: see CURRENT_STATUS.md and CHECKPOINT_C_RESULTS.json. The original HTTP/WebSocket fixture request is approved. The new stop concerns five direct-service fixtures in BOUNDARY_REQUEST_DIRECT_SERVICES.md; no production expansion requested.

## Current state after authorized continuation

Native compilation/startup is explicitly DEFERRED by the operator and is no longer a stop condition.

Checkpoint B: isolated authority primitive added; 10/10 focused tests passed, both typechecks passed, targeted lint exited 0 (two ignored-declaration warnings). No live transport/capability integration yet. See CHECKPOINT_B_RESULTS.json for the exact new-file ledger and remaining review.

STOP: checkpoint C requires authenticated runtime-fixture updates outside the approved maximum test boundary. No out-of-boundary files changed. See BOUNDARY_REQUEST.md for the 41 existing test candidates and one shared test-helper file requested. No new production boundary requested.

Overall: NOT ACCEPTANCE-READY. Current production entrypoints are unchanged; the two original P0 defects remain unrepaired. Checkpoints C–F have not begun. No native files changed. No commit/push.

## Historical checkpoint A record (superseded prerequisite stop)

Baseline: `covert-production` @ `bdbaff6eeb435a7a9ffe18551843ed24d4f97a58`.

## Outcome

NOT ACCEPTANCE-READY. Checkpoint A reproduced both P0 failures safely. No production files changed. Checkpoints B–F have not started.

The accepted implementation contract requires native compilation/startup evidence for the desktop bootstrap changes and says to stop if that gate is unavailable. Neither cargo nor rustc resolves on PATH. Checked standard executable locations are absent:
- C:\Users\Grey_\.cargo\bin\cargo.exe
- C:\Users\Grey_\.cargo\bin\rustc.exe
- C:\Program Files\Rust stable MSVC 1.0\bin\cargo.exe

CARGO_HOME/RUSTUP_HOME were not set. docs/HANDOFF_OPENCODE.md:183 independently records no installed Rust toolchain. This is not an exhaustive scan of every drive; an existing operator-supplied toolchain path could resolve the blocker. No installation attempted.

Required direction: supply an existing toolchain path, or explicitly permit continuing non-native checkpoints with native bootstrap acceptance deferred. No broadening of production scope is requested.

## Completed

- Verified branch/HEAD and clean tracked state.
- SHA-256/size ledger of all 38 pre-existing untracked files, including the accepted audit documents.
- Enumerated 204 registered TS routes using buildRoutes in an isolated workspace.
- Enumerated 77 literal legacy HTTP dispatch branches; not a claim of exhaustive dynamic route coverage.
- Added two security regressions without changing existing tests.
- Ran both: 0 passed, 2 failed, 0 cancelled, 0 skipped, exit 1. Failures are expected defect reproduction, not green acceptance.

## Tests and scope

tests/arch/capability-authority.test.ts:
actual ArchServer, Git route, facade and route map; Git executor temporarily captured in memory and restored. Unauthenticated direct TS and facade requests each returned 200 and invoked stage. No real Git mutation.

tests/unit/test-owned-process.mjs:
actual desktop control; execFile temporarily captured and restored. With no owned child, panic attempted taskkill /IM and reported one child killed. No process termination.

No arbitrary sleeps, retries, assertion weakening, production bypasses, model calls or operator process termination.

## Architecture / adversarial status

Authority core, bootstrap, capability integration and process ownership repair: NOT IMPLEMENTED.
Existing P0 defects remain live.
The two new tests intentionally remain red until the corresponding implementation is authorized past this prerequisite stop.
The full forged actor/approval/replay/expiry/revocation/WS/Telegram/panic ownership matrix remains unrun.

## Changed-file ledger

New test files:
- tests/arch/capability-authority.test.ts
- tests/unit/test-owned-process.mjs

New evidence:
- docs/phase2a/BEFORE_STATE.json
- docs/phase2a/ROUTE_INVENTORY.json
- docs/phase2a/CHECKPOINT_A_RESULTS.json
- docs/phase2a/STATUS.md
- docs/phase2a/INTEGRITY.json

No production, existing test, configuration, audit, North-Star, Phase 0 or operator files edited. No commit or push.

## Evidence still required

All checkpoint B–F gates: core state machine, authenticated transport, exact-operation execution, owned-process runtime proof, full adversarial matrix, both typechecks, lint, frontend build, contract generation/idempotence, affected architecture battery and native bootstrap acceptance.

Checkpoint A does not require production typechecks/build/contract generation because it made no production changes. Those gates were not run and are not passing claims.

## Process and fixture hygiene

Fixture HTTP servers explicitly closed and reported listening:false. No operator workloads touched.
Temporary fixtures retained for inspection:
- E:\pip_temp\opencode\phase2a-authority-IaBnQu
- E:\pip_temp\opencode\phase2a-panic-5EsIIj
- E:/pip_temp/opencode/phase2a-inventory-1j6bza

See INTEGRITY.json for final PID/listener and protected-file checks.
