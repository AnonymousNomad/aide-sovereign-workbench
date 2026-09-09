---
name: aide-trace-intelligence
description: AIDE Trace Intelligence — the sovereign runtime-trace subsystem (Observe → Trace → Map → Replay → Explain → Fix → Verify) that makes GhostCode's product promise real. Research-grounded on the Node.js V8 inspector / Chrome DevTools Protocol (CDP). Use whenever implementing, extending, testing, or auditing trace-engine.ts, routes/trace.ts, the trace contract, the 'trace' WS channel, the RA 'Analyze Trace' hook, or when feeding runtime-failure evidence into agent prompts or Veritas.
---

# AIDE Trace Intelligence (GhostCode Integration)

## 1. North Star & Boundaries

**What this is:** a sovereign, offline runtime-trace subsystem. A child Node program runs under the built-in V8 inspector; we consume the Chrome DevTools Protocol (CDP) over WebSocket to capture execution events, map them to source, and emit a correlation-aware failure evidence chain for the Resident Assistant / primary model / Veritas.

**Who collaborates in AIDE:** the community works on this repo. This skill is the canonical build spec — read it before touching any trace file.

**Sovereignty (R9):** zero cloud, zero external runtime libraries. The tracer uses `process.execPath` (the same Node the daemon runs on). GhostCode's submitted repo declared `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` — that capability MUST NOT be imported into AIDE.

**Replay honesty contract:** replay = stepping through **captured events** on a timeline. It is NOT byte-level time travel, and it is never overpromised. Capability detection reports exactly what the engine can do.

**Scope guardrails (verified project law):** Trace Intelligence is an ADDITIVE subsystem. Never modify: the editor, daemon core, model runtime, the existing DAP/LSP managers, `scripts/start.mjs`, or the facade topology (port 4777 single edge).

## 2. Verified Research Base (sources on record)

These facts are confirmed, not assumed. If behavior contradicts them, the code is wrong, not the protocol.

- **Attach mechanics (nodejs.org debugger docs + node core issue #24085):** `node --inspect`/`--inspect-brk` prints `Debugger listening on ws://127.0.0.1:PORT/UUID` on **stderr**. `--inspect-port=0` (or `--inspect-brk=127.0.0.1:0`) requests a **random, race-free port**; parse the actual ws URL out of stderr. (bnoordhuis, node core: "You can start the inspector race free on a random port with --inspect-port=0.")
- **Security (node cli docs, "debugging security implications"):** binding the inspector to a public IP is insecure — remote code execution attack via the debugger WS. Default host is 127.0.0.1. Always bind explicit loopback: `--inspect-brk=127.0.0.1:0`.
- **`--inspect-brk` vs `--inspect` vs `--inspect-wait`:** brk breaks on the first line of user code as soon as the debugger attaches; wait pauses until Runtime.runIfWaitingForDebugger. We use brk + attach + `Runtime.runIfWaitingForDebugger`.
- **`--enable-source-maps` (node cli docs):** makes stack traces report original source lines (TS/etc.) instead of transpiled output. **Caveat:** a custom `Error.prepareStackTrace` in the traced program prevents the rewrite (node issue #29994, #50733). Also small overhead on every `Error.stack` access — fine for a trace target.
- **CDP structures (chromedevtools.github.io/devtools-protocol/*/Runtime):**
  - `Runtime.enable` → sends `executionContextCreated` immediately for EVERY existing context (so with brk, the main context event arrives on attach, not before).
  - `Runtime.consoleAPICalled` params: `type` (log|debug|info|error|warning|dir|dirxml|table|trace|clear|startGroup|startGroupCollapsed|endGroup|assert|profile|profileEnd|count|timeEnd), `args: RemoteObject[]`, `executionContextId`, `timestamp`, `stackTrace` (async chain auto-reported only for assert/error/trace/warning), `context`.
  - `Runtime.exceptionThrown` params: `timestamp`, `exceptionDetails: { exceptionId, text, lineNumber (0-based), columnNumber (0-based), scriptId, url, stackTrace: { description, callFrames: [CallFrame], parent, parentId }, exception: RemoteObject }`.
  - `Runtime.StackTrace.callFrames[]` → `Runtime.CallFrame`: `{ functionName, scriptId, url, lineNumber (0-based), columnNumber (0-based) }`.
  - `Debugger.scriptParsed` params: `scriptId, url, startLine, startColumn, endLine, endColumn, executionContextId, hash, isModule, hasSourceURL, sourceMapURL, ...`.
  - **0-based vs 1-based:** CDP line/column numbers are 0-based; editors/markers/tests are 1-based. Convert by +1 at the capture boundary — do it in ONE place (the mapper), not scattered.
  - `Runtime.CallFrame.url` for `node:internal/*` and `eval` frames is NOT a file path — filter those out so the trace only surfaces workspace/user code.
  - `RemoteObject`: `{ type, subtype, className, value, unserializableValue (NaN/Infinity/-Infinity/-0/BigInt), description, objectId }`. Primitive `value` strings can be huge — cap them. Objects carry `description` (usually truncated by the runtime) — prefer that over evaluating `objectId` (avoid property walks unless a UI feature demands them).
- **Memory discipline (node inspector docs + CDP):** "Original objects are maintained in memory unless they are either explicitly released or are released along with the object group." The inspector console keeps console-argument objects alive. For a short-lived trace target (seconds) this is irrelevant; for a long-lived target add periodic `Runtime.discardConsoleEntries` (and drop stored entries), else the traced process grows.
  - `Runtime.discardConsoleEntries` only clears the inspector's own console store, not our stored events.
- **WebSocket client (project dependency):** `ws` is already a dependency (events.ts imports `{ WebSocket, WebSocketServer }`). `new WebSocket(url)` is the client. No new dependency is required. The Node inspector WS server does not require a special subprotocol.

## 3. Architecture Map (as implemented)

- `common/contracts/trace.ts` — zod `.strict()` contract: `TraceCapabilities`, `TraceEvent` (id/ts/kind/runtime/detail/file/line/column/callStack/value/errorMessage), `TraceSession`, `TraceSessionDetail` (summary + `events`), `TraceStartRequest/Response`, `TraceStatusResponse`, `TraceStopResponse`, `TraceListResponse`, `TraceQuery`/`TraceSessionResponse`, `TraceEvidence` (failure/immediate_cause/previous_state_transitions/originating_value/relevant_input/confidence/caveat), `TraceEvidenceResponse`, `TraceStreamEvent` (WS payload). Types `Trace*T` exported for both TS stacks.
- `node/src/services/trace-engine.ts` — `TraceEngine` class. spawn → stderr ws-URL parse → WebSocket attach → `Runtime.enable`+`Debugger.enable`+`Runtime.runIfWaitingForDebugger` → event capture → source mapping → evidence chain builder. Capability probe via `node --version`. Session store in-memory (Map + ordered array). Max events (10000) + max sessions (20) with eviction.
- `node/src/routes/trace.ts` — `routesForTrace(engine)`: GET `/api/trace/status`, POST `/api/trace/start`, POST `/api/trace/stop`, GET `/api/trace/list`, GET `/api/trace?id=…`, GET `/api/trace/evidence?id=…`.
- Wired in `node/src/openapi.ts`: `BuildRoutesOptions.traceEngine?: TraceEngine`; created in `main()` (`node/src/server.ts`) and passed in WITH a shutdown hook `server.addShutdownHook(() => traceEngine.shutdownAll())` — same pattern as dapManager. Fallback `new TraceEngine({...})` inside `buildRoutes` for tests.
- `node/src/events.ts` — `trace` channel added (schema `TraceStreamEvent`); engine publishes `{sessionId, event}` live.
- `common/facade-route-map.json` — `/api/trace` → `"ts"`.
- `common/openapi.json` — regenerated via `node scripts/contracts.mjs`.
- RA hook: resident views the last failed trace via `/api/trace/evidence?id=<last>` (id of last session with exceptionCount>0 or exitCode!==0) and surfaces "Analyze Trace".

## 4. What To Do / How (build sequence)

1. **Contract first** (`common/contracts/trace.ts`): all request/response schemas `.strict()`, description strings capped (see traps), replay mode literal `'timeline'`.
2. **Engine** (`node/src/services/trace-engine.ts`): the exact flow that works (verified against research):
   - `caps = await capabilities()`; throw if node probe false.
   - Resolve `cwd`/`target` inside workspace (path containment — hold the boundary).
   - Spawn `process.execPath` (or `nodeCommand` override) with `['--inspect-brk=127.0.0.1:0', '--enable-source-maps', target, ...args]`, `stdio: ['ignore','pipe','pipe']`, `windowsHide: true`, env `{...process.env, AIDE_TRACE_SESSION: id}`.
   - On stderr data: tee into output events AND regex `/ws:\/\/[^\s]+/` for the ws URL. On stdout data: output events.
   - `waitForReady`: poll for ws URL / error status / child-exit promise flag up to 15s.
   - `connect`: `new WebSocket(wsUrl)`; on open send `Runtime.enable`, `Debugger.enable`, `Runtime.runIfWaitingForDebugger`; set status `running`. Resolve start() only after open succeeds so the response reflects a real attach.
   - In `handleMessage`, switch on `message.method` for the four capture cases + ignore the rest.
   - On child `exit`, `finalize` (exitCode, status, error if nonzero w/o exception, publish exit event, close socket).
   - Evidence builder: locate last exception event; slice the ≤10 prior console/script events; build `TraceEvidence` with explicit `confidence` (see §7 correlation law) and caveat text.
3. **Routes** (`node/src/routes/trace.ts`): thin, throw `RouteError('NOT_FOUND', …)` for unknown sessions so the server maps to 404 (not 500), `RouteError('BAD_REQUEST', …)` for bad input.
4. **Wiring**: openapi.ts option + fallback; `main()` construction + shutdown hook; events channel; facade map `"/api/trace": "ts"`; regenerate openapi.json.
5. **Tests** (`tests/arch/trace-routes.test.ts` etc., ArchServer + mkdtemp-workspace style): capability detection honesty, contract validation, REAL spawn of a tiny workspace script that logs twice then throws → assert script/console/exception events, source mapping (file resolves inside workspace, line is 1-based), evidence non-null with confidence, HTTP 404 on unknown id, facade map present, `/api/trace/status` caps. Also assert `node:internal` frames are filtered.
6. **Gates**: `tsc -p tsconfig.node.json`, eslint, `node scripts/contracts.mjs`, focused arch tests, then broader battery (CI is the real gate on Windows for the pre-existing 5 local failures).

## 5. What Code To Write — key patterns (do not hand-wave)

```ts
// engine — spawn + stderr url parse
const wsUrlMatch = /ws:\/\/[^\s]+/.exec(text);           // from stderr 'data'
// attach — MUST enable before runIfWaitingForDebugger
this.send(socket, 'Runtime.enable', {});
this.send(socket, 'Debugger.enable', {});
this.send(socket, 'Runtime.runIfWaitingForDebugger', {});

// mapper — single place converting CDP -> editor coordinates
function mapFile(url: string | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('file://')) return path.resolve(decodeURIComponent(url.slice(7)));
  if (url.startsWith('/') || /^[A-Za-z]:[\\/]/.test(url)) return path.resolve(url);
  return null; // node:internal, eval, http — filtered
}
const LINE = (n?: number) => (typeof n === 'number' && n >= 0 ? n + 1 : 0); // CDP 0-based -> 1-based

// value capture — shallow, capped
function stringifyRemote(o: CdpRemote | undefined): string {
  if (!o) return '';
  if (o.unserializableValue) return truncate(o.unserializableValue, 500);
  if (o.type === 'string') return truncate(String(o.value ?? ''), 500);
  if (o.value !== undefined) return truncate(String(o.value), 500);
  if (o.description) return truncate(o.description, 500);
  return `[${o.type ?? 'remote'}]`;
}
```

Never store `objectId`; never call `Runtime.getProperties` in v0 (keeps the size bounded and no retained-object graph).

## 6. What NOT To Do (hard rules)

- **Do NOT** bind the inspector to anything but loopback. `0.0.0.0` is an RCE vector.
- **Do NOT** use a fixed port (9229 or manual slot assignment) — race with the operator's llama-server (8081, PID 11740 — never touch) and other tools; use port 0 + stderr parse.
- **Do NOT** hardcode `node` from PATH — use `process.execPath`; PATH node may differ from the daemon's node.
- **Do NOT** claim byte-level replay. Capability says `replay: 'timeline'`. UI says "step captured events".
- **Do NOT** claim causation. Evidence is correlation with explicit confidence + caveat (§7).
- **Do NOT** eval/執行 arbitrary target-side expressions; never `Runtime.evaluate` user text.
- **Do NOT** capture beyond caps (10000 events) or store unbounded strings; truncate at every field.
- **Do NOT** let a traced child outlive the daemon: shutdown hook must kill active sessions.
- **Do NOT** return `INTERNAL` (500) for unknown session ids — `RouteError('NOT_FOUND')`.
- **Do NOT** modify editor/daemon-core/DAP/LSP/model code to make traces work.
- **Do NOT** copy GhostCode source or its Gemini capability into AIDE.

## 7. Issues + Dependency Registry

- **Correlation ≠ causation (the honesty law).** Failure evidence chains ordering into `previous_state_transitions`, but the top of the chain is the closest PRIOR event, not proof of cause. confidence rules: `high` = failure source-mapped AND immediate_cause in same file; `medium` = source-mapped but cause elsewhere/none; `low` = no source resolution. Caveat text is part of the contract — never drop it.
- **`Runtime.enable` fires `executionContextCreated` for existing contexts immediately.** With brk, the main context appears right after attach — expect one context event even in an empty script.
- **`node:internal/*` frames:** url is not file:// — the mapper must filter them or the timeline fills with framework noise.
- **Async stack traces** auto-report only for assert/error/trace/warning (CDP). Other `console.*` calls lose the async chain unless `Debugger.getStackTrace` is called with `parentId` — out of scope for v0.
- **Dependencies:** `ws` (already in repo, used by events.ts) — no new deps. zod (present). `tsc`/eslint (present). `mkdtemp` + node:test for tests.
- **Remaining v0 gaps (say them out loud, don't hide):** long-lived-target memory (add `Runtime.discardConsoleEntries` loop); no source .map decode of our own (we rely on `--enable-source-maps`); sessions in-memory only (daemon restart loses them); RA link is via last-session id not a subscription; `TraceStreamEvent` WS channel is publish-only (no filtering by session).

## 8. Known Bugs & Traps (verified in this codebase)

- **Windows `AddShutdownHook`/spawn cleanup:** always close the child AND the ws socket; a killed child's `exit` event may still fire after kill → guard with `stoppedByUser` so status stays `stopped`, and null the socket in `close`.
- **stderr stdout buffering:** never concatenate unbounded stderr — keep a capped tail (4000 chars) for the error message fallback.
- **Port-0 + pipe:** do NOT parse stdout for the ws URL (node writes it to stderr); a wrapped launcher may reprint it — only match the first occurrence on stderr.
- **`--enable-source-maps` + custom `Error.prepareStackTrace`:** some libs break the rewrite; if a frame stays on the generated file, that is the target's own code overriding behavior — the engine's `source_mapping` capability must stay honest (it reports true only because we pass the flag; a target that breaks it is its own fault, documented, not our bug).
- **Double exit event:** `finalize` publishes the exit event; do NOT publish another one in `start()` after `waitForReady`.
- **`structuredClone(detail)` before returning:** handlers must never mutate live session state.
- **Agent memory:** don't leave spawned trace children running after a test — the test battery asserts process hygiene; kill in `after()`.
- **Contract regeneration:** after touching `common/contracts/trace.ts`, run `node scripts/contracts.mjs` and commit `common/openapi.json` drift; verify zod==lockfile before regen.

## 9. Threat Matrix

| Threat | Vector | Mitigation (this code) |
|---|---|---|
| Inspector RCE | traced process exposes inspector on public interface | loopback-only bind (`--inspect-brk=127.0.0.1:0`) |
| Inspector RCE via hostile workspace script | arbitrary `Runtime.evaluate` from the tracer | tracer never evaluates; reads events only |
| Path escape | target/cwd resolves outside workspace | `path.relative` containment check at start |
| DoS / memory exhaustion | unbounded event/value capture | caps: 10000 events, string caps per field, session eviction (20) |
| Child process leak | orphan inspector children | shutdown hook → `shutdownAll()`; `stoppedByUser` guard; test battery process hygiene |
| Info disclosure | console args containing secrets | values capped to 500 chars shallow preview; store is local/in-process, `.aide` not synced |
| WS channel abuse | subscriber floods / replay | channel is server-published only; client subscribes per channel; schema-validated payloads |
| Supply chain in trace target | target `require`s malicious deps | the user runs the workspace code; tracer only observes (same privilege as `node` the user already runs) |
| False causality in AI evidence | evidence chain misread as cause | explicit confidence + caveat in `TraceEvidence`; RA wording must say "closest prior event" |

## 10. Verification Battery (before claiming done)

1. `node scripts/contracts.mjs` succeeds and `common/openapi.json` regenerates.
2. `tsc -p tsconfig.node.json` and eslint pass.
3. Arch tests: focused `tests/arch/trace-*.test.ts` (real spawn, source mapping, evidence, 404s, caps, facade map) then the broader battery; CI green is the authoritative gate.
4. Manual: start a real trace of a failing script via `POST /api/trace/start`, observe `exceptionCount>=1`, `GET /api/trace/evidence?id=…` returns non-null, `node:internal` frames absent.
5. Process hygiene: no stray `node --inspect-brk` processes remain (`Get-Process node` matches pre-test baseline).
6. Journal `AGENT_NOTES.md` with what changed + this subsystem's state.

## 11. Future Runtimes (design ready, not built)

The evidence contract is runtime-agnostic (`TraceRuntime` enum, `runtime: 'node'`). To add Python later: spawn with a debugger (debugpy) speaking the SAME CDP-ish protocol is wrong — instead define a normalized emitter: the runtime emits structured `AIDE_TRACE_*` events (env contract `AIDE_TRACE_SESSION` already exists), and the engine maps that emitter's output into `TraceEvent`. Never bolt a second protocol parser in; normalize at the edge.