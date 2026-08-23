# B2 — Problem Matchers (compiler/linter output -> diagnostics)

Phase skill for AIDE BUILD-series B2. Master router: aide-master-roadmap. B1 (task service) shipped first; this wires task OUTPUT into the Problems pipeline.

## What & Why

VS Code's killer tasks feature is problem matchers: regex patterns that scan task output and produce editor diagnostics. For AIDE, B2 is also the data feed for the future agent loop (A1 watches diagnostics to self-correct). Without B2, "run build, see errors inline" doesn't exist — table stakes.

Research base: VS Code Tasks v2 docs (`problemMatcher` schema: owner/source/pattern with file/line/column/message groups), TypeScript ESLint/tsc output formats.

## Contract

Extend `common/contracts/tasks.ts`:

```ts
ProblemPattern: { regexp, file(group=1), line(2,1-based), column(3,optional), severity(4,optional), message(5,optional), code(optional), loop:boolean }
ProblemMatcher: { name, owner, source, applyTo:'allDocuments'|'openDocuments', pattern: ProblemPattern|ProblemPattern[], fileLocation:'relative'|'absolute'|['relative',basePath], background?: { activeOnStart, beginsPattern, endsPattern } }
TaskDefinition gains: matcher?: string | ProblemMatcher   // named or inline
```

Named matchers ship bundled in a registry (`node/src/services/problem-matchers.mjs`): `tsc`, `eslint-stylish`, `eslint-compact`, `node-trace`, `msbuild`, `cargo-rustc`. Registry is data (JSON), not code, so users can extend via workspace `.aide/matchers.json` WITHOUT daemon changes.

## Service

- `parseProblems(matcher, text)` -> `Diagnostic[]` pure function; unit-testable without spawning anything.
- During a task run (B1 `run()`): subscribe to output chunks; if the task has a matcher, run parser per chunk AND on flush over the full buffer (chunk boundaries can split matches — always re-parse full buffer at end).
- Emit diagnostics through the existing events channel: `{ type:'tasks.problems', job_id, problems }`.
- Dedupe by (file,line,column,message) — compilers repeat errors per rebuild.
- File resolution: `fileLocation relative` resolves against `options.cwd`; reject paths escaping the workspace (reuse path-containment from backend-core).

## Routes (zod strict, error envelope)

- `GET /api/tasks/matchers` -> registry list (names + owners)
- Diagnostics ride the event channel; no sync route needed until UI asks.
- Optional `POST /api/problems/parse { matcher, text }` -> parsed problems (used by tests + power users).

## Tests (write FIRST)

1. tsc sample output -> exact expected diagnostics array (file/line/severity).
2. eslint stylish multi-file sample.
3. Chunked stream: split an error line across two chunks -> final parse still yields 1 problem (full-buffer pass).
4. Relative path resolved against cwd; absolute kept; `../escape.tss` REJECTED.
5. Background matcher: begins/ends patterns gate which lines are scanned.
6. Arch test: POST parse route roundtrip through contract validation; bad matcher name -> 400 envelope not 500.
7. Dedupe: same problem twice -> one entry.

## Pitfalls (from B1 lessons — do not repeat)

- Node EINVAL on `.cmd`: any helper binary spawned here goes through the cmd.exe bridge + resolveShimPath (B1 skill).
- Strict contracts strip unknown fields at the edge: define matcher fields IN the contract now, don't smuggle them later.
- Non-blocking rule: parsing must never block the run() response; it happens on the event stream.
- Windows paths in output use `\` and sometimes have drive letters — normalize to forward slashes for IDs but keep original for display.

## Gate

Two-stage gate (clarified via continuous-improvement-sop after B2 shipped - original single gate conflated daemon feed with UI):

**Daemon gate (B2 — SHIPPED, commit 2e57f85, CI green):** unit tests 1-7 plus format/severity/multi-matcher extras green; arch suite grows >=2 including an END-TO-END test (task with `$tsc` runs -> resolved diagnostics arrive over the `tasks` event channel); openapi regen clean; unknown matcher -> 400 envelope both via route and pre-spawn fail-fast; workspace-escaping paths dropped with count; MUTATION TEETH PROVEN (breaking severity normalization fails 5 tests; removing containment check fails the escape test). Parsing never blocks run() response.

**Panel gate (B2b — PENDING, tracked in master roadmap):** Problems panel consumes `problems` events, e2e (network blocked) shows entries from a real failing fixture task, clear-on-rerun semantics defined. Do NOT claim editor-diagnostics parity until this gate passes.

Journal in AGENT_NOTES at each stage.
