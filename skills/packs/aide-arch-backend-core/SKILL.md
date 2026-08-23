---
name: aide-arch-backend-core
description: Phase 1 SOP for the AIDE offline-first IDE rebuild — the modular daemon backend: HTTP router with zod .strict() validation at every route edge, fixed error envelope, workspace filesystem service with path containment, config/env validation, structured logging, process manager (spawn/execFile only, tree kill on Windows), health endpoint, graceful shutdown (children first). Use whenever writing backend routes/services, adding a workspace/file operation, debugging "route 500s", "path escape", or shutdown hangs, or auditing the daemon. Research-grounded (nodejs.org child_process docs, api-contract-testing.com, VS Code engineering docs).
---

# AIDE Architecture — Phase 1: Backend Core

## Doctrine

Offline-first (localhost only, bind 127.0.0.1). Verify before claiming (route tests + live curl). Contract first (zod at the edge). Fail closed (reject unvalidated input, never crash the daemon). Full rebuild of the daemon: the old `server.mjs` single-router monolith is replaced by modular services; only verified engine pieces (model-manager gates, workspace-manager, training-manager, replay-store, groups) are ported as-is into the new structure.

## What

Phase 1 delivers the daemon core every later phase plugs into:

- **HTTP server** (Node `node:http`, no framework — or a minimal router; decision: keep Node http + a tiny route registry, matching the current stack; add `ws` in Phase 4).
- **Route registry pattern**: each route = `{ method, path, schema, handler }`. All request bodies validated with `zod .strict().safeParse()` BEFORE the handler runs; invalid → 400 error envelope.
- **Error envelope** (from common/errors.ts): `{ ok: true, data }` | `{ ok: false, error: { code, message, detail? } }`. Handlers NEVER throw raw — they return codes.
- **Workspace service**: `list`, `read`, `write`, `stat`, `tree`, `mkdir`, `delete`, `search` — ALL with path containment (see How #2). Ports the verified workspace-manager logic.
- **Config service**: validates env + config file at startup (zod), fails fast with a clear message. Supports `AIDE_*` env vars (e.g. `AIDE_PYTHON`, `AIDE_WORKSPACE`, `AIDE_MODELS_DIR`).
- **Process manager**: spawn/execFile wrappers (NEVER exec), child registry, tree kill on Windows (`taskkill /PID x /T /F` fallback after graceful), used by later phases (model runtime, LSP, git, terminal, training).
- **Logging**: structured JSON lines to `logs/daemon.log` + console; request log (method, path, status, ms); error log with stack; rotation by size (keep last N MB).
- **Health**: `GET /api/health` → `{ ok: true, data: { version, uptime, workspace, freeMemoryMB } }` (the freeMemory check is the RAM doctrine from Phase 6 — expose it early).
- **Graceful shutdown**: SIGINT/SIGTERM → stop accepting → kill child processes (graceful-then-tree) → flush → exit 0. On Windows, `taskkill` children explicitly; never orphan.

## How

### 1. Route pattern (every route, no exceptions)

```ts
// common/contracts/file.ts
export const FileReadRequest = z.object({ path: z.string() }).strict();
export const FileReadResponse = z.object({ content: z.string().nullable(), tooLarge: z.boolean(), size: z.number() }).strict();
export type FileReadRequestT = z.infer<typeof FileReadRequest>;

// node/src/routes/file.ts
export const fileReadRoute: Route = {
  method: 'GET', path: '/api/file',
  schema: { query: FileReadRequest, response: FileReadResponse },
  handler: async (ctx) => { /* ctx.validated, ctx.workspace */ }
};
```

- `ctx.validated` is the parsed output of the schema — handlers never touch raw query/body.
- Response serialization: `FileReadResponse.parse(data)` before send — egress validation, fail closed on both directions.
- All routes return the envelope; the router wraps handlers so an unexpected throw becomes `{ ok:false, error:{ code:'INTERNAL', message } }` with a logged stack (no crash, no raw leak).

### 2. Path containment (workspace service — security-critical)

- Every user-supplied path is resolved INSIDE the workspace root: `const root = path.resolve(workspace); const target = path.resolve(root, rel); if (target !== root && !target.startsWith(root + path.sep)) throw FORBIDDEN`.
- Never use the raw string; never trust `../`. Test: attempt `../secret`, absolute path, drive-letter path, and `workspace\..\..` — all must be rejected.
- Symlink escape: optionally resolve realpath and re-check containment (Phase 7 git + extension installs are the risk surface; containment check mandatory there).
- Windows case-insensitivity: compare with `path.resolve` normalization AND lowercase the prefix check.

### 3. Process management (Windows reality, nodejs.org guidance)

- `spawn`/`execFile` with `{ shell: false }` ALWAYS (shell:true + user input = injection). Args as arrays, never interpolated strings.
- `execFile` for one-shot commands (git, python -c checks) with timeout + maxBuffer + captured stderr.
- `spawn` for long-running (model servers, LSP, training, terminal PTY).
- Child registry: `Map<id, { child, kind, startedAt }>`; every child gets a `stop(gracefulMs, forceAfterMs)` = send SIGTERM/kill → wait → `taskkill /PID <pid> /T /F` (Windows tree kill — kills grandchildren; plain kill on Windows leaves orphan trees).
- Daemon shutdown ALWAYS calls tree-kill on every registered child. Verified lesson: daemon restart took all llama python servers down — that was the tree kill working; the ORPHAN problem was daemons killed with `-Force` (never do that except as last resort, and then hunt `python -m llama_cpp.server` by command line afterward).
- Never spawn with `detached: true` unless the process must survive the daemon (it must NOT — children belong to the daemon's lifecycle).

### 4. Logging + errors

- One logging module; levels debug/info/warn/error; JSON lines `{ ts, level, msg, ...meta }`.
- Error codes live in `common/errors.ts` as a const union: `BAD_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `INTERNAL`, `NOT_READY`, `TIMEOUT`, `CHILD_FAILED`. Frontend switches on these codes (Phase 2) — they are part of the contract.
- Never log secrets (model paths fine; auth tokens never — there are none offline).

### 5. Startup + config

- `config.ts` validates: workspace root (exists? writable?), models dir, ports (default daemon 4777, UI 4173), `AIDE_PYTHON` override, log dir. Fail fast with a human message on first error.
- Port conflict doctrine (verified 2026-08-16): if the daemon's port is taken, check if it's OUR daemon (health endpoint responds) → reuse or exit with message; if foreign (no health), pick the next free port and LOG it loudly. Never silently squat.

## Why (research grounding)

- nodejs.org child_process docs: `shell: false` default is the injection barrier; spawn for streaming, execFile for one-shot with timeout.
- api-contract-testing.com: validate at the network edge, single source of truth, egress validation — the frontend can never receive a shape the contract didn't allow.
- VS Code engineering: privileged hosts do ALL file/process work; the renderer never touches fs — this backend IS the privileged host.
- Verified project lessons (2026-08-16): python discovery chain must respect `AIDE_PYTHON` → `py -3.10 -E` → `py -3 -E` → `E:\Python310\python.exe -E` (never bare `python` — MS Store stub); RAM doctrine: expose free memory early because `MapViewOfFile failed` killed model runs below ~2GB free.

## Dependencies

Node 20+ (ESM), zod (shared via common/), ws in Phase 4. All ported verified pieces: `daemon/workspace-manager.mjs` (search/replace logic incl. 20k occurrence cap, dotfile/node_modules skip), `daemon/training-manager.mjs`, `daemon/replay-store.mjs`, `daemon/groups.mjs` — ported, not rewritten.

## Known issues / bugs (watch these)

- **Windows tree kill**: plain `child.kill()` leaves grandchildren alive (llama python spawns no children, but git hooks and training scripts do). Always taskkill /T. Verify by PID scan after stop.
- **EADDRINUSE**: bind errors must run the port-conflict check, not crash with a raw stack.
- **Path separator bugs**: `path.sep` on Windows is `\`; containment checks that hardcode `/` fail. Use path.resolve everywhere.
- **Zod strict on query strings**: query params arrive as strings; coerce with `z.coerce.number()` etc. BEFORE strict parse, or valid requests get 400s.
- **Structured clone loss**: never pass BigInt/undefined through JSON; the envelope is JSON-only (undefined → omit key).
- **Request body size**: cap body reads (e.g. 20MB) → `PAYLOAD_TOO_LARGE`, or a giant POST will OOM the daemon. (File writes go through the file route with its own 1MiB gate per verified behavior — keep that gate semantics: `{ tooLarge:true, size }`.)
- **Backpressure**: stream file reads for large files; the current app relies on the 1MiB gate for the editor — keep it; Monaco handles the rest in Phase 3.
- **Graceful shutdown order**: children FIRST, then HTTP close, then flush logs, then exit. Reversed order = killed children get a half-dead HTTP layer.
- **Double-spawn protection**: model/LSP/training start routes must be idempotent per kind (reject CONFLICT if already running) — the warmup-gate race (Phase 6) depends on it.

## Phase 1 audit checklist (applied to the existing daemon)

1. Old `server.mjs` router decomposed into `routes/` + `services/`; every route validates with zod .strict() and returns the envelope.
2. Path containment enforced in every fs-touching route; escape tests exist and pass.
3. Error codes from common/errors.ts used consistently; no raw throw escapes to JSON.
4. Process manager with tree-kill exists and is USED by model/git/lsp/training; shutdown stops children first.
5. `/api/health` exposes freeMemoryMB; daemon logs to logs/daemon.log with rotation.
6. Port-conflict doctrine implemented; config validates at startup with fail-fast.
7. Ported pieces keep their verified behavior (search/replace cap, workspace search options, undo caps) — ported code must pass the SAME unit tests it passed before the move (test files move with the code).
8. `npm run check` green including new route tests.