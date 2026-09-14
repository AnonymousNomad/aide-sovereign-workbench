# Covert Coder — Phase-0 reconciliation report

Audit: 2026-09-12. Baseline: `536d08996d269d86aef997c5a514cd498c5686b8`. Actor: Codex. **Audit deliverables are ready for collaborator review. The product is not certified production-ready. No Phase-1 implementation occurred.**

## Executive finding

Do not authorize the handoff's new skill-router slice yet. The existing execution path has confirmed approval, skill-injection, transport and verification defects. Fix those in the existing components before adding orchestration sophistication. Preserve working subsystems and operator state.

Current narrow gates are green: **node and browser typechecks exit 0; 48/48 focused tests pass, zero failures/cancellations/skips; ESLint exit 0 with 65 warnings.** In the same checkout, isolated probes reproduce broken composed behavior. Green components are not proof of a green product.

| Confirmed finding | Current evidence |
|---|---|
| Direct-tool approval bypass | Real facade -> TS route -> tool writes fixture file despite top-level approved:false, with string argument approved:"false" |
| Silent skill-injection failure | Factory returns Promise; direct awaited loader selects marker; real buildRoutes/agent path omits marker from captured model input and emits no skill error |
| Browser/facade format mismatch | Actual browser API client accepts TS health directly, rejects facade health with BAD_RESPONSE / invalid response envelope |
| False code verification | Act task requests a file and tests; scripted completion supplies neither; verifier emits verified=true, score 1, sufficient evidence |
| Verification event dropped | Emitted verification shape rejected by AgentStreamEvent; EventHub contract-rejection log observed |
| Launch ownership split | npm start/root HTML and desktop staging select legacy app.js; Vite separately targets TS directly |
| Routing coverage gap | 204 registered TS operations; 173 map TS, 31 map legacy, including browser chat stream/history and workbenches |

Runtime evidence: [extended probe](evidence/runtime-probe-extended.json). Counts/event validation: [inventory](evidence/inventory.json). The capture substitutes the model response and uses an empty fixture model inventory. It proves the composed application behavior above, **not real model inference or GUI acceptance**.

## A. Current system topology

[SYSTEM_MAP.md](SYSTEM_MAP.md) traces launchers, ports, route ownership, frontend consumers, services, models, stores, events, CI and release paths. The two frontend protocols differ: legacy expects facade-normalized data; browser/src expects TS envelopes. `/api/orch/context` is a snapshot, not the canonical executor. The stateful agent loop is `node/src/services/agent-loop.mjs`.

## B. Canonical versus duplicate implementations

[DUPLICATION_MAP.md](DUPLICATION_MAP.md) assigns KEEP/MIGRATE/ADAPT/DEPRECATE/DELETE LATER dispositions. Existing legacy modules behind TS routes may be valid adapters. No subsystem was declared obsolete solely because it is old. No deletions occurred.

## C. Capability matrix

[CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md) covers the requested major subsystems and separates source, historical, current test and isolated-runtime evidence. Most product capabilities remain PARTIAL/SHADOW/UNKNOWN. LIVE labels are limited to observed scoped operations such as health and WebSocket transport, not whole-product promises.

## D. Most dangerous debt

Approval bypass R01 and false verification R05 are the highest-impact trust failures. Silent skill failure R02, event loss R06 and frontend transport mismatch R03 prevent truthful user-facing state. A launch-only cutover would add regressions because the typed frontend lacks several current legacy controls. Full details: [RISK_REGISTER.md](RISK_REGISTER.md).

Additional source concerns include the direct sandbox permission shortcut, best-effort audit persistence, the local expert advisory guard, staged-only default pre-push coverage, and stale evidence/documentation. They remain explicitly distinguished from fully reproduced failures.

## E. Preserve

Preserve typed contracts; actual TS services and facade; editor/session/LSP components; workspace containment; the session approval mechanism; local runtime/router abstractions; audit/cipher-state/memory/Helix modules; the 274 skills and all existing registry paths; historical tests/artifacts; required legacy adapters; and all four operator corpus scripts.

## F. Consolidate

One product edge with explicit compatibility; one stateful execution authority; one skill selection/injection implementation; one permission authority across execution entrypoints; consistent event/audit types; one evidence vocabulary that distinguishes execution, tests and acceptance. Reuse modules, not a new parallel orchestrator.

## G. Do not touch yet

No visual rewrite, repository rename, sigil/creed generation, model download, training, recommender redesign, multi-model role implementation, legacy deletion, shell replacement or mobile work. Covert Coder is the working name; Parrot and “Vinny” are excluded. Original sigil/creed development remains deferred. These product choices do not block core repair.

## H. Proposed Phase-1 changesets

**Recommend authorizing 1A first**, then review its evidence before 1B/1C. These are proposals only.

**1A — Execution integrity.** Correct the existing async skill factory declaration/await; make required-context failure observable. Make direct tools enforce the trusted boolean approval field, including sandbox paths, without trusting tool arguments. Preserve normal session approval. Separate execution success from code verification: unmet required tests/artifacts cannot yield verified. Align verification/context/audit event contracts and expose persistence failures. Do not build a new skill ranking API or reviewer role.

**1B — Canonical transport.** Retain TS envelopes for the canonical typed client through the facade using an explicit versioned request format (proposed `X-AIDE-API-Format: envelope-v1`). Preserve current bare responses for legacy callers. The header selects serialization only and grants no permissions. Add it to the shared browser client; move the workbench helper onto that boundary. Proxy Vite HTTP/WebSocket via 4777. Map the browser-used chat descendants/workbenches and selected introspection routes after parity checks; leave unrelated training/worktree defaults until verified. Test envelope/error/SSE/WS behavior without broad JSON-shape guessing.

**1C — Launch ownership.** Define explicit canonical and compatibility startup modes in the existing launcher. Serve only intended public assets, report boot failures, and clean up owned children. Do not promote the typed browser default until the developer journey parity gate passes. Missing agent/approval/terminal/Git/debug/model controls require bounded functional migration, not a visual redesign. [FRONTEND_ASSESSMENT.md](FRONTEND_ASSESSMENT.md) records the known migration packages; a precise functional migration patchset is a subsequent review deliverable, not implicitly authorized by this audit.

This gives an executable first repair slice without pretending that switching an HTML path finishes frontend consolidation.

## I. Tests and acceptance strategy

For 1A, promote the audit's negative cases into regressions: false/missing/string approvals and sandbox variants cannot mutate; required skills reach actual production-route model input; loader failure is observable; an unperformed requested code change cannot receive verified; valid verification events arrive through a subscribed facade WebSocket; event read filters accept emitted types; artifact write failure cannot masquerade as durable evidence. Use isolated workspaces and preserve denial/approval paths.

For 1B, call the real typed browser client through the real facade. Cover valid/error/malformed responses, all changed route families, streaming cancellation and WebSocket reconnect. Keep legacy-consumer shape tests. No route is “done” based on a direct 4778 test alone.

For 1C, use the actual launch command and a browser against a fixture project. Verify editor save/hot-exit, workspace/search/LSP, terminal run/interrupt, Git, debug where exposed, local model lifecycle and Resident approval/rejection. Assert request routing and durable state, not just a rendered button. Test occupied ports and child startup failure; verify owned-process exit.

Contract changes require regeneration (`npm run contracts`) after final route/schema edits, both typechecks, lint, affected tests and drift checks. Full `node scripts/run-arch.mjs` and `node scripts/acceptance-p0.mjs` belong to the repair acceptance window with safe resources. The latter remains scripted-provider integration evidence. Real local-model acceptance must independently record the model identity/hash/configuration, selected skills/context, exact approved tool calls, actual files, commands/exit codes, negative case, verification artifacts, event/audit correlation and cleanup.

The latest north-star numbered sequence places fuller role/device work before the final Phase-5 local-model workflow proof. That sequencing does not permit early false acceptance claims: label each intermediate evidence level honestly. A lower layer never substitutes for the final sovereign transaction.

## J. Exact expected files for the first repair slice

These are the bounded **1A proposal**, not files modified during this audit.

| File | Proposed change |
|---|---|
| `node/src/openapi.ts` | Await loader; wire explicit context status; pass trusted approval to tool dispatch |
| `node/src/services/skills-loader.d.mts` | Declare Promise-returning factory correctly |
| `node/src/services/skills-loader.mjs` | Distinguish no-match from failed required registry/read; preserve current scorer |
| `node/src/services/agent-loop.mjs` | Observable context/evidence failures; honest verification classification |
| `node/src/services/agent-loop.d.mts` | Corresponding typed provider/event/result interfaces |
| `node/src/routes/agent.ts` | Propagate trusted approval; deny unsafe direct mutation/sandbox shortcuts |
| `common/contracts/agent.ts` | Verification/context event definitions and explicit result state |
| `common/contracts/audit.ts` | Match emitted/queryable verification/context types |
| `node/src/services/audit-trail.mjs` | Matching event names and observable persistence outcome |
| `node/src/services/audit-trail.d.mts` | Matching typed audit result/interface |
| `tests/arch/agent-execution-integrity.test.ts` (new) | Real facade/route/skill/approval/false-verification regression |
| `tests/arch/closed-loop-mission.test.ts` | Reconcile existing verification expectations with actual required evidence |
| `tests/arch/audit-routes.test.ts` | Filter and persistence/error assertions |
| `tests/arch/events-contract.test.ts` | Real emitted shape coverage |
| `tests/arch/ws-events.test.ts` | Verification delivery through facade |
| `tests/arch/agent-routes.test.ts` | Direct mutation authorization boundaries |
| `common/openapi.json` | Generated after final contract edits |
| `AGENT_NOTES.md`, `docs/phase0/RISK_REGISTER.md`, new dated `docs/evidence/` result | Journal and evidence; no baseline erasure |

1B expected boundary: `scripts/facade.mjs`, `common/facade-route-map.json`, `browser/vite.config.ts`, `browser/src/services/api.ts`, `browser/src/workbenches/workbenches.ts`, `tests/unit/test-facade.mjs`, `tests/arch/api-client.test.ts`, new `tests/arch/browser-facade.test.ts`, `playwright.config.ts`. Update only browser caller files shown by transport tests to require it. No promise of a default-launch migration within 1B.

1C launcher boundary: `scripts/start.mjs`, `package.json`, `playwright.config.ts`, new `tests/e2e/canonical-launch.spec.ts`, `docs/ARCHITECTURE.md`. Functional parity gaps require their own exact file list after review; do not silently expand this boundary. Desktop staging is deferred.

## K. Rollback

Use small separately reviewable commits after authorization, on an isolated branch/worktree if appropriate. Retain legacy compatibility behavior and the current launch entry until parity. No state schema migration, model deletion or corpus mutation in 1A/1B. Snapshot only affected state with explicit provenance before any later migration. If acceptance fails, stop promotion; revert only the specific repair commit through a reviewed revert, never reset the user worktree or erase evidence. Do not roll back a known approval fix by silently re-enabling its vulnerable endpoint. No commits, staging, pushes or branch changes occurred in this audit.

## L. Human decisions

Immediate collaborator decision: approve 1A as bounded above, revise it, or request more evidence. Decide the proposed explicit facade compatibility format before 1B. Default frontend promotion requires the parity certificate and explicit decisions on intentionally retired controls; the evidence does not justify an immediate cutover.

Branding destination is now supplied by [COVERT_CODER_NORTH_STAR.md](../COVERT_CODER_NORTH_STAR.md). Final sigil/creed, shell and mobile choices are deferred and are not core blockers. Optional acquisition/provider policy is a future adapter decision; no cloud action is authorized by this report.

## Audit evidence and limits

- [gates.json](evidence/gates.json): both typechecks and 48 focused tests, exit 0.
- [verification-ledger.json](evidence/verification-ledger.json): lint, failed/deferred checks, historical baseline, process cleanup and mutation scope.
- [runtime-probe.json](evidence/runtime-probe.json): preserved first diagnostic, exit 1 at the 10s agent-start deadline. This is not a pass. Its successful health/envelope observations remain valid.
- [runtime-probe-isolated.json](evidence/runtime-probe-isolated.json): model inventory isolated, original three runtime observations reproduced.
- [runtime-probe-extended.json](evidence/runtime-probe-extended.json): added act false-verification and direct-tool approval probes, diagnostic exit 0, product defects remain.
- [inventory.json](evidence/inventory.json): route/registry/schema results.

Full architecture battery, production default-GUI acceptance, packaging, and real local-model coding acceptance were not rerun. Operator Python/model jobs remained active/changing; no operator process was terminated. Available memory varied from roughly 1.7 GiB at preflight to higher values between operator runs, which is not a stable test window. Process-hygiene guidance states “ONE MODEL AT A TIME” and warns against memory thrash. Bounded tests are the appropriate current audit evidence, not a release certificate.

Audit-owned probe/test PIDs were checked absent; probe listeners were closed and no LISTENING entries remained on their recorded ports. Temporary fixture directories were retained for inspection. No credentials were read, external services called, models downloaded, product sources changed, or user scripts staged. Audit diagnostics can run short synchronous rg/Python capability probes; the first raw report's `spawnedChildProcesses:false` was an overly broad diagnostic field, not an exhaustive child-process census. Later reports and the cleanup ledger clarify that scope.
