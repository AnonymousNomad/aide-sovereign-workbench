# Academy Phase A3 — Exercise Execution Engine v2

## What
Replace the one-liner check regex (`(python|node|git) -c/-e/--version` only) with real exercise execution: each lesson declares exercise files + a hidden test suite in the course bundle; checks run learner code from a per-lesson workspace via process-manager with timeouts and output caps.

## Why
The current allowlisted one-liner cannot assess actual code, which blocks every meaningful programming lesson. Process execution infrastructure already exists and is proven (bounded task runner, clean tree-kill) — reuse it rather than inventing a second runner.

## Code Plan
- Course JSON v2 schema: `lessons[].exercise = { files: [{name, stub}], tests: {runner: 'node'|'python', entry: 'tests/test_lesson.js', hidden: true}, timeoutMs }`. Courses ship as directories (course.json + exercises/) instead of single JSON; loader migrates v1 silently.
- `academy/exercise-engine.mjs`: materialize lesson workspace under `<workspace>/.aide/academy/<courseId>/<lessonId>/` (learner edits via existing file routes — full editor integration for free); `runCheck()` copies hidden tests in, executes via process-manager (`execFile` path with 30s default timeout, 64KB buffer caps), returns structured pass/fail + failing-test names (never test source).
- Check result → A1 `recordAttempt`; hint escalation counters live here.
- Route: `POST /api/tutor/check` extended (same envelope, richer payload). Contracts regen.

## Dependencies
process-manager (spawn/kill/execFile, ESRCH-safe), file-routes (learner edits), A1 state, contracts pipeline.
Doctrine: AST/exec closed-loop verification (generate→verify→correct) from CLAUDE.md principles.

## Threat Matrix
| Threat | Control |
|---|---|
| Arbitrary code execution | learner code confined to academy workspace dir; process-manager timeout + kill-tree; no network env vars stripped where feasible |
| Test theft/tampering | hidden tests copied in at run time, deleted after; never listed by workspace routes (dotdir exclusion already enforced) |
| Resource abuse (fork bombs, huge output) | timeout hard-cap, maxBuffer cap (existing), single active run per lesson |
| Path escape via crafted filenames | all paths resolved+contained (reuse file-route containment asserts) |
| False pass | exit code + test-runner result both required; parse failure = fail-closed |

## Issues / Bugs Watchlist
- Windows EBUSY on cleanup after child exit — reuse dap-contract retry pattern.
- Node test runner vs python pytest: pick ONE runner per language v1 (node:assert script, python: plain assert script) — no framework deps.
