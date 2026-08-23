---
name: aide-arch-git
description: Phase 7 SOP for the AIDE offline-first IDE rebuild — the git integration service: git CLI via execFile (shell:false, -C workspace, GIT_TERMINAL_PROMPT=0), porcelain v2 status parsing, diff/stage/commit/unstage/branch/history, git panel UI over the Phase 2 shell + Monaco diff views, safe credential handling (no interactive prompts), and the commit-ref problem class (refs/heads/main write failures — AV/OneDrive interference). Use whenever wiring git panel routes, parsing status/diff, debugging "git panel shows nothing", adding branch/history/unstage support, or auditing the existing test-git-api flow. Research-grounded (git-scm.com docs, nodejs.org child_process, the verified aide-phase4-git-integration skill).
---

# AIDE Architecture — Phase 7: Git Integration

## Doctrine

- **Git CLI via execFile only.** `git -C <workspace> <command> [args...]` with `shell:false` and array args. Never interpolate paths into strings; never use shell:true (injection + Windows quoting bugs).
- **No interactive prompts, ever.** `GIT_TERMINAL_PROMPT=0` + `GIT_ASKPASS=echo` + `--no-advice` where relevant. If git needs credentials, the operation FAILS with a clear message (offline IDE, local remotes only; credential helper UI is out of scope unless opt-in).
- **Parsing, not screenscraping**: `--porcelain=v2` for status (machine-stable), `--format=...` for log, `-z` where supported. Never parse human-readable output.
- **The daemon owns git** (privileged host); the browser gets typed contracts (`common/contracts/git.ts`) and renders.
- Verify before claiming: status/diff/stage/commit round-trip verified in a REAL scratch repo in the browser; the commit-ref failure class (see Known issues) verified handled.

## What

Phase 7 delivers the git panel as a contract service:

- **Status**: `git status --porcelain=v2 --branch` → parsed into `{ branch, ahead, behind, changes: [{ path, status: XY, staged, untracked }] }`. Ignored files excluded (porcelain v2 gives them separately).
- **Diff**: `git diff` (unstaged) + `git diff --cached` (staged) → unified diff text; the panel renders it (side-by-side or unified — Monaco diff editor is available from Phase 3: `monaco.editor.createDiffEditor` with original=HEAD/HEAD:path, modified=working tree content; dirty unsaved buffers = working tree is the on-disk file; keep it honest: diff is disk vs HEAD, not buffer vs HEAD, unless the buffer is saved).
- **Stage/unstage**: `git add <paths...>` / `git restore --staged <paths...>` (or `git reset HEAD -- <paths>` for older git — use restore; it's the modern command). Paths as array args; workspace paths only (containment, Phase 1 rule).
- **Commit**: `git commit -m <message>` with the message as a SINGLE array arg (no -m concatenation bugs). Reject empty/whitespace messages (CONFLICT envelope code + message). Commit → refresh status.
- **Branch/history**: `git branch --list` / `git log --oneline -n 50 --format=...` (stable format string), checkout per branch (`git checkout <name>` with dirty-tree guard — refuse with a clear message if working tree has changes; no stash magic by default).
- **Unstage/undo**: restore --staged (above); optional `git checkout -- <path>` for discarding unstaged changes — behind an explicit confirm (destructive).
- **Errors**: map git exit codes/stderr to envelope codes (not-a-repo → clear "workspace is not a git repository", merge conflict in progress → distinct code, credential failure → CREDENTIALS message). Never dump raw stderr to the UI without the code mapping.
- **Watcher**: `file:changed` WS events (Phase 4 channel) let the panel refresh on external changes (git operations outside the IDE) — poll `git status` on a debounce (e.g. 2s) while the workspace is open; full watcher infra (chokidar) is optional (dep cost, offline-first).

## How

### 1. execFile wrapper (Phase 1 process manager)

```ts
// node/src/services/git.ts
export async function git(args: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', ['-C', opts?.cwd ?? workspace, '--no-pager', ...args], {
    shell: false, timeout: opts?.timeoutMs ?? 15000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
  });
}
```

- maxBuffer must be generous (big diffs); git -C with workspace root means paths in args are workspace-relative.
- Timeout → TIMEOUT envelope; large repos (or slow AV scanning — see Known issues) can exceed 15s: make timeout configurable per route.

### 2. Status parsing (porcelain v2)

- Line format: `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>` (tracked) / `2 <XY> ... <path>` (renamed, with `origPath` on next line) / `? <path>` (untracked).
- XY semantics: first char = staged (index) state, second = unstaged (worktree) state; X/Y/Y/Z → conflicts.
- `# branch.oid <sha>` / `# branch.head <name>` / `# branch.upstream` / `# branch.ab +A -B` for branch+ahead/behind.
- Return the STRUCTURED result; the panel maps to UI (staged → checkbox filled, conflict → special badge + open in editor).

### 3. Diff rendering with Monaco (from Phase 3)

- `monaco.editor.createDiffEditor(container)`; original model = `monaco.editor.createModel(diffContent, lang, uri: 'git:HEAD:' + path)`; modified = `monaco.editor.createModel(workingContent, lang, uri: 'git:worktree:' + path)`. Read-only (editor.setReadOnly(true)); navigate between changes via the diff editor's built-in actions.
- Working content source: read the file via the file contract (disk state) — do NOT use the unsaved buffer (honesty rule: diff shows what git sees).

### 4. Security

- All paths: workspace-relative, containment-verified (Phase 1) before being passed to git. `git add ../outside` must be impossible.
- Commit messages: max length guard (e.g. 8KB), no shell metacharacters are dangerous (array args), but strip NULs (git rejects them anyway).
- No credentials stored/logged; no remote config mutations (no `git remote add` from the UI unless opt-in online).

## Why (research grounding)

- git-scm.com docs: porcelain v2 exists precisely because porcelain v1 text parsing is fragile; stable formats (`--format=...`, `-z`) are the documented machine interface.
- nodejs.org: execFile with args array = the safe, quoting-correct spawn (paths with spaces on Windows break string-form commands).
- Verified project lessons: the git panel existed with a working status/diff/commit flow (test-git-api.mjs); the rebuild ports that contract, adds branch/history/unstage, and hardens error mapping.
- VS Code doctrine: git lives in a privileged host; the renderer never shells out.

## Dependencies

git installed on PATH (verified on this machine), Phase 1 process manager, Phase 2 api client + error translation, Phase 3 Monaco diff editor, Phase 4 WS (file:changed), Phase 5 contracts pattern (git.ts schema added in Phase 7).

## Known issues / bugs (watch these)

- **`couldn't set 'refs/heads/main'` (REAL, observed 2026-08-16)**: commit failed with this while the ref file was writable, no lock files, no git processes. Suspected AV/OneDrive transient interference on `.git\refs\heads\main`. Handling: (1) retry once after 1s; (2) check `.git/refs/heads/main.lock` + `ORIG_HEAD.lock` and stale lock age (>30s → remove with warning); (3) surface the failure with the code COMMIT_FAILED + the git stderr so the user sees it — never silently swallow.
- **AV scanning latency**: Defender scanning freshly-written files can make git operations (esp. `git add` of many files) slow → timeouts. Raise git timeout for add/commit; log slow ops.
- **CRLF warnings**: `git diff` shows `\r` noise when core.autocrlf differs from file EOL. Don't fight it in the panel; surface `core.autocrlf`/`core.eol` in settings if diffs look wrong.
- **Merge conflicts**: porcelain v2 `U` states — panel must show conflict files with a distinct state and let the user open them (Monaco shows conflict markers; no auto-resolve).
- **Empty repo / unborn branch**: `git status` on a fresh `git init` repo returns branch head "(unknown)" — handle it (branch: null, no ahead/behind) or the parser crashes.
- **Detached HEAD**: `branch.head` = "(detached)" — show the SHA, hide branch ops that need a branch.
- **Large diffs**: maxBuffer 64MB is generous but a 500MB file's diff will still break — cap per-file diff size (like the 1MiB file gate) with a "diff too large" message.
- **Submodules**: `git status` shows them as `160000` mode — treat as opaque entries (no recursion), or the parser mislabels them as regular changes.

## Phase 7 audit checklist (applied to the existing git code)

1. All git calls via execFile (shell:false, -C, GIT_TERMINAL_PROMPT=0, array args); zero string-interpolated commands.
2. Status via porcelain v2 parsed to structured data; branch/ahead/behind/conflict states all covered.
3. Panel live in browser: status list, diff (Monaco diff editor), stage/unstage, commit, branch list + checkout, history — verified in a scratch repo (create → add → commit → modify → diff → commit).
4. Error mapping: not-a-repo, conflict-in-progress, credential-failure, COMMIT_FAILED (with the refs failure class handled: retry + stale-lock check) — each with a fixture test.
5. Containment on all paths; no remote mutations; no credential storage.
6. `npm run check` green.