---
name: aide-ci-diagnostics
description: Diagnose GitHub Actions failures on AnonymousNomad/aide-sovereign-workbench WITHOUT authentication — no-auth evidence channels (::error annotations, job summaries via the check-runs API), harvest commands, flake-vs-real triage, and the veritas gate map. Use whenever CI is red, a run's conclusion must be explained, or observability for a failing step must be added.
---

# AIDE CI Diagnostics (authless)

Mission: explain any red run on `aide-sovereign-workbench` using only unauthenticated API access, decide flake-vs-real with evidence, and instrument until the root cause is visible. Never guess a cause that the evidence channel cannot show.

## Evidence channels (no auth)

1. **`::error` annotations** — workflow steps emit `echo "::error::NAME: <tail>"`; these surface as check-run annotations.
2. **Job summary — DOES NOT WORK via API.** `$GITHUB_STEP_SUMMARY` renders in the UI only; check-runs API `output.summary` stays EMPTY for workflow-job check runs (verified 2026-08-21, run 904cf6d). Do not plan around it. Emit `::error::NAME: tail` lines from the step instead — those DO surface as annotations.
3. **Artifacts are AUTH-ONLY.** Never plan around downloading them without credentials; route needed data through channels 1–2 instead.
4. Local reproduction on the dev box (Windows, slow HDD) — authoritative for "is it real here", NOT sufficient to declare a CI-only cause.

## Harvest procedure (PowerShell)

```powershell
$r = Invoke-RestMethod -TimeoutSec 60 -Uri "https://api.github.com/repos/AnonymousNomad/aide-sovereign-workbench/actions/runs?per_page=1"
"$($r.workflow_runs[0].head_sha.Substring(0,7)) $($r.workflow_runs[0].status) / $($r.workflow_runs[0].conclusion)"
$id = $r.workflow_runs[0].id
$j = Invoke-RestMethod -TimeoutSec 60 -Uri ".../actions/runs/$id/jobs"
$j.jobs | ForEach-Object { "== $($_.name): $($_.conclusion)"
  $_.steps | Where-Object conclusion -eq 'failure' | ForEach-Object { "FAILED STEP: $($_.name)" } }
$cr = Invoke-RestMethod -TimeoutSec 60 -Uri ".../commits/<sha>/check-runs"
foreach ($run in $cr.check_runs) {
  # annotations:
  $a = Invoke-RestMethod -TimeoutSec 60 -Uri ($run.output.annotations_url -replace '\{\+.*$','')
  $a | ForEach-Object { $_.message }
  # summary text (job summary channel):
  $run.output.summary
}
```

Always use `-TimeoutSec` on Invoke-RestMethod. Always `git -c core.fsmonitor=false ...`.

## Gate map

- Step `architecture tests` = BOUNDED arch suite wrapper (`scripts/run-bounded-arch.mjs`); emits ARCH_PS / ARCH_FILES / ARCH_TIMEOUTS / ARCH_LASTLINES annotations on failure; always exits 0 unless status non-zero after printing.
- Step `veritas gates` = `npm run veritas -- --json > /tmp/veritas.json`, then `scripts/veritas-summary.mjs` writes per-gate PASS/FAIL + failing-output tail into `$GITHUB_STEP_SUMMARY`; exit code preserved. Report artifact step stays `if: always()`.
- Veritas gates in order: path-boundary, secret-scan, manifest-validation (models/community/release manifests), compile (`npm run check` = node --check chain + tsc + eslint + FULL arch suite), tests (`npm run test` mega-chain), git-diff (`git diff --check`).
- Timeouts (harness/checks.mjs): compile 600s, tests 900s, git-diff 120s — sized from measured durations (local arch alone ~220s on HDD).

## Triage rules

1. Identify failed step first; read its annotations/summary before ANY code change.
2. Flake test: list last ≥5 runs (`per_page=6`) and compare conclusions across commits. A docs-only commit failing while neighbors pass ⇒ environment/timing-dependent, not content-caused.
3. If the failing step's output is not visible through channels 1–2, ADD instrumentation (summary emitter) before hypothesizing. One diagnostic push beats N speculative fixes.
4. Fix only the evidenced cause; re-run locally when possible; journal the finding in AGENT_NOTES.md and fold durable lessons back into this skill (continuous-improvement-sop loop).
5. Known precedent: pre-fix veritas compile timeout (120s) caused runner-speed-lottery failures incl. docs-only commits — fixed by measured timeouts + summary observability.

## Hard rules

- No force-pushes, no workflow_dispatch bypass of required checks, no committing secrets while harvesting.
- Never claim "fixed" from local green alone when the failure was CI-only; the fix is proven only by a green run whose previously-failing step now passes with visible evidence.

## Verified 2026-08-22 (B2 session)
- dap-contract flake pattern: full-session test timing out at EXACTLY the waitFor budget on CI while passing locally and in the adjacent gate = borderline runner slowness, not logic. Fix: raise default timeoutMs (now 90000) in tests/arch/dap-contract.test.ts:66. Do NOT chase phantom races before checking the timeout arithmetic.
- Evidence loop that works end-to-end: run annotations (check-runs API) carry the VERITAS_JSONHEAD/VERITAS_compile/VERITAS_MAP ::error lines - read those FIRST, they contain the gate map + failing test name without downloading logs.
- npm script banners pollute `> file` JSON capture; slice from first '{' (JSONHEAD) - confirmed again on B1/B2 runs.
