# Phase 1B canonical transport report

Date: 2026-09-12 05:38 +05:45
Phase 1A boundary: `61e5edc8d0250016deac6295d3f41000503136d8` (pushed and remote-verified)
Scope: Phase 1B only. Phase 1C remains unauthorized.

## Outcome

The typed browser now uses the explicit `X-AIDE-API-Format: envelope-v1` contract through facade port 4777. Vite development and preview HTTP/WebSocket proxies target 4777. Legacy callers without the header retain the facade's bare response representation. Chat streaming and workbench actions now use the shared typed API client. No default-launch, legacy removal, UI redesign, role orchestration, model acquisition, or model-training code changed.

## Protocol behavior

- Header absent: preserve legacy-compatible bare TS response adaptation.
- Header exactly `envelope-v1`: preserve the typed backend success/error envelope.
- Unsupported value: deterministic HTTP 400 `BAD_REQUEST` envelope.
- Typed format requested for a legacy-owned route: deterministic HTTP 400; no reroute or backend hit.
- The facade strips the internal format header before forwarding upstream.
- The header affects serialization only and grants no permission or authorization state.
- JSON normalization does not buffer SSE. Client abort closes the upstream request.
- WebSocket bytes remain proxied through the existing `/ws` upgrade owner.

## Route ownership changes

| Route | Previous owner through facade | Phase 1B owner | Typed caller | Proof |
|---|---|---|---|---|
| `/api/chat` | TS exact route | TS prefix (exact entry retained) | shared `api.chat` | facade and model-route suites |
| `/api/chat/history` | legacy fallback | TS | shared `api.chatHistory` | affected route suite and Playwright chat cases |
| `/api/chat/stream` | legacy fallback | TS | shared `api.chatStream` | incremental/error/abort composed test |
| `/api/workbenches` | legacy fallback | TS | shared `api.workbenches` | client-contract and workbench-route tests |
| `/api/workbenches/install` | legacy fallback | TS | shared `api.workbenchInstall` | client-contract and workbench-route tests |
| `/api/workbenches/trust` | legacy fallback | TS | shared `api.workbenchTrust` | client-contract and workbench-route tests |
| `/api/workbenches/uninstall` | legacy fallback | TS | shared `api.workbenchUninstall` | client-contract and workbench-route tests |
| `/ws` | TS upgrade owner, but Vite bypassed facade | TS through facade | `connectEvents` | meaningful event delivery and reconnect tests |

No remaining legacy route family was bulk-mapped.

## Files in the Phase 1B boundary

Production/config:

- `scripts/facade.mjs`
- `common/facade-route-map.json`
- `browser/vite.config.ts`
- `browser/src/services/api.ts`
- `browser/src/chat/chat.ts` (additional caller justified by its direct streaming fetch)
- `browser/src/workbenches/workbenches.ts`
- `playwright.config.ts`

Tests:

- `tests/unit/test-facade.mjs`
- `tests/arch/api-client.test.ts`
- `tests/arch/browser-facade.test.ts`

Evidence/journal:

- `docs/evidence/phase1b-*.json`
- `docs/evidence/phase1b-run.mjs`
- `docs/evidence/phase1b-canonical-transport-skill.md`
- this report and the Phase 1B journal entry

## Evidence by level

| Level | Result | Evidence |
|---|---|---|
| STATIC | PASS: facade syntax exit 0; `git diff --check` has no errors | `phase1b-static-facade.json` |
| TYPECHECK | PASS: node and browser TypeScript exit 0 | `phase1b-typecheck-node-final.json`, `phase1b-typecheck-browser-final.json` |
| UNIT | PASS: facade compatibility plus shared typed-client regressions included in 43/43 | `phase1b-regression-final-2.json` |
| INTEGRATION | PASS: composed browser-client/facade/fixture, SSE and real EventHub/WebSocket; affected routes/contracts 29/29 | `phase1b-regression-final-2.json`, `phase1b-affected-suite.json` |
| RUNTIME | PASS: typed frontend production build; real Edge browser transport selection 8/8 | `phase1b-build-frontend.json`, `phase1b-playwright-transport.json` |
| ACCEPTANCE | PASS for Phase 1B transport: Playwright 8/8 and hermetic `acceptance-p0` full restack exit 0 | `phase1b-playwright-transport.json`, `phase1b-acceptance-p0.json` |

Counts overlap across composed runs and must not be summed.

Regression progression: pre-repair 33/42 pass and 9 fail; first post-repair 41/42; corrected contract-valid WebSocket fixture 42/42; final workbench coverage 43/43. The rejected EventHub fixture and all other encountered failures are retained in the evidence skill and JSON files.

## Warnings, failures, and deferred gates

- Lint: exit 0, 0 errors and the established 65 warnings. No warning cleanup was authorized.
- Full 17-case Playwright UI run is not green: package-managed Chromium was absent (1 startup failure, 16 did not run); local Edge then passed 3 cases before the unrelated workspace-search case exceeded its 15-second locator deadline, leaving 13 cases unrun. A clean trace proves `/api/search` left the browser with `envelope-v1` and remained pending. The existing search handler measured 11.141 seconds alone under current load (654 matches, 87 files). Search implementation and performance are outside Phase 1B; no timeout or assertion was weakened.
- Full 438-test architecture battery: DEFERRED. It contains resource-heavy model lifecycle work and could interfere with the independent local-model workload. Phase 1A's latest full result remains 438/438, but it is not claimed as current Phase 1B evidence.
- Real local-model coding acceptance: NOT RUN and not claimed. Scripted-provider acceptance remains integration evidence.
- Frontend default-launch cutover remains undone by design; `scripts/start.mjs` still launches the legacy root UI.

## Process hygiene

Every Phase 1B test-owned Playwright, Vite, facade, and TS-backend process exited. Ports 4173, 4777, and 4778 had no listeners after the gates. The independent supervisor/generator/llama-server process tree was not terminated or modified.

## Proposed commit boundary and rollback

One Phase 1B commit should contain only the production/config, tests, evidence, and Phase 1B journal hunk listed above. Explicitly exclude the four operator/training scripts, `docs/phase0/`, `docs/COVERT_CODER_NORTH_STAR.md`, and the existing Phase 0 journal hunk.

After commit, rollback is one `git revert <phase-1b-commit>` operation. That restores Vite's direct 4778 development path and the prior facade representation behavior without deleting user state. The latest user direction requires pushing each completed update, so the verified Phase 1B commit will be pushed after scoped staging and local hook verification.

## Stop boundary

Phase 1B ends here. Phase 1C, default frontend cutover, visual redesign, Planner/Coder/Reviewer, TwinMind, recommender, Ghost, mobile, and unrelated cleanup remain unauthorized.
