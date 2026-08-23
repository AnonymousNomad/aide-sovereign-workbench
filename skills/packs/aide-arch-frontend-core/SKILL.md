---
name: aide-arch-frontend-core
description: Phase 2 SOP for the AIDE offline-first IDE rebuild — the browser-only frontend shell: app shell + view layout (LEARN/MAP/EXP/RUN), DI-light service layer, typed contract client (fetch + zod validation both directions), store/state pattern with subscriptions, offline-first rules, and the error-envelope UX. Use whenever building frontend services/state/views, wiring a new daemon call, or fixing "frontend shows nothing / fetch failed / state desync". Research-grounded (VS Code renderer architecture docs, Theia DI docs, api-contract-testing.com).
---

# AIDE Architecture — Phase 2: Frontend Core

## Doctrine

- **Browser-only.** The frontend runs in a sandboxed renderer — NO Node APIs (fs, child_process, path, os). Everything is a typed call to the daemon (the privileged host). This is the VS Code renderer rule and it is non-negotiable.
- Offline-first: zero remote fetches. All assets local. The ONLY network the app makes is to 127.0.0.1 daemon routes and (Phase 6) local model servers; online features are opt-in and go through explicit, user-confirmed channels.
- Contract first: the frontend NEVER parses an unvalidated response. Every API call validates with the same zod schema the daemon used (shared from common/).
- Verify before claiming: service unit tests run under node --test; the shell renders in the real browser (user check at http://127.0.0.1:4173) after every wiring change.
- Full rebuild: the app.js monolith (~1400 lines) is decomposed into modules; only verified behavior (find history, caret tracking, split persistence, hot-exit, windowed large-file UX — though Monaco takes over rendering in Phase 3) is ported as patterns, not copy-paste.

## What

Phase 2 delivers the application skeleton the views plug into:

- **App shell**: top-level layout (title bar, activity bar with LEARN/MAP/EXP/RUN, editor column, status bar) — this already exists in index.html; the rebuild keeps the visual shell and swaps the logic to modules.
- **Service layer (DI-light)**: plain module singletons with explicit `init()`/`dispose()` and a registry (Theia's DI is overkill for us; a `services.ts` registry + constructor injection pattern is enough — research verdict: DI containers buy testability; we get it cheaper with factory functions and explicit deps).
- **Contract client**: `api.ts` — one `call(path, body)` that fetches, validates the error envelope, validates `data` against the response schema, throws typed `ApiError { code, message, detail }`. Routes map: `api.file.read(path)`, `api.workspace.list()`, `api.chat.send(...)` etc. — every call is typed end-to-end.
- **Store/state**: small reactive store (no framework dependency; plain `Store<T>` with subscribe + immutable updates, or a tiny external lib if already in package.json). State kept in ONE place per concern (workspace tree, open tabs, model status, session) — the old app.js scattered state across DOM/globals is the anti-pattern this phase kills.
- **Error UX**: one toast/status mechanism that switches on `error.code` from the envelope; no raw "fetch failed" shown to users without translation (e.g. NOT_READY → "Model still warming up…").
- **Hot-exit/session**: port the saveSession/restoreSession contract (tabs, splits, cursor positions, windowed offsets) — the SHAPE is verified; it moves behind a `SessionStore` service with zod schema shared with daemon persistence.

## How

### 1. Module layout (browser/src)

```
browser/src/
  main.ts            # bootstrap: init services, mount shell, restore session
  shell/shell.ts     # layout, activity bar switching (LEARN/MAP/EXP/RUN)
  shell/views/       # learn.ts, blueprint.ts, exp.ts, run.ts (phase-specific panels)
  services/api.ts    # contract client (zod at edge)
  services/registry.ts
  services/session.ts
  services/workspace.ts  # tree/list/watch (poll or WS in Phase 4)
  services/models.ts     # model status/chat (Phase 6 wires the real calls)
  store/store.ts     # Store<T> + subscribe + derived
  store/state.ts     # app state shape
  ui/toast.ts        # error envelope → user message
```

### 2. Contract client (the one place that touches fetch)

```ts
// services/api.ts
export class ApiError extends Error { constructor(readonly code: string, readonly message: string, readonly detail?: unknown) { super(message); } }

export async function call<T>(path: string, opts: { query?: unknown; body?: unknown; schema: ZodType<T> }): Promise<T> {
  const res = await fetch(path, { method: opts.body !== undefined ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const env = Envelope.safeParse(await res.json());           // envelope validated first
  if (!env.success) throw new ApiError('BAD_RESPONSE', 'Invalid response envelope', env.error);
  if (!env.data.ok) throw new ApiError(env.data.error.code, env.data.error.message, env.data.error.detail);
  const parsed = opts.schema.safeParse(env.data.data);         // data validated against the SAME schema the daemon used
  if (!parsed.success) throw new ApiError('BAD_RESPONSE', 'Response does not match contract', parsed.error);
  return parsed.data;
}
```

- One fetch wrapper; every service uses it. No raw fetch anywhere else in browser code.
- In dev, the Vite proxy maps /api to the daemon (no CORS). In packaged mode (Phase 11), the daemon serves the built frontend on the same origin — never open CORS for LAN.

### 3. Store pattern

```ts
// store/store.ts — plain, framework-free, testable under node --test
export class Store<T> {
  private state: T;
  private subs = new Set<(s: T) => void>();
  constructor(init: T) { this.state = init; }
  get(): T { return this.state; }
  set(updater: (prev: T) => T): void { this.state = updater(this.state); this.subs.forEach(fn => fn(this.state)); }
  subscribe(fn: (s: T) => void): () => void { this.subs.add(fn); return () => this.subs.delete(fn); }
}
```

- Views subscribe, never mutate store state directly; mutations only via `set(updater)` with immutable updates.
- The activity-bar view switching must NOT scroll the page or break the editor column (verified Phase 2 lesson: overlays on the editor column, absolute positioning, no layout thrash) — keep the existing CSS strategy.

### 4. Session (hot-exit) contract

- Shape (verified in the old app — port it): tabs (uri, viewState, splitId), active tab, split layout, caret positions, windowed offsets (Monaco supersedes windowing in Phase 3; keep the session keys anyway for view-state restore).
- Flush on `pagehide` (not only beforeunload), restore on boot; daemon persists the session JSON (shared zod schema both sides).
- Keepalive: debounced writes (e.g. 500ms after change), not per-keystroke.

### 5. Tests

- Store, session serialization, error translation: pure logic → node --test.
- Contract client: mock fetch (node:test mock) with fixtures from tests/fixtures — the SAME fixtures the daemon route tests use (Phase 4 makes this the drift-proofing mechanism).

## Why (research grounding)

- VS Code engineering docs: renderer = browser process with zero Node access; all privileged ops via message passing to hosts. We mirror that with HTTP + (Phase 4) WS instead of Electron IPC because our daemon is a separate process by design (model servers, training, LSP can't live in a renderer anyway).
- Theia docs: frontend/backend DI both sides; we use the lighter registry/factory pattern — same testability, less machinery, fewer deps (offline-first means every dep is a liability).
- api-contract-testing.com: the client validates responses with the same schemas as the server — drift becomes a type error, not a runtime surprise.
- Plain Store: no framework lock-in; the interface is 20 lines; tests are trivial. VS Code itself uses plain event emitters, not a framework.

## Dependencies

TypeScript strict (Phase 0 gates), zod shared from common/, Vite dev proxy. Monaco in Phase 3. NO UI framework (vanilla TS + DOM), no router library (activity switching is state, not routes).

## Known issues / bugs (watch these)

- **CORS in dev**: vite.config.ts proxy must cover EVERY /api path including WebSocket upgrade (Phase 4). Symptoms: "fetch failed"/CORS errors in console while daemon logs show requests — proxy misconfig, not backend.
- **Zod strict + undefined**: JSON.stringify drops undefined; a schema field that's optional-but-present in TS can vanish on the wire. Use `.optional()` and explicit `null` in contracts (e.g. file content is `string | null`, never `string | undefined`).
- **Memory leaks**: subscribe handlers must be unsubscribed on view teardown (activity switch!). Old app.js leaked listeners across view switches — the store returns unsubscribe functions; use them.
- **pagehide vs beforeunload**: beforeunload does NOT fire reliably on mobile/browser kill; pagehide does. Keep the flush on pagehide.
- **Stale view state**: after restoreSession, ensure Monaco models (Phase 3) are recreated before views paint, or the editor flashes empty.
- **fetch 500s vs envelope**: the daemon may return plain 500 before its router wraps (startup errors). The client must treat non-JSON/non-envelope responses as BAD_RESPONSE and show the translated message, not crash the shell.
- **Offline-first slips**: audit for accidental `https://` fetches (fonts! CDN icons!) — enforce with a lint rule or a boot-time check that fails loudly in dev if any non-localhost fetch is attempted. Fonts/icons MUST be bundled.

## Phase 2 audit checklist (applied to the existing frontend)

1. app.js decomposed into browser/src modules (api, store, services, shell); no DOM-global state pattern remains.
2. Every daemon call goes through `call()` with a zod schema; zero raw fetch in views.
3. Store pattern in place; activity switching is state-driven with listener cleanup.
4. Session save/restore ported with shared schema; pagehide flush works.
5. Error translation: envelope codes → user messages (toast/status bar).
6. `npm run check` green; store/session/api tests pass; live UI check at 127.0.0.1:4173 after wiring.