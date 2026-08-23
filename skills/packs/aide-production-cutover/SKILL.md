---
name: aide-production-cutover
description: SOP for wiring AIDE's new TS route stack (node/src/server.ts, all 110+ openapi routes) into production so `npm start` serves it — strangler-fig migration away from the legacy monolith daemon/server.mjs. Covers the verified two-server reality, route inventory reconciliation, facade routing, contract-test safety net, per-domain cutover phases with verification gates, rollback, and decommissioning. Use when starting the cutover work, when a shipped feature 404s in the real UI, when touching scripts/start.mjs or either server entrypoint, or before decommissioning any legacy module.
---

# Production Cutover — legacy daemon/server.mjs -> node/src/server.ts

## Verified reality (2026-08-24, this repo)
- TWO HTTP servers coexist: `daemon/server.mjs` (legacy monolith: model-manager, community, lsp/dap managers, training, academy/tutor, plugins, blueprint, replay, arena, operator, tasks, session, artifacts, providers, workflow, handoff — hand-rolled routes, its own 404 envelope `{error:'not found'}` at line ~478) and `node/src/server.ts` (ArchServer: ALL new-stack routes via openapi.ts buildRoutes — agent loop, index/RAG, modelhub, handoff TS routes, byok, git, editor, LSP/DAP TS, etc.; env AIDE_ARCH_PORT default 4778; standalone `main()` launchable via `node node/src/server.ts`).
- `scripts/start.mjs` spawns ONLY the legacy server on 4777 + serves UI on 4173. NOTHING in production launches the TS stack — every phase we shipped since the rebuild is invisible to `npm start` users. This is THE wiring gap.
- Stale-daemon trap: an old daemon process holding port 4777 makes fresh launches fail silently (new proc dies on EADDRINUSE, old one answers with 404s for new routes). ALWAYS check `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` + creation date before blaming code.
- Arch tests already prove the TS stack over real HTTP (`tests/arch/*.test.ts` use `ArchServer.listen(0)`).

## Research base (primary sources)
1. Fowler, Strangler Fig Application (martinfowler.com, 2004/2024): grow the new system around the old; event interception at seams; incremental displacement beats big-bang rewrite on risk.
2. Azure Architecture Center, Strangler Fig pattern: place a façade that routes per-request to legacy or modern; façade must not become SPOF/bottleneck; plan cross-system calls through an anti-corruption layer; remove transitional pieces only after validation.
3. AWS Prescriptive Guidance, Strangler fig: request-based routing by URL path is the standard mechanism; feature toggles give instant rollback.
4. CircleCI engineering blog (2025): consumer-driven CONTRACT TESTS are the migration safety net — both sides must satisfy the same interface expectations; parallel-run/shadow validation before traffic flips.
5. Cartwright/Horn/Lewis, Patterns of Legacy Displacement (martinfowler.com): parallel run, divert-the-flow, legacy mimic; transitional architecture is deliberate, quantified, and temporary.

## Strategy decision (locked)
Strangler-fig with a thin Node facade on the SINGLE user-facing port (4777), routing by path-prefix between two backends:
- Facade = small http server (scripts/facade.mjs) spawned by start.mjs; holds a static ROUTE_MAP { prefix -> 'ts' | 'legacy' }.
- New stack runs on internal port (4779), legacy on internal port (4780); neither exposed directly.
- Default ROUTE_MAP starts 100% legacy EXCEPT paths only the TS stack serves (agent/index/modelhub/byok/handoff-ts) — instant feature visibility with zero legacy regression.
- Cutover = flipping prefixes after that domain's parity gates pass; decommission = deleting the legacy branch from ROUTE_MAP then the module.

## Why this way
- Big-bang swap is forbidden by our own laws (Verify-First; no brick wall): legacy still owns domains the TS stack never reimplemented (community, academy, training arena, plugins, blueprint). Flipping everything at once breaks users of those features.
- Path-prefix facade is exactly the AWS/Azure request-based-routing pattern; contract tests are Fowler's recommended safety net and we ALREADY have the machinery (shared zod contracts + arch tests + drift check).
- Single exposed port preserves the user mental model and the In-the-Box law.

## Phase plan (each phase: build -> verify gate -> journal -> commit)
### Phase C0 — Route inventory (no code changes)
Enumerate exact route tables of BOTH servers into docs/evidence/route-inventory.md: legacy = grep path literals in daemon/server.mjs; TS = parse common/openapi.json routes[]. Produce three lists: ts-only, legacy-only, both.
GATE: counts reconcile against openapi.json route count and legacy handler count; journal records numbers.
### Phase C1 — Facade + dual-spawn
- scripts/facade.mjs: http server; per-request lookup longest-matching prefix in ROUTE_MAP; proxy (http.request, stream pipe both directions incl. SSE/WS upgrade handling — WS channels must be proxied with upgrade events, not just GET/POST); health endpoints `/api/health/ts` + `/api/health/legacy`; ROUTE_MAP loaded from `.aide/facade-routes.json` if present else built-in default.
- start.mjs spawns facade(4777) + ts(4779) + legacy(4780); kills tree on exit (reuse ProcessManager patterns from aide-arch-backend-core).
- Tests FIRST (tests/unit/test-facade.mjs, no network beyond 127.0.0.1 loopback fixtures): prefix routing table hits both backends; unknown path -> legacy (preserves old behavior); SSE stream passes through unbuffered; WS upgrade proxied; backend-down -> typed 502 envelope, never hang; ROUTE_MAP file override honored; kill-tree cleanup leaves zero orphan node procs.
GATE: unit green; manual `npm start` -> hit one ts-only route AND one legacy route through 4777; veritas PASS; CI green.
### Phase C2..Cn — Domain cutovers (one domain per phase, smallest first)
Order (risk-ascending): editor/files/git -> search/index -> agent+byok -> model runtime -> tasks/build -> hub -> THEN the hard tail (community, academy, training, plugins, blueprint) which may require PORTING instead of flipping (decide per domain when inventory shows legacy-only surface).
Per domain: (1) write contract tests asserting TS responses satisfy what the LEGACY frontend/consumers expect where shapes differ — anti-corruption adapter goes in facade OR TS route gains a compat alias route (prefer alias in TS, keep zod strict core + explicit legacy-shape mapper); (2) flip prefix; (3) parallel-run window: facade can shadow-compare responses (log-only diff mode) before enforcing; (4) verify: full gates + REAL UI walkthrough of that domain's features through 4777; (5) journal + commit.
GATE per domain: arch suite green, targeted e2e through facade green, live UI click-through recorded as evidence screenshot, veritas PASS, CI green.
### Phase CF — Decommission
When ROUTE_MAP has zero legacy entries AND Phase C0 inventory shows every legacy capability ported or consciously dropped (user sign-off): remove legacy spawn + modules, facade becomes plain reverse proxy or is deleted (TS binds 4777 directly), update README/GETTING_STARTED.
GATE: clean-install smoke per aide-packaging-offline battery; grep proves no imports of deleted modules remain.

## Code guidance (specifics)
- Proxy: NEVER buffer SSE — pipe streams; set `response.flushHeaders()`; handle client abort (`request.on('close')` -> destroy upstream socket) or chat streaming will hang.
- WS: facade must handle `'upgrade'` event explicitly; plain http.request does NOT proxy upgrades. Map ws path/channel to same backend rules; splice raw socket pair after manual handshake check.
- Timeouts: upstream connect timeout 5s, response idle timeout configurable (chat streams idle >60s legitimately? no — llama tokens flow; but long tool-calls may idle: set 300s idle, documented).
- Ports: internal ports must be env-overridable (AIDE_TS_PORT/AIDE_LEGACY_PORT) for tests to avoid collisions (port doctrine 4777/79/80).
- Windows: spawn with `{ stdio:['ignore','pipe','pipe'] }`, capture child stderr to .aide/logs/facade.log; kill via taskkill /pid /T /F fallback if tree-kill fails (ProcessManager precedent).
- Error envelope at facade level MUST match house shape ({error:{code,message}} vs legacy {error:'string'} — the anti-corruption mapping lives here; do not let two error shapes leak to the frontend randomly).

## Pitfalls / issues / bugs watch-list
1. EADDRINUSE silent death (verified today): always preflight port ownership; facade should detect "backend port busy at boot" and FAIL LOUD with the owning PID.
2. Double-serving during transition: a route existing on BOTH servers with different shapes = heisenbugs depending on ROUTE_MAP state. Rule: while a route exists on both, facade routes it to ONE side deterministically; log a warning at boot listing dual-served prefixes.
3. Cookie/session/state divergence: legacy stores under .aide/* files with its own schemas; TS services re-read some of the same dirs (.aide/byok, .aide/handoff). Inventory must include STATE files, not just routes — two writers to one JSON = corruption risk. Mitigation: per-domain cutover includes migrating state ownership; until then only one side may WRITE a given file (enforce in code review checklist).
4. WS channel union mismatch: events.ts ChannelName is strict zod; legacy emits its own event names. Frontend listeners written for legacy names will silently starve. Audit browser/src subscriptions vs each backend's emitted names BEFORE flipping any domain with live updates.
5. Long-running downloads/training jobs crossing a facade restart: job state must be recoverable from disk (modelhub manifest.json precedent) — never trust in-memory-only job maps across the cutover period.
6. CI: arch suite hangs locally (known OPEN ISSUE) — do not add facade integration tests to the arch chain until hang root-caused; keep them in unit layer with loopback fixtures.

## Threat matrix
| Threat | Vector | Control |
|---|---|---|
| SSRF-style probing via facade | crafted Host/path headers forwarded internally | facade fixes upstream Host header itself; strips Hop-by-hop headers (Connection, Keep-Alive, Transfer-Encoding, TE, Trailer, Upgrade except managed WS) |
| Path traversal into backend routing | encoded slashes, %2e tricks changing prefix match | normalize + decode ONCE in facade before prefix match; reject `..` segments; match on decoded canonical path |
| Port hijack on dev machines | malware binds 4779 | bind internal ports to 127.0.0.1 only (both backends already HOST=127.0.0.1 — verify, don't assume) |
| Secret leakage via proxy logs | Authorization headers hitting facade logs | facade logs method/path/status/duration ONLY; never headers/bodies |
| Rollback impossible after partial state migration | mixed writers corrupt .aide state | per-domain write-ownership rule (pitfall 3) + expand-contract style state moves |
| Facade SPOF | crash takes whole IDE down | facade is tiny + stateless; watchdog auto-restart w/ backoff; backends independent of facade lifecycle |

## Verification battery (per phase, non-negotiable)
1. tsc x2 + eslint clean.
2. Unit suite incl. new facade tests (loopback only, deterministic).
3. Full arch suite standalone-per-file locally (known hang caveat), CI arbitrates full chain.
4. Live: npm start from clean shell; curl matrix across ROUTE_MAP (one route per backend per domain); SSE chat stream observed token-by-token; WS event received through facade.
5. Real UI walkthrough of the flipped domain; evidence screenshot into docs/evidence/.
6. veritas PASS; push; CI green BEFORE claiming the phase done; AGENT_NOTES entry per developer-code-and-credo LOG step.
