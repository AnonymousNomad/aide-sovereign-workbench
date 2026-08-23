# AIDE BUILD B1 — Task Service Core (.aide/tasks.json runner)

Status: IMPLEMENTED + VERIFIED 2026-08-22 (unit 11/11, arch 6/6, tsc node+browser OK, eslint OK, openapi regen clean, full arch suite 219/221 with 1 pre-existing env-timeout).

## Doctrine

- The task system is the BUILD backbone: users must run real project builds from AIDE with zero friction. Contract-first strict zod at both edges; argv-array spawning only (no shell strings); non-blocking run semantics (POST returns job_id immediately, lifecycle flows over the typed `tasks` WS channel).
- VS Code compatibility is a differentiator: read `.vscode/tasks.json` FIRST-class (schema subset v2.0.0), auto-detect npm scripts, normalize group forms.
- Offline-first: tasks run locally; nothing phones home.

## What exists (files of record)

- `common/contracts/tasks.ts`: TaskGroup (string|{kind,isDefault}), TaskDefinition strict (label/type shell|process/command/args/isBackground/group/problemMatcher passthrough/dependsOn/dependsOrder/runOptions.runOn), TasksFile (version literal '2.0.0'), TaskEntry (+source tasks.json|detected + groupKind/groupIsDefault), TaskListResponse, TaskRunRequest/Response {job_id}, TaskStopRequest, TaskJob/TaskStatusResponse, TaskEvent discriminated union started|output|exit.
- `node/src/services/task-service.mjs` (+ .d.mts): parseTasksJson (hand-rolled STRICT validation with TaskFileError detail - service is .mjs, cannot import zod contracts), validateTaskDefinition, detectNpmTasks(package.json), resolveCommand (Windows .cmd shims for npm/npx/tsc/yarn/pnpm/gulp/grunt/vite/jest/eslint/tsserver bare names ONLY), escapeCmdArg (Node's canonical cmd.exe verbatim escaping), resolveShimPath (where.exe -> absolute path, cached), TaskService class: loadTasksFile (candidates ['.aide/tasks.json', '.vscode/tasks.json']), list() merge configured+detected (strips internal `script` field before returning - strict contract rejects extras), run(label) NON-BLOCKING (spawn, publish started, return job_id at once; exit via events/status), stop(jobId) tree-kill (taskkill /PID x /T /F on win32 + SIGTERM elsewhere + delayed SIGKILL fallback), status().
- `node/src/routes/tasks.ts`: GET /api/tasks, POST /api/tasks/run, POST /api/tasks/stop (returns post-stop status), GET /api/tasks/status. mapTaskError: TaskFileError->BAD_REQUEST(detail), TASK_RUNNING->CONFLICT, NOT_FOUND, BAD_REQUEST, else INTERNAL.
- Wiring: openapi.ts buildRoutes `...routesForTasks(workspace, { onEvent: body => events.publish('tasks', body) })`; events.ts ChannelName + 'tasks' -> TaskEvent schema (fail-closed zod before broadcast).
- Tests: tests/unit/test-b1-tasks-parse.mjs (5), tests/arch/task-routes.test.ts (6: merge/detection, stdout capture+exit code 0, exit code 3 failed, detected-script runnable via bridge, NOT_FOUND/CONFLICT/stop/stopped-status/re-stop 400, malformed->BAD_REQUEST then recovery after file rm).

## How to extend

1. New task source (e.g. cargo/pyproject/make detection): add detector fn returning same DetectedTask shape, merge in list(), unit-test pure parser separately.
2. New lifecycle event: extend TaskEvent discriminated union + service publish site + EventHub schema in ONE commit (fail-closed hub drops mismatched payloads silently otherwise - loud test required).
3. Per-task cwd/env overrides: extend contract strict fields first, then service; regenerate openapi.json (`npm run contracts` / node scripts/contracts.mjs) same commit.

## Why (research grounding)

VS Code tasks v2 schema (code.visualstudio.com/docs/debugtest/tasks + reference appendix + vscode jsonSchema_v2.ts): label/type/command/args/isBackground/group/problemMatcher/dependsOn/dependsOrder/runOptions.runOn folderOpen; execution rides terminals; problem matchers turn output into markers (B2 consumes the passthrough field). Non-blocking start matches VS Code TaskExecution semantics (run returns an execution handle, not process completion).

## VERIFIED BUGS + LESSONS (2026-08-22, do not relearn these)

1. **Node >=18.x EINVAL on .cmd/.bat without shell** (CVE-2024-27980 hardening): spawn('npm.cmd') throws SYNCHRONOUSLY. NEVER set shell:true (argv doctrine). Fix pattern: bridge through cmd.exe: spawn('cmd.exe', ['/d','/s','/c', `"${line}"`], {windowsVerbatimArguments:true}) where line = [command,...args].map(escapeCmdArg).join(' '). escapeCmdArg = arg.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\*)$/,'$1$1') then wrap in quotes (Node's own normalizeSpawnArguments algorithm).
2. **%~dp0 breaks on bare shim names**: passing "npm.cmd" (bare) through the bridge made npm.cmd resolve its CLI relative to CWD (<ws>\node_modules\npm\bin\npm-cli.js MODULE_NOT_FOUND). MUST resolve absolute path first via where.exe (resolveShimPath, cached by lowercase name). Verified: absolute path -> exit 0; bare -> exit 1.
3. **Strict contracts reject internal fields**: detectNpmTasks attaches `script` for UI hints; list() MUST strip it before returning or server-side response validation 500s (BAD_RESPONSE). Rule: any internal-only field is stripped at the service boundary, not made optional in the wire contract.
4. **Long-running tasks block HTTP if handler awaits completion**: original run() awaited process close -> POST hung forever on sleeper tasks. Run handlers return job_id immediately; completion is event/status territory. Test it explicitly (sleeper 60s task + duplicate-run CONFLICT while running).
5. **Test harness find-over-wrapper bug**: events array stores {channel,data}; predicates must search over .data (events.map(e=>e.data).find(pred)). Symptom when wrong: "timed out waiting" while the JSON dump shows the event present. Also stale resolve(found.data) after changing find to data-level resolves undefined - typecheck does NOT catch resolved-undefined, only assertions do.
6. **Machine stall class (this dev box)**: node.exe launched from E:\nodejs hangs path-dependently (identical binary copied to C:\ runs instantly); intermittent across ALL process launches (reg query once hung 20s). Workaround until reboot/AV-fix: run everything via %TEMP% clone of node. This also explains the historical local battery hang - NOT test-concurrency contention. CI unaffected.

## Threat matrix

| Threat | Impact | Mitigation |
|---|---|---|
| shell:true to dodge EINVAL | command injection surface | cmd.exe bridge + escapeCmdArg only |
| Bare shim in bridge | %~dp0 misresolution, silent wrong-module failures | resolveShimPath absolute + cache |
| Unbounded output lines | daemon memory blowup | MAX_LINE_LENGTH 8000 truncate + line streaming, no full-buffer |
| Orphaned grandchildren | zombie processes after stop | taskkill /T tree kill + SIGKILL fallback timer; legacy note: prefer graceful always |
| Duplicate same-label runs | port/file conflicts between builds | CONFLICT on running label check |
| Strict-contract drift | 500 BAD_RESPONSE on list | fixtures cover detected+configured shapes; openapi drift test |
| Event payload rot | fail-closed hub drops events silently | TaskEvent zod union + arch test asserting every variant observed |
| %VAR% expansion inside cmd bridge args | unexpected env interpolation | documented limitation of .cmd bridge; plain binaries unaffected |

## Dependencies

node:child_process (spawn/execFile), crypto.randomUUID, ws EventHub channel 'tasks', zod4 contracts, scripts/contracts.mjs regen. No new npm deps. Frontend consumption (task runner panel, terminal integration per aide-arch-terminal) is a later slice - routes are UI-ready now.

## Phase audit checklist

1. npm run contracts regenerated + committed whenever route schemas change.
2. Arch suite covers: happy exit 0, failed exit N, stdout capture, npm-detected runnable, NOT_FOUND/CONFLICT/stop paths, malformed file recovery.
3. Any new spawn path tested on BOTH win32 and CI linux (bridge is win32-gated by path.sep check).
