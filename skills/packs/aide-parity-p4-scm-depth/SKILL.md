# AIDE P4 - SCM UX: typed git service + hunk staging + blame + timeline

Research basis (VERIFIED 2026-08-22): git-scm.com/docs/git-apply - `--cached` applies ONLY to the index, default is ATOMIC (whole patch fails if any hunk fails; --reject would split, we do not use it). Patches need >=1 context line (we emit default -U3, never --unidiff-zero). Unstage-hunks = `git diff --cached -- <path>` selected hunks reverse-applied with `-R`. Non-interactive `git add -p` alternatives (filterdiff/hunkpick) are external deps we will NOT take; a ~40-line unified-diff splitter does the same for whole hunks. git-scm.com: porcelain v2 is the documented machine interface.

## Verified starting point
The rebuilt backend has ZERO git surface (rg '/api/git' node/src = empty). Legacy daemon/server.mjs has only status/diff/log/stage/commit via string-ish execFile. P4 therefore PORTS the aide-arch-git base AND adds the depth. Branch CHECKOUT is explicitly DEFERRED (needs dirty-tree guard UX) - branch list ships now.

## What (contracts first)
1. common/contracts/git.ts:
   - GitStatusResponse {git_repo:boolean, branch:string|null, oid:string|null, upstream:string|null, ahead:int, behind:int, detached:boolean, changes:[{path, orig_path?, x, y, staged:boolean, untracked:boolean, conflict:boolean}]}
   - GitDiffRequest {path?:string, cached?:boolean} -> GitDiffResponse {text, truncated:boolean}
   - GitPathsRequest {paths:string[]} (stage/unstage)
   - GitCommitRequest {message:string 1..8192} -> GitCommitResponse {oid:string}
   - GitBranchesResponse {branches:[{name, current}], detached_oid?}
   - GitLogRequest {limit?:int 1..200} / GitFileLogRequest {path, limit?} -> GitLogResponse {commits:[{oid, short, author, date, subject}]}
   - GitHunksRequest {path} -> GitHunksResponse {hunks:[{index, header, lines:string[]}], truncated}
   - GitStageHunksRequest {path, indexes:int[] nonempty} -> GitHunksResult {staged_indexes}
   - GitBlameRequest {path} -> GitBlameResponse {lines:[{commit, line_number, author?, text}]}, truncated
2. node/src/services/git-service.mjs (+d.mts): pure parsers exported for unit tests:
   - parseStatusPorcelainV2(text) - handles 1/2/?/u lines, renamed next-line path, unborn "(unknown)" branch -> null, detached "(detached)" flag, submodule 160000 opaque.
   - splitUnifiedDiff(text) - [{index(1-based), header '@@ ... @@', lines[]}] per FILE section; ignores index/---/+++ noise.
   - parseBlamePorcelain(text) - pairs oid blocks with content lines after \t.
   - GitService class: run(args,{input}) execFile 'git' ['-C',workspace,'--no-pager',...] shell:false, GIT_TERMINAL_PROMPT=0, GIT_ASKPASS=echo, timeout 20s add/commit else 10s, maxBuffer 64MB.
   - status/diff(capped 1MiB->truncated)/stage(git add -- paths...)/unstage(restore --staged --)/commit(single -m arg; reject empty; on failure matching /refs\/heads|lock/i retry ONCE after 1s then surface COMMIT_FAILED+stderr)/branches(--format %(HEAD)%(refname:short))/log(--format=%H%x00%h%x00%an%x00%aI%x00%s -z-free NUL-split)/fileLog(same + --follow -- path)/hunks(diff -U3 -- path -> splitter)/stageHunks(rebuild patch = file header lines + selected hunks -> git apply --cached --whitespace=nowarn - via stdin input)/unstageHunks(diff --cached -> select -> apply --cached -R)/blame(blame -p -- path).
   - Path containment: every user path through workspace-relative resolve guard (reuse rg-service pattern) BEFORE entering args array.
3. node/src/routes/git.ts: GET /api/git/status | GET /api/git/diff | POST /api/git/stage | POST /api/git/unstage | POST /api/git/commit | GET /api/git/branches | GET /api/git/log | GET /api/git/file-log | GET /api/git/hunks | POST /api/git/hunks/stage | GET /api/git/blame. Not-a-repo -> NOT_FOUND-style typed code NOT_A_REPO (envelope), conflict-in-progress CONFLICT, commit-ref COMMIT_FAILED.
4. openapi.ts wiring + regen (~83 routes).

## Why this way
- Atomic apply-by-default means a stale-index race can never half-stage a file; the UI retries cleanly. (--reject would write .rej files into the worktree - unacceptable side effects.)
- Reverse-diff unstage mirrors stage symmetrically and reuses one splitter.
- Pure exported parsers keep CI headless: unit tests need NO repo, arch test owns ONE scratch repo lifecycle.
- Blame via -p (porcelain) is stable across git versions vs column positions in human format.

## Threat matrix
| Threat | Radius | Mitigation |
|---|---|---|
| Path escape via ../ or absolute paths to git add | HIGH | containment guard at route edge before arg build; tests assert rejection |
| Argument injection via filename like `--upload-pack` | HIGH | paths passed AFTER `--` separator for add/restore/diff/log/blame; array args shell:false |
| Commit message smuggling (leading -, embedded NUL/newline abuse) | MED | message as single argv element; strip NUL; length cap 8KB |
| Huge diff OOM | MED | 1MiB per-diff cap -> truncated:true; maxBuffer 64MB backstop |
| refs lock transient (AV/OneDrive class, seen 2026-08-16) | LOW-MED | retry once after 1s; COMMIT_FAILED with stderr surfaced |
| Hunk patch drift between list and stage (file edited meanwhile) | LOW | apply fails atomically -> client re-lists hunks; no silent partial |

## Dependencies
Phase-1 process manager patterns; envelope error codes; contracts regen. Frontend gutter decorations consume /status + /hunks later (data already shaped).

## Known pitfalls
- porcelain v2 renamed entries put origPath on a FOLLOWING line - naive line-splits corrupt it.
- Unborn branch: '# branch.head (unknown)' and no ab line - parser must not crash (fresh-init scratch repos in tests hit this FIRST).
- CRLF autocrlf noise in diffs - do not normalize; document.
- git blame on untracked/uncommitted file errors - map to BAD_REQUEST 'file has no commits'.
- Windows: spawn 'git' resolves from PATH fine; never wrap in shell quotes.

## Gates
1. Unit (no repo): fixture strings for porcelain v2 (incl rename/untracked/conflict/unborn/submodule), diff splitter (multi-file, multi-hunk, hunk-count/index stability), blame porcelain parse.
2. Arch (scratch repo): init->config->base commit->edit 2 files->status XY->stage one->diff --cached shows it->commit->log len 2->edit ONE file twice-separated->hunks>=2->stage hunk 1 only->diff --cached non-empty AND worktree still dirty for hunk 2->unstage-hunks reverses->blame modified line returns new short oid->not-a-repo dir gives NOT_A_REPO code.
3. Battery: npm run check + npm run test green; CI verify green.
4. Manual smoke deferred to frontend wiring (gutter decorations) - recorded, not claimed.
