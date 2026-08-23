# B5 — Local Build Cache (content-hash task outputs, offline Turborepo-style)

Phase skill for AIDE BUILD-series B5 (final BUILD phase). Master router: aide-master-roadmap. Research base: Turborepo local cache + hash pipeline (hashes: package files, env vars in `inputs`, dependency graph), Nx caching model, sccache. All LOCAL — no cloud sync ever.

## Design

- Cache dir default `<workspace>/.aide/cache/builds` (gitignore template auto-added). Configurable via `.aide/config.json` `cache.dir`.
- Key = sha256 of canonical JSON: { task label, resolved command argv, cwd-relative inputs globs -> file contents hashes, env subset declared in task `cache.env`, daemon/tool versions }. Include node version — different node = different output.
- On run(): if task declares `cache: { inputs: ["src/**", "package.json"], env: ["NODE_ENV"] }` and key hits -> RESTORE: replay recorded stdout/stderr chunks to the terminal at original pace (fast-forward option), emit same exit code + problems from cached parse (B2), mark job `restored:true`. Skips process spawn entirely.
- Miss -> run normally; on success (exit 0) record manifest: { key, exitCode, outputs[], logPath, problemsPath, sizeBytes }.
- Eviction: LRU by last-hit, cap default 2GB or 50 entries; enforce on write.
- Invalidation is automatic BY CONSTRUCTION (hash miss). Manual: `POST /api/tasks/cache/clear`.
- NEVER restore a FAILED run (exit != 0 not recorded) — matches Turborepo behavior and avoids caching flaky failures.

## Honesty rules

- Restored jobs MUST be visibly labeled "restored from cache" everywhere (jobs list, terminal banner, notifications). Silent restores are a trust bug.
- If any input glob matches >5000 files, refuse caching that task with explanatory envelope (perf guard).

## Contract

```ts
TaskDefinition gains: cache?: { inputs:string[], env?:string[] }
RunEntry gains: restored?: boolean
CacheManifest: { key, label, createdAt, lastHitAt?, exitCode, sizeBytes }
```

Routes: `GET /api/tasks/cache/stats` (entries,total bytes,hit/miss counters), `POST /api/tasks/cache/clear`.

## Tests FIRST

1. Run clean task -> miss -> run again same inputs -> restored, identical exit code + problems; spawn NOT called (spy).
2. Touch an input file -> hash differs -> real run.
3. Change undeclared file -> still hit (proves inputs scoping).
4. Declared env var change -> miss; undeclared env change -> hit.
5. Failing run not recorded.
6. Eviction: set tiny cap -> oldest evicted.
7. Arch: strict contract rejects bad cache shape; stats route shape stable (openapi zero-diff after regen).

## Pitfalls

- Hash file contents, not mtimes (mtimes lie across git operations).
- Normalize path separators before hashing on Windows.
- Replay must preserve chunk boundaries for terminal rendering tests; store newline-normalized text + original exit code only.
- Do not cache tasks whose matcher has background watchers (nondeterministic readiness).

## Gate

Unit+arch green; e2e offline: build fixture twice, second shows "restored" badge; journal. This closes the BUILD series -> update aide-build-series-roadmap router marking all five shipped.
