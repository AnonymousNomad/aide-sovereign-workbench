# Night Shift Journal — 2026-09-01 (cline/T4, autonomous)

> **Status:** Done. Operator wakes to: 2 files committed, evidence captured, journal honest.
> **Mode:** Partner mode. Small safe commits, all locally, no pushes.
> **Revert:** `git revert <sha>` for any single commit. No force-pushes, no history rewrites.

## The contract (what I did and did not do)

**Did:**
- Loaded 8 doctrine skills before acting (per R8: research before action)
- Captured real test output to `docs/evidence/night-shift-2026-09-01/` (5 files, real exit codes)
- Made 2 surgical README/documentation commits:
  1. `docs(README): 2026-09-01 What's New + honest-limits section`
  2. `fix(docs): GETTING_STARTED Node version matches README (26+)`
- Stopped on R8 twice (worktree-isolation test failure, CRLF was a wrong hypothesis)

**Did not:**
- Touch model files, model engine, or any operator state under `.aide/`
- Modify branch protection or repo settings
- Force-push, delete branches, rewrite history
- Push anything to `origin/main` (per operator's standing rule)
- Ship a half-passing test (worktree-isolation PR A is staged, not committed — known bug)

## Step log

### 2026-09-01 23:55 — Skills loaded
Loaded 8 skills before any edit, per the doctrine: `aide-the-quad`, `hard-rules`,
`process-hygiene-sop`, `github-repo-professional-setup`, `verify-first-discipline`,
`professional-developer`, `developer-creed-production-sop`, `aide-debugging-discipline`,
`aid-double-check-everything`, `aide-distribution-packaging`, `aide-house-model`.
Honed the priorities: no overclaim, evidence-first, small safe commits, R8 stop-on-repeated-failure.

### 2026-09-02 00:00 — Evidence capture
`scripts/capture-night-shift-evidence.mjs` written and run. Outputs in
`docs/evidence/night-shift-2026-09-01/`. Real exit codes:

| Target | Exit | Verdict |
|---|---|---|
| `expert-serve-wirein` | 1 | FAIL — the worktree-import test (see below) |
| `agent-expert-advisory` | 0 | PASS |
| `experts-battery` | 0 | 6/6 PASS (round-trip 96.7%) |
| `cipher-state-bus` | 0 | PASS |
| `syntax-checks` | 1 | FAIL — `worktree.mjs` syntax error, see below |

### 2026-09-02 00:30 — Two failures hit, R8 triggered
Both failures trace to the same unverified hypothesis: the worktree-isolation
test file fails because `worktree.mjs` (the service I authored earlier in the
day) cannot be loaded via `createRequire` from a `.ts` test on Node 26.4.0.

**First hypothesis (CRLF):** editor tool on Windows writes CRLF; Node ESM parser
chokes on `export\r\n function`. Converted 4 files to LF. **WRONG.** Same
error after the fix. R8 says stop on hypothesis 2.

**Second hypothesis (still open):** the real cause is the
`createRequire → require('worktree.mjs')` chain under Node 26.4.0 when the
`.mjs` declares `export function` at top level. The same pattern works for
`agent-loop.mjs` and `micro-experts.mjs` so the difference is something
specific to worktree.mjs (file length, the relative import, the use of `node:fs`
vs `fs`, or the named-export shape). Needs a fresh look with a clean hypothesis
table, not a third guess.

**Decision:** did NOT commit the worktree-isolation PR A. The service code,
the contract extension, the routes, and the test remain in the working tree.
The next session should run a 4-way diff against `agent-loop.mjs` to isolate
the cause, then either fix the test or convert worktree.mjs to a `.js` with a
`.d.mts` types shim.

### 2026-09-02 01:00 — README surgery (this commit's work)
Per the doctrine ("complexity is a defect", "ship the boring thing right") and
`aide-release-engineering` ("surgical, not rearchitect"), I made two additive
changes to the existing README:

1. **`README.md`** — added a `## What's New (2026-09-01)` section and a
   `## What's In Progress (honest limits)` section. The 2026-09-01 section
   is anchored to the 4 commit SHAs and the evidence battery. The limits
   section is the funding-grade credibility move per
   `github-repo-professional-setup`: "state pre-production status, open gates,
   and what is intentionally NOT claimed. Funders and adopters both penalize
   overclaiming; a candor section is a credibility asset."

2. **`docs/GETTING_STARTED.md`** — fixed the Node version drift. README says
   `Node 26+`, this doc said `Node 20+`. Aligned to the README (the public
   source of truth) with a comment explaining the `package.json` engines floor
   vs. the verified runtime.

### What I did not do (and why)
- **No README rewrite.** The existing README is professional, evidence-anchored,
  and 90% there. Additive edits only.
- **No installation packages.** The launch is still a `npm install && npm start`
  flow per the existing Quickstart. The audit's Week 2 item (P0 installer) is
  its own work.
- **No worktree-isolation commit.** Real bug, not fixed, filed in this journal.
- **No 2026-09-01 commit, push, or remote action.** Standing rule from the
  operator is "you push yourself" or "ask first."

## How to verify the night-shift work
```
cd E:\aide-sovereign-workbench
git log --oneline -5           # should show the 2 new commits on top
git show --stat HEAD~1         # the README commit
git show --stat HEAD           # the GETTING_STARTED fix
cat docs/evidence/night-shift-2026-09-01/*.txt   # real exit codes from midnight
```

## Revert instructions
```
git revert <sha>     # any single commit, safe, non-destructive
git push origin main # only when you say go
```
