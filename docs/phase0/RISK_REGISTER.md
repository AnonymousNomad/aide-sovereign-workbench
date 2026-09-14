# Phase 0 — risk register

Baseline `536d089`. P0–P5 refer to the collaborator's priority hierarchy; implementation Phase 1 begins only after review. Confirmed findings stay open until repaired and verified. Diagnostic success is not a product pass.

| ID | Priority/severity | Evidence and consequence | Required treatment |
|---|---|---|---|
| R01 | P0 critical | `/api/agent/tool` ignores top-level approved when constructing dispatch opts; dispatch trusts truthy `arguments.approved`. Fixture request with top-level false and string "false" wrote a file through the facade. `routes/agent.ts:155`, `openapi.ts:682`. | Enforce trusted strict boolean approval, reject model-supplied claims; test false/missing/string/sandbox variants and writes/commands. No need to execute a shell exploit. |
| R02 | P0 high | `createSkillsLoader` async factory is declared synchronous and called without await. Runtime skill sentinel absent; exception swallowed; session reports done. | Fix factory type/composition and expose required-context failure. Regression must capture production-route model input. |
| R03 | P0 high | Typed browser requires envelope; facade removes it and rewrites errors. Actual browser client fails health through facade with BAD_RESPONSE. | Explicit canonical wire format + compatibility adapter; test errors, SSE, WebSocket and all current browser consumers. |
| R04 | P0 high | Default startup and desktop staging still select root legacy UI. TS browser lacks agent controls and development-surface parity. | Canonical launch only after parity gate; do not silently remove working terminal/Git/debug/approval workflows. |
| R05 | P0 high | Completion-only act request gets `verified`, score 1, sufficient evidence, although requested file is absent and no tests ran. `agent-loop.mjs:540`. | Separate execution completion from requirement verification; missing mandated tests => unverified/needs-evidence, never verified. |
| R06 | P0 high | EventHub rejects emitted verification payload; AgentStreamEvent lacks discriminator. Fixture log confirms rejection. | Extend typed event contract and assert delivery through facade to real WS client; keep negative validation. |
| R07 | P0 high | 31 TS operations select legacy; chat streaming/history and workbenches are used by TS browser. | Explicit consumer-based map repairs; no blanket default flip, no wholesale deletion. |
| R08 | P0/P1 high | Required context/audit/trajectory errors are often swallowed; terminal state can precede durable artifacts. | Define observable degraded/failed states and durable evidence acknowledgement; scope initial repair to coding path. |
| R09 | P1 high | Acceptance-p0 uses scripted provider; real-model harness scores parse && Veritas while awaiting approval. Neither proves correct code from the canonical local agent. | Real offline transaction with file assertions, approved tool execution, independent tests, skills/model/audit identity. |
| R10 | P0 operational | Initial ~1.7 GiB available RAM, active operator Python/model jobs; first probe using real inventory exceeded 10s startup observation window. | Preserve failed evidence; isolate unrelated inventory for skill diagnostics; reserve full/model battery for suitable resource window. No operator termination. |
| R11 | P0 medium | Agent expertAdvisory guard requires chatFnOverride, normally populated only for provider source despite comment describing local behavior. | Targeted local vs provider regression before claiming advisory reaches sovereign loop; no new routing subsystem. |
| R12 | P1 medium | Direct tool sandbox bypass is distinct from governed session policy; direct dispatch omits loop audit/checkpoint lifecycle. | Include in R01 repair boundary; sandbox does not itself grant shell/network privileges. |
| R13 | P4 high | Default pre-push checks staged files, typically empty after commit; full battery opt-in. | Later gate commit range actually being pushed; mutation/negative gate demonstration. Hook path itself is valid junction. |
| R14 | P3 medium/deferred | Recommender uses fixed model IDs/total RAM and infers Vulkan from VRAM. | Retain as provisional; replace with measured compatibility policy in P3, not a Phase-1 blocker. |
| R15 | P4 medium | Memory digest starts cascade before awaiting fresh day digest; audit/situation egress paths differ. | Test freshness and classify provenance; consolidate ownership without new store. |
| R16 | P5 high/deferred | Desktop copied legacy frontend; desktop Node 22 vs main CI Node 26; lifecycle/current install evidence absent. | Packaging acceptance on selected shell after core is proven. |
| R17 | P0 medium | Root static server serves repository-root files subject to path containment, without a public-asset allowlist. | Canonical startup should serve built public assets; test denial of private paths using synthetic files only. No secret content probe performed. |
| R18 | P0 medium | Detached startup children and some best-effort shutdown paths complicate cleanup; initializers may launch short capability probes. | Track ownership/exit, fail clearly on occupied ports, prove sibling exit after launch failure. |
| R19 | P0 evidence quality | Historical architecture counts/routing, bounded-runner skill reference and handoff ownership statements drifted. | Treat new inventory as dated evidence; preserve history, cross-link corrections. |

R01/R02/R03/R05/R06 have current isolated execution evidence. R04/R07 are source/registered-routing facts. Other rows are scoped source concerns or deferred verification requirements, not claims of successful exploitation or universal failure.

Raw evidence: [extended probe](evidence/runtime-probe-extended.json), [inventory/schema check](evidence/inventory.json), [first timed-out probe](evidence/runtime-probe.json), [focused gates](evidence/gates.json). No product fixes were made.

## Phase-1A update - 2026-09-12

The preceding table is the preserved Phase-0 baseline. The authorized execution-integrity repair is ready for collaborator review; Phase 1B/1C remain unauthorized.

- R01/R12: repaired agent direct/sandbox authority handling. Payload/model approval cannot authorize direct mutation; trusted pending-session approval still works. Negative regressions assert absence of unauthorized files/directories. Not a blanket security claim about every application endpoint.
- R02: awaited async skill factory, corrected declaration and observable loader/context failures. Production-route model-request sentinel proved actual injection; ranking unchanged.
- R05: false positive verification removed. Execution is separate from incomplete/unavailable/failed/errored verification. No positive requirement-bound verifier added; that remains an open capability.
- R06: strict producer/event contracts aligned; real verification event reaches a subscribed facade WebSocket. Hub acceptance, subscriber observation and persistence remain separate claims.
- R08: scoped agent evidence and required audit writes expose failure; terminal state awaits persistence/callback completion. Shared bus remains nonthrowing best-effort with explicit results. Other consumers and power-loss durability are not universally certified.
- R03/R04/R07: unchanged; frontend/transport/canonical launch work remains unauthorized. R09 remains open: scripted-provider acceptance is not real local-model coding acceptance. Unlisted risks retain their earlier scope/status.
- R10: user authorized stopping competing jobs; exact generator/model identities were stopped and verified. After resume, operator generation is running under a supervisor and was preserved. No corpus/script/model edits. See process-control/final-cleanup records.
- Evidence: affected 60/60; tier 4/4; full architecture 438/438, zero fail/cancel/skip; node/browser typechecks exit 0; lint 0 errors/65 warnings; contracts generated + drift 2/2; acceptance-p0 exit 0 (scripted integration). First full run's 4 failures/1 skip and manual cleanup retained; environmental fixes verified by focused 16/16 and full rerun. Six late fixture logger warnings remain outside scope.

Full changeset, limits, rollback and evidence: [Phase-1A report](../evidence/2026-09-12-phase1a-report.md), [JSON ledger](../evidence/phase1a-ledger.json).
