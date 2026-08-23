---
name: aide-phase4-git-integration
description: Phase 4 SOP for the AIDE offline IDE — functional Git panel: status, diff, stage, commit, all local, all via the git CLI. Use whenever wiring Git buttons, parsing status/diff, fixing "git panel shows nothing", adding branch/history/unstage support, or debugging test-git-api.mjs flakes.
---

# Phase 4 — Git Integration SOP (upgraded, research-backed)

Goal: Git panel behaves like VS Code SCM — REFRESH CHANGES → list, REVIEW DIFF → unified diff, STAGE/UNSTAGE per file, COMMIT with guards, BRANCH create/switch, HISTORY list — all local-first, all via the `git` CLI from the daemon at `E:\aide-sovereign-workbench`.

This SOP is verified against the live repo code (read at upgrade time):
- Daemon: `E:\aide-sovereign-workbench\daemon\server.mjs` (git routes at lines ~117–154, ~300–331)
- Frontend: `E:\aide-sovereign-workbench\app.js` (`loadGitStatus` ~296, `stageGit` ~311, `commitGit` ~321, `showGitDiff` ~392, bindings ~1118)
- UI shell: `E:\aide-sovereign-workbench\index.html` (git panel ~40–44)
- Tests: `E:\aide-sovereign-workbench\scripts\test-git-api.mjs`, `scripts\git-ui-contract.mjs`, `scripts\acceptance-real.mjs` (~53–56), `scripts\e2e.mjs`

## 1. Current state: IMPLEMENTED vs MISSING

| Capability | Status | Where |
|---|---|---|
| Status list (per-file kind, branch, ahead/behind) | IMPLEMENTED | `GET /api/git/status` + `parseGitStatus` (server.mjs:126) |
| Worktree diff (whole repo or per path) | IMPLEMENTED | `GET /api/git/diff?path=` (server.mjs:307) |
| Stage files / STAGE ALL | IMPLEMENTED | `POST /api/git/stage` (server.mjs:319) |
| Commit with message | IMPLEMENTED | `POST /api/git/commit` (server.mjs:325) |
| History endpoint (daemon only) | IMPLEMENTED, UNWIRED | `GET /api/git/log` (server.mjs:315) — `app.js` never calls it, no `#git-log` element |
| Open-repo detection | PARTIAL | status returns `unavailable` string on failure; not differentiated (not-a-repo vs git-missing vs lock) |
| Unstage (per file) | [TODO] | No route, no button. Required: `POST /api/git/unstage {paths[], approved:true}` → `git restore --staged -- <paths>` → new status |
| Staged diff | [TODO] | `GET /api/git/diff` only does worktree diff (`git diff --no-ext-diff --`). A fully-staged file shows an EMPTY diff — confusing. Required: `?staged=1` → `git diff --cached --no-ext-diff -- <path>` |
| Branch list / create / switch | [TODO] | No routes, no UI. Required: `GET /api/git/branches` (porcelain `git branch --format` or plumbing `for-each-ref`), `POST /api/git/checkout {name, create:true}` → `git switch -c <name>` / `git switch <name>` |
| History view in UI | [TODO] | Fetch `/api/git/log` on refresh, render rows (sha, subject) into `#git-history`; click row → diff vs that commit |
| Auto-refresh / debounce | [TODO] | Manual REFRESH only. VS Code pattern: file watcher + 500 ms debounce + sequentialize (see §7) |
| Concurrency lock per repo | [TODO] | No lock; two simultaneous git calls can race on `index.lock` → `fatal: Unable to create 'index.lock': File exists.` (see §8) |
| Commit identity pre-check | [TODO] | Missing `user.name`/`user.email` surfaces as raw 500. Required: pre-flight `git config user.name` + `user.email`; friendly error |
| Rename parsing under `-z` | BUG-EDGE | `parseGitStatus` looks for ` -> ` but porcelain v1 with `-z` emits renames as `XY new\0old\0` (no arrow) — the trailing record (e.g. `old`) can be parsed as a phantom file. Required: on `kind === 'R'`, consume the NEXT NUL record as `original_path` |
| Diff maxBuffer / timeout | HARDENING | `runGit` (server.mjs:117): timeout 5000 ms, maxBuffer 256 KiB. Large diffs exceed maxBuffer → error; 5 s flakes under load (documented in AGENT_NOTES). Raise per-command: status 10 s, diff 30 s + 4 MiB buffer |

## 2. Research base (verified from primary sources)

| Topic | Finding | Source |
|---|---|---|
| Porcelain vs plumbing | Porcelain = user-friendly, unstable interface; plumbing = script-stable. For a UI, parse porcelain with fixed flags — never human `git status` long output | git-scm.com book ch. 10.1; git-scm.com/docs/git |
| `--porcelain=v1` contract | Machine-stable, ignores `color.status`, `status.relativePaths`; `-z` = NUL-separated, filename-safe (no core.quotePath escaping); `--branch` prepends `## <branch>[...<upstream>] [ahead N, behind M]`; detached: `## HEAD (no branch)` | git-scm.com/docs/git-status; code.googlesource.com status patch series (v1/v2 porcelain) |
| `git status -s` vs porcelain | `-s` = human/colored, changed quoting pre-2.29; porcelain = parseable, backward-compatible guarantee | stackoverflow.com/questions/63274030 |
| `diff --numstat` | `added<TAB>deleted<TAB>path` per line; `-	-	path` for binary; `-z` for verbatim paths | git-scm.com/docs/git-diff, diff-options |
| `diff --cached` | Staged changes vs HEAD; `--staged` synonym; on unborn HEAD shows all staged | git-scm.com/docs/git-diff |
| `--no-ext-diff` | Disable external diff tool (user `diff.external` config) — MUST be used by an IDE | git-scm.com/docs/git-diff |
| VS Code git extension | File watcher on working tree + `.git` dir; **ignores `index.lock` and watchman cookie files**; `@debounce(500)` on scans; `sequentialize`/`Limiter` serialize git ops; spawns git with `GIT_PAGER: 'cat'`, `LC_ALL: en_US.UTF-8`, `LANG: en_US.UTF-8`; `rev-parse --show-toplevel` for repo root; `--abbrev-ref HEAD` for branch | github.com/microsoft/vscode extensions/git/src/repository.ts, git.ts, model.ts |
| Credentials | Never store tokens in config/UI. Automation: `GIT_TERMINAL_PROMPT=0` fails fast instead of hanging; credential helpers (`manager`, `osxkeychain`) are the sanctioned path; tokens via env-var-only helpers for CI | git-scm.com/docs/gitcredentials; serverfault.com/questions/544156; github.com/nwinkler/git-credential-helper#1 |
| Windows line endings | `* text=auto` alone on Windows → index LF but working tree CRLF (`core.eol` native default) → phantom diffs and `LF will be replaced by CRLF` warnings; explicit `eol=lf` + `git add --renormalize .` fixes; `git ls-files --eol` debug; branch switch can surface phantom CRLF↔LF changes | git-for-windows issues #4647, #2462, #954; github docs "Configuring Git to handle line endings" |
| Path quoting | `core.quotePath` (default on) octal-escapes non-ASCII in non-`-z` output; `-z` emits verbatim; `--` disambiguates paths starting with `-` | git-scm.com/docs/git-diff, diff-format |

## 3. Git CLI command map (exact commands + expected output)

All commands run with `cwd = WORKSPACE`, via `execFile` (never a shell — no quoting injection on Windows).

| Purpose | Command | Expected output / notes |
|---|---|---|
| Full status (THE core command) | `git status --porcelain=v1 -z --branch` | NUL-separated. Record 1: `## main...origin/main [ahead 1, behind 2]` (variants: `## main`, `## HEAD (no branch)`, `## main...origin/main [gone]`). Then per file: `<X><Y> <path>\0` where X=index, Y=worktree status (`M` modified, `A` added, `D` deleted, `R` renamed, `U` unmerged, `?` untracked, space = clean side). `??` = untracked. With `-z`, renames are `R  new\0old\0` (NO ` -> `) |
| Human status (context for operator) | `git status --short` | ` M file`, `?? untracked`, etc. Used for `operator.mjs` git context and the `status` field of `/api/git/status` |
| Worktree diff | `git diff --no-ext-diff -- <path>` | Unified diff text (`diff --git a/.. b/..`, `---`, `+++`, hunks `@@ -n,m +n,m @@`). Empty output = clean. `--` required before path. Omit path = whole tree |
| Staged diff | `git diff --cached --no-ext-diff -- <path>` | [TODO route] Same format, index vs HEAD |
| Diff stats (optional per-row) | `git diff --numstat -- <path>` | `12\t3\tpath` (added, deleted, tab-separated); `-\t-\tpath` = binary |
| Stage | `git add -- <paths...>` | Silent on success; stages modifications, new files AND deletions. Exit 0 |
| Unstage | `git restore --staged -- <paths...>` | [TODO route] Git ≥ 2.23. Unstages without touching worktree |
| Commit | `git commit -m <message>` | stdout: `[main abc1234] <subject>` + stats; 1 file changed…; exit 0. Fails (exit 1) with `nothing to commit, working tree clean` or `Please tell me who you are` |
| History | `git log --oneline --decorate -12` | One line per commit: `<shortsha> (<decorations>) <subject>`. In repo: limit 12 |
| Branch list | `git for-each-ref refs/heads --format='%(refname:short) %(objectname:short)'` | Plumbing, stable. One branch per line |
| Create + switch | `git switch -c <name>` | Fails if branch exists (`fatal: a branch named '<name>' already exists`). `git switch <name>` = switch existing; fails on conflicting worktree changes |
| Current branch | `git rev-parse --abbrev-ref HEAD` | `main`; detached → `HEAD` |
| Repo detection | `git rev-parse --is-inside-work-tree` | `true` / `false`, exit 0/128. Use before all git UI calls |
| Repo root | `git rev-parse --show-toplevel` | Absolute path; on Windows mapped drives may return UNC (Git 2.25+ quirk — normalize if used) |
| Identity pre-check | `git config user.name` / `git config user.email` | Empty output = not configured → commit would fail. [TODO pre-flight] |
| EOL debug | `git ls-files --eol` | `i/lf w/crlf attr/text eol=lf` — diagnose phantom diffs (see §9) |
| Line-ending renormalize (one-time) | `git add --renormalize .` | After adding/changing `.gitattributes`; then commit "Introduce end-of-line normalization" |

Environment to set on every git spawn (VS Code practice): `GIT_PAGER: 'cat'`, `LANG: 'en_US.UTF-8'`, `LC_ALL: 'en_US.UTF-8'`, `GIT_TERMINAL_PROMPT: '0'`. Never `GIT_ASKPASS` with a token.

## 4. Daemon API contract (exact shapes, verified in `daemon/server.mjs`)

### Implemented now

- `GET /api/git/status`
  - 200: `{ workspace, branch, tracking, ahead, behind, files: [{ path, original_path, index, worktree, kind }], raw, status }` — `kind` = the non-space side of `XY`; `tracking` = upstream name; `raw` = NUL-joined porcelain records (quote as evidence)
  - Git failure: 200 with `{ workspace, status: '', unavailable: '<stderr>' }` — UI must check `result.unavailable` (app.js:300)
- `GET /api/git/diff?path=<rel>` (defaults `.`): 200 `{ path, diff }`; failure 200 `{ diff: '', unavailable }`. Rejects absolute paths and `..` (`unsafe Git path`). Query param is URL-encoded (`encodeURIComponent`) from the UI
- `GET /api/git/log`: 200 `{ log }` — `git log --oneline --decorate -12` raw text
- `POST /api/git/stage` `{ paths: string[], approved: true }`: 200 `{ staged }`. Requires `approved === true` and non-empty string array; rejects `/`-prefixed or `..`-containing paths. Without approval → 500 `{ error }` (test asserts this)
- `POST /api/git/commit` `{ message, approved: true }`: 200 `{ committed }`. Message trimmed, required, ≤ 200 chars; git errors (empty tree, no identity) surface as 500 `{ error: '<git stderr>' }`

All routes run `runGit(args)` = `execFile('git', args, { cwd: WORKSPACE, timeout: 5000, maxBuffer: 256*1024 })`, reject = `Error(stderr)`; errors render as `{ error }` via the global catch with `errorStatus()` (503 only for model-setup text, else 500).

### [TODO] Required additions (keep the same shapes/guards)

- `POST /api/git/unstage` `{ paths: string[], approved: true }` → 200 `{ unstaged: await runGit(['restore', '--staged', '--', ...paths]) }` — same path-safety and approval checks as stage
- `GET /api/git/diff?path=<rel>&staged=1` → `git diff --cached --no-ext-diff -- <path>`, same response shape
- `GET /api/git/branches` → 200 `{ branches: [{ name, short_sha }], current: '<rev-parse --abbrev-ref HEAD>' }`
- `POST /api/git/checkout` `{ name, create: boolean, approved: true }` → `git switch -c <name>` or `git switch <name>`; reject names with `/`, whitespace, leading `-`, or `.`/`..`; return 200 `{ switched: '<stdout>' }`
- `POST /api/git/precheck` (or inline in commit route): `git config user.name` + `user.email`; if either empty → 400 `{ error: 'Git author identity not configured…' }`
- Harden `runGit`: per-command `{ timeout, maxBuffer }` (status 10 s / 1 MiB, diff/log 30 s / 4 MiB); add env block from §3; add a per-repo mutex so no two git commands overlap (§8)

## 5. Frontend wiring (verified in `app.js` / `index.html`)

Implemented bindings:
- `#git-refresh` → `loadGitStatus()` → `GET /api/git/status` → rows in `#git-status`: summary line `branch · N changes`, per file: kind badge, path, `DIFF` button (`data-git-diff`), `STAGE` button (`data-git-stage`). Error → `Git unavailable: <msg>` inline
- `#git-diff` → `showGitDiff()` → whole-tree diff rendered into the terminal `<pre class="terminal-output">` (escaped!). Per-row DIFF → `showGitDiff(button.dataset.gitDiff)`
- `#git-stage-all` → collects all `data-git-stage` paths → `stageGit(paths)`
- `#git-commit` + Enter key in `#git-commit-message` → `commitGit()`: trims, blocks empty with warning + focus, POSTs `{ message, approved: true }`, clears input, logs `Local commit created: <short-sha>` (takes last whitespace token of `committed`), refreshes status
- Every action is `appendLog('GIT', …)` logged; errors never silent; HTML-escaped (`esc()`)

### [TODO] Required UI additions

- Per-row `UNSTAGE` button (only when `kind` is an index-side change: `index !== ' '`) → new `stageGit`-style call to unstage route
- Per-row `DIFF` must pass `staged=1` when the file is staged-but-clean-in-worktree (i.e. `kind === index && worktree === ' '`)
- `#git-history` list under the status panel: on `loadGitStatus` also fetch `/api/git/log`, render `<div class="git-commit">` rows `shortsha subject`; row click → diff view of that commit ([TODO] route `git show <sha> --stat --oneline` or reuse diff endpoint)
- Branch row in the summary: current branch name as a `<select>`-free button opening a branch panel ([TODO] route) with NEW BRANCH input + list + switch buttons; refresh status after switch
- Debounced auto-refresh: wrap `loadGitStatus` in a 500 ms debounce; invoke on file save (`/api/file/write` success) and after every stage/unstage/commit/checkout — never on an interval

## 6. Step-by-step SOP

### 6.1 Open-repo detection (first gate)
1. `git rev-parse --is-inside-work-tree` in `WORKSPACE`; exit 128 → render `Not a git repository — use the terminal to run git init` (do NOT auto-init; user decision)
2. Exit 0 → proceed. `git` binary missing → `ENOENT` from execFile → render `git CLI not found on PATH`

### 6.2 Refresh status (debounced, single-flight)
3. Call `GET /api/git/status`. If `result.unavailable` → inline error, stop
4. Render: `branch (detached if 'HEAD') · ahead/behind · N changes`; per file row with `kind` badge (`M/A/D/R/U/?`), path, DIFF, STAGE (`STAGE ALL` + UNSTAGE where applicable)
5. Debounce 500 ms between refreshes (VS Code `@debounce(500)`); if a refresh is in flight, queue at most one more (single-flight, VS Code `sequentialize`)
6. Untracked `??` rows: DIFF renders empty (no base) — show `new file` placeholder text instead of empty diff ([TODO] or `git diff --no-index /dev/null <path>`)

### 6.3 Stage / unstage per file
7. `POST /api/git/stage { paths: [p], approved: true }`; on 200 → `appendLog('GIT', 'Staged p locally.')` → debounced refresh
8. [TODO] Unstage: `POST /api/git/unstage { paths: [p], approved: true }` → refresh
9. Never send absolute paths; UI sends repo-relative strings from the porcelain parser (daemon re-validates)

### 6.4 Diff render (unified)
10. `GET /api/git/diff?path=<encoded>` (or whole tree, no query)
11. Render the raw unified text into a scrollable `<pre class="terminal-output">`, HTML-escaped (app.js:393 already does `esc()`)
12. Staged files: [TODO] pass `staged=1` so users see what will be committed — today a staged file shows an empty diff (known gap)

### 6.5 Commit (message validation + empty-commit guard)
13. Trim input client-side; block empty (focus input, warning log) — matches daemon's ≤ 200 char rule
14. [TODO] Pre-flight identity: daemon checks `git config user.name` + `user.email` before committing; on missing → `Commit blocked: configure git user.name and user.email first`
15. `POST /api/git/commit { message, approved: true }`
16. Empty-commit guard: git exits 1 `nothing to commit, working tree clean` → daemon returns 500 `{ error }` → UI renders `Commit blocked: nothing to commit…` (already works — keep, don't allow `--allow-empty`; empty commits are noise)
17. Success: clear input, log `Local commit created: <sha>`, refresh status + history
18. Multi-line: `-m` accepts newlines in the string; daemon caps at 200 chars — fine for a local panel

### 6.6 Branch create/switch [TODO]
19. `GET /api/git/branches` → render list with current marked
20. NEW BRANCH: validate name (no `/`, spaces, leading `-`, `.`/`..`) → `POST /api/git/checkout { name, create: true, approved: true }` (`git switch -c`)
21. SWITCH: `POST /api/git/checkout { name, create: false, approved: true }` (`git switch <name>`); git's own refusal on dirty conflicts (`error: Your local changes…`) surfaces as 500 `{ error }` → render verbatim
22. After switch: refresh status (branch, files) + history

### 6.7 History list [TODO in UI]
23. Daemon already serves `GET /api/git/log` (12 oneline entries)
24. UI: render rows; click → per-commit diff ([TODO] route `git show --format= -- <sha> -- <path>` or `git diff <sha>^ <sha> --`)
25. Refresh after each commit

### 6.8 Repair loop (git panel shows nothing)
26. Repo not a git repo → §6.1 message
27. `/api/git/status` returns `unavailable` → read the stderr string; top causes: `index.lock` race (see §8), 5 s timeout under load (raise per §4), maxBuffer overflow on huge trees (raise), `core.quotepath` irrelevant under `-z`
28. UI blank but endpoint fine → check `#git-status` DOM id still bound in `app.js` line ~1118 and `git-ui-contract.mjs` regexes still match

## 7. Concurrency + safety rules (mandatory)

1. **Never run two git commands on the same repo concurrently.** Git writes `index.lock` while mutating; a parallel `status` reads a half-written index and can throw `fatal: Unable to create 'index.lock': File exists.` Implement a per-repo promise mutex in the daemon (chain every `runGit` through `lock = lock.then(run)`); mutations (stage/unstage/commit/checkout) must also trigger a queued status refresh afterwards
2. **No interactive prompts, ever**: env `GIT_TERMINAL_PROMPT=0` on every spawn → auth failures fail fast with stderr instead of hanging the daemon request (5 s timeout kills it anyway, but produce the real error)
3. **No credentials in the UI or the daemon**: never render remote URLs in the panel; never log `git config --get remote.origin.url` output; tokens belong in credential helpers only (gitcredentials docs). This repo already stripped the token from `remote.origin.url` — keep it that way
4. **Pager-proof**: `GIT_PAGER=cat` + locale pins on every spawn (VS Code git.ts practice) so `log`/`diff` can never hang on a pager
5. **Path safety** (already enforced server-side, keep): reject absolute paths, `..`, and on checkout names with `/`, whitespace, leading `-`; always `--` before pathspecs
6. **No secrets in commits**: before any commit path, `git status` + `git diff` + recent `git log` review is the project hard rule; the panel only commits what the user staged — never auto-stage-all on commit

## 8. Windows pitfalls (this machine: win32, Git for Windows)

1. **Line endings**: repo has `.gitattributes` `* text=auto eol=lf` + `core.autocrlf false`. If a repo is missing `eol=lf`, `text=auto` alone yields CRLF in the working tree on Windows (`core.eol` native default) → phantom `M` rows and `LF will be replaced by CRLF` warnings on add. Fix: add `eol=lf`, then `git add --renormalize .` + commit (git-for-windows #4647, #2462). Diagnose with `git ls-files --eol`
2. **Path quoting**: `core.quotePath` octal-escapes non-ASCII paths in non-`-z` output — always parse the `-z` stream (already done). `execFile` (no shell) means no cmd.exe quoting issues — never switch to `execFileSync(..., {shell:true})`
3. **Renames with `-z`**: records are `R  new\0old\0` — the current `parseGitStatus` arrow-split is for the non-`-z` form; fix per §1 bug-edge entry
4. **index.lock on Windows**: antivirus/indexer hold files → transient `index.lock` errors; single-flight + retry-once (100 ms) after any lock failure; never show a raw lock error as "git broken"
5. **Timeout/maxBuffer under load**: 5 s `runGit` timeout + 256 KiB maxBuffer flake under heavy load (this machine runs concurrent training jobs). Documented: `test-git-api.mjs` and `acceptance-real.mjs` "flaky under load (5 s git timeout; pass standalone)". Per-command budgets in §4 fix it
6. **Mapped-drive UNC**: `rev-parse --show-toplevel` on mapped drives returns UNC (Git ≥ 2.25); only relevant if WORKSPACE is a mapped drive — normalize if the future repo-root feature uses it (VS Code model.ts does this)

## 9. Verification gates (exact commands + pass criteria)

Run from `E:\aide-sovereign-workbench`:

1. `node scripts/git-ui-contract.mjs` — static contract (ids `git-stage-all`/`git-commit-message`/`git-commit` in index.html, `stageGit`/`commitGit`/`data-git-diff`/`data-git-stage`/`#git-stage-all`/`#git-commit-message` in app.js, `parseGitStatus` + `--porcelain=v1 -z --branch` + `/api/git/diff` in server.mjs). PASS = prints `git UI contract passed`, exit 0. Add regexes for every new route/button
2. `node scripts/test-git-api.mjs` — spawns a throwaway daemon (port 4891, temp repo at `os.tmpdir()`), waits ≤ 15 s for `/health`, then asserts: stage WITHOUT approval → 500; stage WITH approval → 200; commit `test change` → 200. PASS = prints `git api test passed`. **Flake guidance**: it is timing-sensitive — the daemon readiness loop is 15 s and `runGit` is 5 s; under heavy machine load (concurrent trainings, low RAM) it flakes. Run standalone (nothing else heavy), expect < 20 s total; retry once before treating as a failure; a real failure shows `daemon did not become ready within 15 seconds` with captured stderr
3. `node scripts/acceptance-real.mjs` — real-workspace flow: `/api/git/status` 200 with `README.md` present; `/api/git/diff?path=README.md` 200 and body matches `/patched/`; stage 200; commit 200. Same flake caveats
4. `node scripts/e2e.mjs` — daemon endpoint sweep incl. git
5. `node scripts/ui-audit.mjs` — all DOM ids referenced (108/108 baseline); add new ids
6. `npm run check` — `node --check app.js` + `node --check daemon/server.mjs` (+ others)
7. Manual acceptance (human or harness): modify a workspace file → REFRESH shows it with kind `M` → per-row DIFF shows real unified hunks → STAGE → STAGE ALL → commit with message → `git log -1` output quoted matches the logged sha → branch create/switch/history when implemented
8. Full: `npm test` (includes all of the above; `editor-smoke.mjs` needs Edge and `dap-fixture` needs the Python/debugpy runtime — environment-gated, not git blockers)

## 10. Audit checklist (before calling the Git panel done)

- [ ] Status, diff, stage, commit all pass gates §9.1–9.4 standalone
- [ ] `/api/git/status` returns `unavailable` string (not a crash) outside a repo; UI shows actionable message
- [ ] No git command ever runs concurrently on the repo (mutex in place)
- [ ] `GIT_TERMINAL_PROMPT=0`, `GIT_PAGER=cat`, locale pins on every spawn
- [ ] No credentials/tokens rendered or logged anywhere in git UI
- [ ] Rename rows parse correctly under `-z` (bug-edge fixed)
- [ ] Empty commit and missing-identity produce clear UI messages, never raw stderr dumps
- [ ] Per-command timeouts/buffers raised (status 10 s, diff/log 30 s, 4 MiB)
- [ ] `test-git-api.mjs` passes standalone twice in a row
- [ ] [TODO items] branch list/create/switch, unstage, staged diff, history UI, debounced auto-refresh implemented with matching contract regexes + route tests

## 11. Sources

- Git porcelain/plumbing split: https://git-scm.com/book/en/v2/Git-Internals-Plumbing-and-Porcelain ; https://git-scm.com/docs/git
- git-status `--porcelain[=<v1|v2>]`, `-z`, `--branch`: https://git-scm.com/docs/git-status ; v2 porcelain patch series: https://public-inbox.org/git/1470147137-17498-5-git-send-email-git@jeffhostetler.com/t/
- `-s` vs `--porcelain` differences (pre-2.29 quoting): https://stackoverflow.com/questions/63274030/difference-between-git-status-s-and-git-status-porcelain
- git-diff (`--cached`, `--numstat`, `-z`, quotePath): https://git-scm.com/docs/git-diff ; diff options: https://git-scm.com/docs/diff-options ; diff format: https://git-scm.com/docs/diff-format
- VS Code git extension (watchers, index.lock/watchman filter, debounce 500, sequentialize, Limiter, spawn env): https://github.com/microsoft/vscode/blob/main/extensions/git/src/repository.ts ; https://github.com/microsoft/vscode/blob/main/extensions/git/src/git.ts ; https://github.com/microsoft/vscode/blob/main/extensions/git/src/model.ts
- Credentials: https://git-scm.com/docs/gitcredentials ; `GIT_TERMINAL_PROMPT=0` origin: https://github.com/nwinkler/git-credential-helper/issues/1 ; fail-fast in automation: https://serverfault.com/questions/544156/git-clone-fail-instead-of-prompting-for-credentials
- Windows line endings: `text=auto`/`core.eol` behavior: https://github.com/git-for-windows/git/issues/4647 ; phantom CRLF↔LF on branch switch: https://github.com/git-for-windows/git/issues/2462 ; normalization (`git add --renormalize`, `git ls-files --eol`): https://github.com/git-for-windows/git/issues/954 ; GitHub guidance: https://docs.github.com/articles/dealing-with-line-endings
- Repo evidence (this machine): `daemon/server.mjs`, `app.js`, `index.html`, `scripts/test-git-api.mjs`, `scripts/git-ui-contract.mjs`, `scripts/acceptance-real.mjs`, `package.json`, `AGENT_NOTES.md` (Phase 4 entries, flake documentation)