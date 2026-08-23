# AIDE Performance & Launch Engineering

Master discipline for making AIDE fast, lean, and impossible to call "another bloated Electron IDE". Grounded in: Electron official performance docs (lazy-loading doctrine, main-process blocking rules), VS Code File Watcher Internals wiki (UtilityProcess watchers, correlated events, suspend/resume), the yaw.sh Electron performance audit (fixed-cost ledger, deferred-optimizations.md practice), acreom's renderer-bypass MessageChannel loader (100x bulk-load speedup, 10k files 113s vs ~7000s), chokidar degradation evidence at scale (100k files -> ~1GB RAM / 50% CPU with polling). Researched 2026-08-22.

## The Fixed-Cost Ledger (know what NOT to fix)
Chromium fixed overhead you CANNOT reduce — budget for it, never chase it:
| Component | Idle cost | Action |
|---|---|---|
| GPU process | ~266 MB (peaks ~585 MB) | None possible. Document. |
| Network Service process | ~36 MB | Cannot merge. Document. |
| Locale .pak files + ffmpeg/vk_swiftshader/dxcompiler DLLs | ~30-40 MB disk | Stripping pipeline breaks every Electron update — NOT worth it unless download size becomes a measured complaint |
Rule: every "why is AIDE using X MB" answer starts from this ledger plus our own measured numbers.

## Startup Doctrine (budget + instrument)
1. Budgets (asserted in CI once P9 lands): window-visible < 2s cold on dev-class hardware; first interactive editor < 3s; daemon ready < 1s.
2. Instrument with named marks (`process.hrtime.bigint()`), zero cost when unread: `daemon:spawn`, `routes:listen`, `ui:first-paint`, `editor:first-open`. Log to JSONL on `--perf` flag only.
3. Lazy-load in strict order of user journey: Monaco workers already lazy; native modules (node-pty costs 20-100ms init) load on FIRST terminal open, never at boot; model manager loads on first model request; training manager on first RUN JOB.
4. Never block the daemon event loop: no sync fs/child_process on request paths; CPU-heavy work goes to worker threads or a utility process.
5. Defer all non-journey work (update checks, indexers, telemetry-free housekeeping) behind `requestIdleCallback`-style scheduling AFTER first paint.
6. Stagger multi-window/session restore by ~200ms per window (each spins a Chromium renderer).

## Renderer Purity Rule
The UI process renders. Nothing else.
- Bulk file loading/parsing NEVER round-trips through the renderer. Pattern (acreom-proven): MessageChannel port created in preload at startup; main process streams batches directly to a worker; renderer receives only final state deltas. Measured 100x on 10k-file imports.
- Long lists (search results, quick-open, problems) virtualize from day one; test with a 100k-item fixture (already in parity threat matrix).
- Spellcheck off unless an input feature needs it.

## Memory Governance
- Leak classes to audit quarterly: listeners not removed on view teardown, timers/intervals not cleared (app.js has a 3s poll — must be cleared on view switch), IPC/event subscriptions accumulating, closures holding large buffers.
- Bounded ring buffers everywhere streaming data lands (task output 512KB cap exists; problems buffer 5000 lines exists).
- userData hygiene: clean stale `.tmp` files from Chromium sessions on startup (case-insensitive match on Windows).
- RAM doctrine from aide-arch-model-runtime governs models (never load model + big corpus simultaneously on 16GB).

## File Watching Strategy (large repos)
- Use @parcel/watcher-class native watching in a SEPARATE process (VS Code pattern); never chokidar-polling over whole trees.
- Default exclude globs shipped out of the box: node_modules, .git, target, dist, build, *.gguf, .aide/cache.
- Dedupe overlapping watch requests (same-path last-wins; recursive covers non-recursive inside it).
- Suspend/resume: deleted watched path falls back to 5s poll until it reappears (VS Code behavior).
- Gate: 50k-file fixture repo watcher settles < 5% steady-state CPU, events coalesced server-side before hitting the UI channel.

## Deferred-Optimizations Ledger (mandatory)
Every performance decision NOT to fix something gets one line in AGENT_NOTES under "Deferred perf": item, measured number, why deferred, revisit trigger. Prevents re-investigating the same report forever (yaw.sh lesson).

## Verification Gates (verification-complete applies)
1. Startup marks logged and within budget on a real run (not dev-server).
2. 100k-item virtualization fixture passes without jank assertion.
3. 50k-file watcher gate above.
4. Memory soak: 30-min session, open/close 20 files, run 2 tasks — RSS returns within 15% of post-boot baseline.
5. All existing batteries stay green (perf work never regresses correctness gates).
