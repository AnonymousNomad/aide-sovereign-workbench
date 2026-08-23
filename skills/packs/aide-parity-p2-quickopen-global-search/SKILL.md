# AIDE P2 - Quick Open + Global Search (ripgrep)

Research basis (VERIFIED 2026-08-22, ripgrep 15.x docs + BurntSushi guidance):
- VS Code itself uses `rg --json` (confirmed by ripgrep author). JSON Lines: begin/match/context/end/summary; match.data = {path:{text|bytes}, lines:{text|bytes}, line_number (1-indexed), absolute_offset, submatches:[{match:{text},start,end}]}.
- Non-UTF8 data arrives as {bytes: base64} - parser MUST handle both.
- --json cannot combine with --files/-l/-c. File listing = separate `rg --files` invocation (respects .gitignore).
- Always pass pattern via -e to prevent user input starting with '-' being parsed as flags (arg injection). argv arrays only, never shell strings.
- Local machine: rg 15.0.0 at C:\Users\Grey_\.kimi-code\bin\rg.exe (on PATH). CI ubuntu-latest: rg usually present but NOT guaranteed -> tests use injected fake spawnChild; live-rg test self-skips when `rg --version` fails.

## What
1. common/contracts/search.ts: QuickOpenQuery {q(1..128), limit?(1..200 default 50)}; FileEntry {path, score}; QuickOpenResponse {files[], cache_age_ms}; SearchRequest {query(1..256), isRegex?(default false), caseSensitive?(default false), maxResults?(1..10000 default 1000), fileGlob?}; SearchSubmatch {text,start,end}; SearchMatch {path,line_number,line_text,submatches[]}; SearchResponse {matches[], truncated, elapsed_ms, error?}; FileListResponse {files[], truncated}.
2. node/src/services/search-service.mjs:
   - locateRg(): env AIDE_RG -> 'rg' on PATH; verify via spawnSync --version once, cache result; expose available flag.
   - listFiles(workspace): spawn rg --files, resolve array; TTL cache 5s; cap 50k entries.
   - fuzzyScore(query, path): subsequence match with bonuses (consecutive +8, boundary after / _ . - +8, start +12, camel hump +6) else null; lowercase compare.
   - quickOpen(q): score cached file list, sort desc by score then path asc, slice limit.
   - search(opts): build args [--json --max-count 1000 per-file? no: global cap] [-e query] (+ -i unless caseSensitive) (-F unless isRegex) (+ -g glob); stream stdout, split lines, JSON.parse each, keep type==='match', map bytes->'<binary>' text; stop+kill at maxResults (truncated=true if killed or summary shows more); reject on stderr 'regex parse error' as BAD_REQUEST-shaped {error}.
3. d.mts declarations; routes: GET /api/search/quick-open?q&limit, GET /api/search/files, POST /api/search. Wire in openapi.ts (~71 routes).

## Why this way
- Process-per-search with streaming kill-at-cap mirrors VS Code's search service: bounded memory regardless of repo size, no long-lived daemon state to corrupt.
- File-list cache (5s TTL) makes palette feel instant; staleness acceptable for navigation, never for writes.
- Fuzzy scoring in JS over pre-listed files beats spawning fzf-style tools: zero extra deps, deterministic, testable.
- Injected-spawn testing (pattern proven in training-runner B2): unit/arch tests NEVER require real rg; one optional live test skips cleanly.

## Threat matrix
| Threat | Radius | Mitigation |
|---|---|---|
| Query starting with '-' parsed as rg flags | HIGH security | always ['-e', query] before pattern; argv array, shell:false |
| Regex ReDoS / catastrophic backtracking | MED | default literal mode (-F); regex mode capped maxResults + process kill at 10s hard timeout |
| Result flood OOMing daemon | HIGH perf | streaming parse line-by-line; hard cap maxResults; child killed immediately at cap |
| Path traversal via returned paths | LOW | paths are rg-relative to workspace; route layer joins+verifies inside workspace before any open |
| Binary/base64 data breaking UI | LOW | bytes variant rendered as '<binary N bytes>' placeholder |
| rg missing on user machine | MEDIUM ops | locateRg() typed NOT_READY error surfaced in UI with install hint; feature degrades, daemon stays up |

## Dependencies
Upstream: aide-arch-backend-core, P1 (palette will render quick-open results; command aide.quickOpen.show already registered). Primitives: RouteError, Envelope, contracts regen. Blocks: P3 editor (open-at-line navigation), P4 SCM (search-in-changes later).

## Known pitfalls
- Windows paths from rg come with backslashes; normalize to forward slashes at service edge for stable scores/keys.
- CRLF: lines.text includes \r\n - strip trailing \r before emitting line_text.
- summary message is last; do not treat its absence as error (killed-at-cap runs have none).
- CI flake rule: any waitFor >=90s budget (aide-ci-diagnostics). EBUSY retry for temp workspaces.

## Gates
1. Unit: fuzzy scorer table (exact/partial/subsequence/no-match, boundary+camel bonuses); JSON-lines parser incl. bytes variant + context/end/summary skip; truncation kill-at-cap with fake rg emitting 5000 matches under cap 100; BAD_REQUEST on invalid regex via fake stderr.
2. Arch: envelopes for all three routes; unknown-route contract violations 400; quick-open empty-query 400.
3. Perf: quickOpen over 50k synthetic paths < 150ms local (x10 CI multiplier).
4. Manual: real-repo smoke - Ctrl+P finds known file by camel fragment; search 'TODO' returns grouped matches < 2s on this repo.
