# AIDE BUILD-series master router (B-phases)

Mission: make AIDE the best IDE for BUILDING and COMPILING real projects, and cut developer cost/time. Research-grounded 2026-08-22 (sources inside per-phase skills).

## Verified research base
1. VS Code tasks system (code.visualstudio.com/docs/debugtest/tasks + reference/tasks-appendix + vscode source jsonSchema_v2.ts): tasks.json v2 (label/type shell|process/command/args/isBackground/group/problemMatcher/dependsOn/dependsOrder/runOptions.runOn folderOpen); problem matchers turn output into markers (file/line/column/severity/message groups, fileLocation absolute|relative|autodetect, multiline loop, background matcher signals watch-ready); execution rides terminals/shell integration; auto-detect npm/gulp/grunt/jake.
2. Away-notifications are proven practice: ntfy.sh HTTP POST push incl --wait-cmd/--wait-pid wrappers, self-hostable, topic-as-password, email publishing; OSC 9/777/99 desktop notifications in modern terminals; Claude Code hooks model = structured lifecycle events -> user channels, async:true never blocks, fire only when attention needed (Warp/Otty suppress when focused).
3. Cost economics (measured): Turborepo remote cache ~50% task-duration / ~30% CI-job cut (Mercari 2026); Nx p95 pipeline 11m23s vs 18m DIY; sccache/ccache compile-unit caching, local-disk default, SCCACHE_BASEDIRS cross-dir sharing, incremental units NOT cacheable.

## Phase order (LOCKED by user 2026-08-22)
B1 task-service core -> B2 problem matchers -> B4 notification harness -> B3 compound tasks -> B5 local build cache.
Rationale: core loop first, errors-to-markers second, user's away-notification idea third (differentiator), then orchestration, then money-saver cache.

## Per-phase protocol (same as parity roadmap)
Live-research refresh at phase start (official docs only) -> SKILL.md per required structure -> contracts -> service -> routes -> wiring -> tests -> battery -> commit -> CI watch -> AGENT_NOTES journal.

## Program-wide threats (inherits parity roadmap)
argv arrays only / no shell strings; capability-gated network for ntfy/email (offline-first deny-by-default, mirrors providers pattern); bounded ring buffers on output streams; EventHub typed channels only; Windows: resolve .cmd shims (npm.cmd) without shell:true; EBUSY retries.

## Current baseline (2026-08-22)
84 documented routes at c458f63 (P4 git shipped, CI green). Reusable primitives: training-manager spawn/stream/stop pattern, ProcessManager tree-kill, EventHub typed channels, SettingsService, rg/git services. OPEN ISSUE: local arch-suite hang under --test-concurrency=3 (CI green; standalone green) - investigate paired runs before N1 perf claims.
