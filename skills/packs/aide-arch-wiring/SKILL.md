---
name: aide-arch-wiring
description: Phase 4 SOP for the AIDE offline-first IDE rebuild — the contract layer between frontend and daemon: OpenAPI generated from zod schemas, shared fixtures consumed by BOTH sides' tests (drift-proofing), WebSocket/SSE event channel (logs, diagnostics, model status, training stream), Playwright e2e (auto-retrying assertions, isolated contexts, WS mocking), and the offline-first egress audit. Use whenever a new route/event is added, a contract test fails, frontend/backend disagree on shapes, or e2e flakiness is being debugged. Research-grounded (api-contract-testing.com, OpenAPI, Playwright docs, WebSocket spec).
---

# AIDE Architecture — Phase 4: Wiring (Contracts + Events + E2E)

## Doctrine

- **The contract is the law.** Every frontend/backend boundary: request/response schemas in `common/contracts/`, zod `.strict()` at BOTH edges (daemon validates in, client validates out), OpenAPI generated from the schemas, and contract tests on SHARED fixtures so drift fails CI, not users.
- **Offline-first, opt-in online**: the wire is 127.0.0.1 only. WS upgrade paths and egress are auditable; any remote endpoint requires an explicit opt-in flag persisted in config, shown in the UI.
- Verify before claiming: e2e suite green + live browser check before a phase is done.

## What

Phase 4 wires everything already built into one verified system:

- **OpenAPI doc**: `common/contracts/*.ts` → generated `openapi.json` via zod 4 NATIVE `z.toJSONSchema(schema, { target: 'openApi3' })` (see Known issues: zod-to-json-schema does NOT support zod 4 schemas). Serves as the human-readable spec AND the machine contract.
- **Contract tests**: for every route, a fixture (valid + invalid payloads, error cases) in `tests/fixtures/` consumed by: (a) daemon route tests (node --test + supertest-style against the real router), (b) frontend api client tests (node --test with fetch mock), (c) e2e assertions (Playwright, real browser + real daemon).
- **Event channel (WebSocket)**: `ws` on the daemon; typed events (channel + payload schema per event) — e.g. `model:status`, `log:line`, `diagnostics:publish`, `training:progress`, `file:changed` (external watcher, Phase 7). Frontend event bus subscribes per view; auto-reconnect with backoff; events are NEVER used for request/response (REST stays request/response — WS is one-way push only).
- **Playwright e2e**: real daemon + vite preview + real Monaco; user-visible flows: open file, edit, save, find, replace workspace, split, model chat, git commit (Phase 7), training start/stop (Phase 10).
- **Egress audit**: boot-time check in dev mode (and a lint rule) that flags any fetch not to 127.0.0.1; a `config.onlineFeatures` map with explicit opt-in keys.

## How

### 1. OpenAPI generation + drift test

- One script: `npm run contracts` = reads all schemas (tagged with `@route` metadata: method, path, response code) → emits `common/openapi.json` + TypeScript types are already z.infer (no codegen for types).
- Drift test: `node --test` runs `npm run contracts` into a temp file and fails if the committed `openapi.json` differs. Schema change without doc update = red test = caught.

### 2. Contract tests (the drift-proofing core)

```
tests/fixtures/file.ts     # e.g. readValid: {path:'src/a.ts'}, readTooLarge, readForbidden('..\x'), writeValid, replaceValid…
tests/contracts/file.test.ts   # runs the daemon router against every fixture, asserts envelope + schema
tests/browser/api.file.test.ts # runs the api client against mocked fetch returning the SAME fixture payloads
```

- Rule: a fixture added for the daemon MUST be added for the client in the same commit (the test that fails when this rule is broken: a grep/audit test over fixture keys — keep it simple: one shared `fixtures/index.ts` exporting both, so the client test file literally imports the same objects).
- Error-path fixtures mandatory (FORBIDDEN, NOT_FOUND, PAYLOAD_TOO_LARGE) — error envelope shape is part of the contract.

### 3. WS event channel

- Protocol: `ws://127.0.0.1:<daemonPort>/ws`; client sends `{ type:'subscribe', channels: [...] }`; server pushes `{ channel, ts, data }` where data validates against the channel's zod schema server-side before send (fail closed: invalid event payload = server bug, never sent).
- Channels (Phase-scoped): `model` (status/warmup transitions), `log` (daemon log tail for the RUN view), `diagnostics` (LSP publish → editor markers — this REPLACES the current poll/diagnostics-clear GETs where possible), `training` (progress/lines), `chat` (streaming tokens for chat, Phase 6 — SSE alternative: chat may prefer SSE for simplicity; decide per stream: WS for multi-channel daemon state, SSE for single long streams like chat/training logs. Either way the event SCHEMAS live in common/contracts/events.ts).
- Reconnect: exponential backoff (1s → 30s cap), resubscribe on reconnect, buffer nothing (state is re-fetched via REST on reconnect — WS is push, REST is truth).
- Frontend event bus: `subscribe(channel, handler)` returns unsubscribe; views MUST unsubscribe on teardown (leak rule from Phase 2).

### 4. Playwright e2e

- Config: `webServer` array starts daemon (`node node/src/server.ts` on 4778) + `vite preview` (built assets, 4173); `reuseExistingServer: true`; `use: { baseURL }`; workers: 1 + `test.describe.configure({ mode: 'serial' })` (daemon is stateful — parallel workers fight over the same workspace).
- Debugging swallowed errors: boot paths (e.g. session restore) catch silently — when a flow "does nothing", run a TEMPORARY debug spec that logs `console`, `pageerror`, `request`/`response` for `/api/` and re-fetches state from the page itself; the answer is in the request log (found: `path=%5Ce2e-scratch.txt` 403 → leading-backslash uriToRelPath bug). Delete the debug spec before pushing (it is type-checked by the node tsconfig).
- Assertions: auto-retrying (`expect(locator).toHaveText(...)`, `toBeVisible()`); avoid fixed sleeps; `page.waitForResponse('**/api/**')` for contract timing.
- WS in tests: `page.evaluate` to read the event bus state, or mock WS (`page.routeWebSocket`) for failure-path tests (reconnect, disconnect UX).
- Every e2e flow asserts the ENVELOPE too (a toast with an error code is an assertion target, not a flake).
- Offline e2e rule: `--offline` mode flag for the daemon that makes the egress audit FAIL any remote fetch during the run — the offline e2e suite runs with it on.

### 5. Egress audit

- `browser/src/services/egress.ts`: wraps fetch — allows same-origin + `127.0.0.1:*` only unless `config.onlineFeatures.<key> === true`. In dev, logs a loud warning for any denied egress (CDN font/icon slip = caught at first boot).
- Lint: ESLint `no-restricted-globals` on `fetch` outside api.ts/egress.ts (imports of api client are the only legal path).

## Why (research grounding)

- api-contract-testing.com: schemas at the runtime edge, single source of truth, contract tests against shared fixtures — this is the mechanism that makes "frontend/backend can never drift" a testable property instead of a hope.
- OpenAPI: the cross-language documentation + validation standard; generating it from zod means docs can't rot separately from code.
- Playwright docs: auto-retrying assertions and isolated contexts are the documented anti-flake design; WS mocking (`page.routeWebSocket`) is first-class for failure-path tests.
- WS vs SSE (WebSocket spec + practice): WS = bidirectional, multi-channel push; SSE = one-way server→client streams. Use the right tool per stream; unify SCHEMAS regardless of transport.
- Offline-first: egress audit is the enforcement mechanism for the user's core requirement (offline by default, online opt-in).

## Dependencies

`ws` (daemon), zod ^4 (shared), Playwright (dev only — chromium cached in `%LOCALAPPDATA%\ms-playwright`, install once, never re-download per run), vite preview (e2e target; preview AND server must proxy `/ws` with `ws: true`). Node 26 on this machine: node-side TS must be `erasableSyntaxOnly` (no parameter properties). `npm run check:arch` uses `--test-concurrency=3` (see Known issues: Node 26 parser flake under parallel load).

## Threat matrix

| Threat | Impact | Mitigation |
|---|---|---|
| Frontend/backend schema drift | silent data corruption, 500s in prod | zod `.strict()` at both edges + shared fixtures in `tests/fixtures/index.ts` imported by BOTH sides' tests + openapi drift test (`scripts/contracts.mjs` regen vs committed `common/openapi.json`) |
| API client calls wrong route/method | feature silently dead (save never lands) | mock-based client test MUST assert `seen[0].method` AND `seen[0].url` for EVERY api method (real bug hit: `fileWrite` posted to `/api/file` instead of `/api/file/write`) |
| URI→relPath mangles Windows paths | 403 containment, restore fails, session wiped | `file:///x` → strip scheme then ONE leading `/`, THEN map `/`→`\`; regression-tested in e2e session-restore |
| Failed restore wipes saved session | user data loss (silent) | per-tab try/catch in `restoreSession` (one bad tab ≠ dead restore) + only `session.set()` when `openPaths().length > 0` |
| Opaque view overlay intercepts editor clicks | UI unclickable (split/search buttons) | `editor` activity with NO overlay as default; re-clicking an active activity toggles back to editor. NOTE: Playwright `toBeVisible()` passes for elements BEHIND opaque overlays (visibility ≠ hit-testability) — real clicks expose it |
| CI-only failure (Windows vs Linux) | red CI, green local | path-escape tests must use PORTABLE separators (`../../etc/passwd`), never backslashes; before push, run `npm run check` AND `node scripts/ci-run-all.mjs` AND the e2e suite |
| Unverified push to GitHub | silent CI breakage on the protected branch | after EVERY push: `git rev-parse HEAD` vs `git ls-remote origin main` MUST match, then poll Actions runs API until our SHA's run concludes `success` (see how-to: no gh CLI — `git credential fill` → `password` = PAT → `Authorization: Bearer` for runs/jobs/logs endpoints; anonymous = 403) |
| WS event payload rot | fail-closed server errors | event send-sites parse against the channel's zod schema before emit; one fixture per event covered by tests |
| Reconnect stampede on daemon restart | boot connection storm | exponential backoff 1s→30s + jitter; resubscribe after reconnect; state re-fetched via REST (WS = push only, REST = truth) |
| Browser-side fetch to the internet | breaks offline-first | `egress.ts` wrapper (same-origin + 127.0.0.1 only) + ESLint `no-restricted-globals` banning raw `fetch` outside api.ts/egress.ts |
| Over-parallelized node --test | Node 26 TS parser crash (`ERR_INTERNAL_ASSERTION: unreachable` in parseTypeScript, especially under AV) | `--test-concurrency=3`; if the parser crash returns, lower it or add `--test-force-exit` only as a stopgap |
| Port contention between suites | EADDRINUSE flakes (editor-smoke vs manually-started preview) | never run dev servers alongside `ci-run-all`/e2e; Playwright `reuseExistingServer: true` but prefer killing stray 4173/4778 listeners first |

## Known issues / bugs (watch these)

- **zod-to-json-schema REMOVED**: 3.25.2 declares zod ^4 only as a PEER; its README (line 386) states zod 4 schemas are NOT supported. zod-openapi is unusable with zod 4. VERIFIED WORKING: zod 4 native `z.toJSONSchema(schema, { target: 'openApi3' })` — the OpenAPI emitter (`node/src/openapi.ts`) uses it; regenerated via `npm run contracts`.
- **SessionStore is DISK-based** (load()/save() read/write `session.json` per call — no in-memory cache): e2e `beforeEach` deleting `.aide/session.json` IS sufficient to reset state; no daemon restart needed.
- **Status bar contract**: health text (`daemon <version>`) is overwritten by the first onTabChange (`ready` when no tabs) — e2e assertions must match `/daemon|ready/`, not exact text.
- **E2E overlay dance**: file-list clicks need the MAP activity first; tab assertions use the tab's BASENAME as text; title is `AIDE — <workspace>`.
- **Drift test false positives**: OpenAPI emitter ordering (sort schemas/keys) — nondeterministic output causes red tests with no real change. Sort all emitted keys.
- **Zod strict vs OpenAPI optionality**: `.optional()` fields must map to OpenAPI `nullable/optional` correctly or the doc lies — drift test + fixture with `undefined` field catches it.
- **WS message size**: giant log lines (training dumps) — chunk server-side or cap per-event (e.g. 256KB) with a `truncated` flag; don't blow the browser's WS buffer.
- **Reconnect storms**: on daemon restart, EVERY view resubscribes at once — jitter the backoff (`+ random(0,1s)`) or the daemon gets a connection stampede on boot.
- **E2E state bleed**: tabs/open files persist in the daemon session across test runs — e2e resets by deleting `.aide/session.json` + scratch files in `beforeEach` (disk-based store makes this sufficient).
- **Vite preview + WS proxy**: preview server must proxy WS upgrades too, or e2e against `vite preview` loses the event channel — configured: `server.proxy` AND `preview.proxy` both with `/ws` → `ws: true`.
- **Playwright browser download**: offline machine — `npx playwright install` once, cache kept; e2e must never run an install implicitly.
- **Event schema rot**: an event schema changed in common/ but the daemon's send-site wasn't updated — the send-site parse (fail closed) makes this a loud server error, good; make sure the test suite covers each event once with a fixture.
- **DAP timing**: `dap-manager.request(id, request, timeoutMs = 15000)` — the DAP fixture passes 60s via an `ask()` helper; 15s can flake under load on this machine.
- **CI log access**: Actions logs API is 403 anonymous and there is no `gh` CLI — use the stored credential (`"protocol=https\nhost=github.com\n\n" | git credential fill` → `password=` line) as `Authorization: Bearer` for runs/jobs/logs endpoints. NEVER print the token.
- **Playwright click actionability**: an element behind an opaque overlay reports `visible, enabled and stable` but clicks retry until timeout ("intercepts pointer events") — when a click times out with a healthy-looking log, look for an overlay in the error context snapshot before touching the selector.
- **ws.ts setStatus transition-only bug (FIXED 2026-08-19)**: onStatus was only called on `connected` TRANSITIONS and the initial value is `false` — a socket that never opens (dead daemon from boot) fires close events without any transition, so the UI was never told (status dot stayed green after health overwrote it). Rule: notify on EVERY open/close event; the UI decides, backoff gaps make spamming impossible. The failure-path e2e (routeWebSocket close × 2, then connectToServer) is what caught it.
- **Playwright 1.62.1 routeWebSocket facts (verified)**: WebSocketRoute has NO `accept()`; `close()` called before the connection is fully routed is a silent no-op (page socket stays open); `page.unroute()` does NOT remove WebSocket routes (matches continued after unroute — appears to be a 1.62 regression/limitation; there is no unrouteWebSocket). WORKING PATTERN for failure-path tests: one handler, counter-based — close() the first N connections, then `ws.connectToServer()` for the rest — tests repeated-failure recovery deterministically without any unroute.
- **Test fixture key discipline**: loop-driven contract tests must use uniform fixture keys (`.ok`/`.invalid` for every channel). A missing key silently publishes `undefined`, which the fail-closed send-site drops — the "invalid" tests pass trivially and the valid tests fail with `0 !== 1` and no obvious cause. Validate fixtures against their schemas FIRST (standalone script) before blaming the server.
- **Egress audit (scripts/egress-audit.mjs, wired into the aggregate `test` chain)**: scans browser/dist for literal remote `fetch(`/`WebSocket(`/`EventSource(` call-sites and `ws://`/`wss://` strings (FAIL = real network paths); non-localhost URL STRINGS are INFO only — monaco embeds doc/license links (github.com, json-schema.org, unicode.org, aka.ms...) as data, not fetches. Requires a build first (`npm run build:frontend` precedes it in the chain; ci-run-all now has 39 commands).

## Phase 4 audit checklist (applied to the existing wiring)

1. `npm run contracts` emits openapi.json; drift test green; every existing route is in the doc with strict schemas.
2. Fixtures exist for all routes incl. error paths; daemon route tests and browser api client tests import the SAME fixtures.
3. WS channel live: model status + log tail reach the UI; reconnect with jitter works; views unsubscribe on teardown.
4. Playwright suite green: open/edit/save/find/replace-workspace/split flows, offline-mode suite with egress audit ON.
5. Egress audit in place; zero non-localhost fetches in the built bundle (grep dist/ for http:// and https:// — only localhost allowed).
6. `npm run check` (incl. contracts drift + e2e smoke) green.