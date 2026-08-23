# B3 — Compound Tasks (dependsOn / dependsOrder / background)

Phase skill for AIDE BUILD-series B3. Master router: aide-master-roadmap. Runs AFTER B2 (matchers) so compound runs can surface problems per-child-task. Research base: VS Code tasks v2 `dependsOn`, `dependsOrder:'sequential'|'parallel'`, background/activeOnStart matchers.

## Contract additions (common/contracts/tasks.ts)

```ts
TaskDefinition gains:
  dependsOn?: string | TaskDefinition | Array<string|TaskDefinition>
  dependsOrder?: 'sequential'|'parallel'   // default 'sequential'
  isBackground?: boolean
RunEntry gains: parent_job_id?: string|null, name_path?: string  // "build.watch > tsc"
```

## Semantics

- Sequential (default): run each dependency to terminal state; on failure STOP the chain, mark parent failed with `failed_dependency: <name>`.
- Parallel: start all deps concurrently; parent waits for ALL; failure of one cancels the others (process-group kill — reuse tree-kill from process manager; assert no orphans in test).
- Background dep (`isBackground:true` + matcher with begins/ends): considered "ready" when its problemMatcher signals active->compiling done, NOT on exit. If no background matcher configured, treat exit as readiness and warn once.
- Cycle detection BEFORE launch: DFS over dependsOn graph -> reject whole request with envelope error naming the cycle path. Never partially start.
- Name resolution: string deps resolve against workspace `.aide/tasks.json` registry by label; inline objects get synthesized labels `__dep_<n>`.

## Events

Reuse B1 job events. Parent + child jobs all appear in jobs list; children carry `parent_job_id`. UI groups them. Notification harness (B4) fires ONE notification for the root only.

## Tests FIRST

1. Two sequential deps -> order enforced via timestamps; outputs attributed to correct child.
2. Dep fails -> parent marked failed, third task never started.
3. Parallel: both started within tolerance; one fails -> other killed (assert process gone).
4. Cycle a->b->a -> 400 envelope, nothing ran.
5. Background watcher: ends-pattern flips readiness; parent starts only after signal.
6. Arch: contract rejects dependsOn as number etc.; openapi regen zero-diff after commit.

## Pitfalls

- Killing parallel group on Windows: use the SAME tree-kill helper as task-service; do not invent a second mechanism.
- Output interleaving: prefix every chunk line with `[<label>]` at the UI layer only — keep raw output per job for matchers (B2 parses per-job buffers, never the merged stream).
- Exit-code vs readiness confusion for watchers is THE classic bug — covered by test 5; do not skip it.

## Gate

Unit+arch green; e2e offline: define build+test compound in fixture workspace, run from UI, see grouped jobs + single completion toast. Journal.
