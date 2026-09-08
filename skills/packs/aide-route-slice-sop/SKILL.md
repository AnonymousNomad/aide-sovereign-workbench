---
name: aide-route-slice-sop
description: Mandatory checklist for adding ANY new TS route family to AIDE end-to-end — contracts, service, routes, openapi wiring, facade map, restart order, live verification through :4777. Encodes every repeated failure (facade cache 404 x2, openapi drift x2, verb mismatch, require-depth MODULE_NOT_FOUND, workdir drift) so none is guessed again. Triggered by the twice-fail law — use at the start of every route slice, not after it breaks.
---

# Route Slice SOP — adding a route family without guessing

## The Twice-Fail Law (operator directive, binds all terminals)

Any step that fails TWICE → STOP. Research the actual mechanism, then encode
the fix here or in the matching skill BEFORE retrying. Never attempt attempt
#3 from memory.

## The Ordered Checklist (violations found in real incidents marked ⚠)

Execute IN ORDER. Each step gated before the next.

```
1. CONTRACT FIRST      common/contracts/<family>.ts — zod strict schemas for
                       request/response/status. Reuse shared sub-schemas via
                       import; NEVER re-declare them inline (⚠ incident: inline
                       roots .min(2) landed on the array instead of strings —
                       two different schemas for one concept).
2. SERVICE             node/src/services/<family>.mjs (plain ESM if harness-
                       adjacent; TS otherwise). Deny-by-default guards first,
                       happy path second. Evidence/training capture is
                       best-effort try/catch — never blocks the action.
3. ROUTES              node/src/routes/<family>.ts — body/response reference the
                       CONTRACT schemas by import. Handler returns EXACTLY the
                       declared response shape (⚠ incident: raw manifest returned
                       where status shape was declared -> INTERNAL).
   3a. require() depth: from node/src/routes/*.ts -> '../../../harness/x.mjs';
       from node/src/openapi.ts -> './services/x.mjs'. (⚠ incident:
       MODULE_NOT_FOUND from copying a depth across directories.)
4. WIRING              node/src/openapi.ts: import + spread INSIDE the core
                       array. If two families share state, create ONE service
                       instance above the array and close over it (⚠ incident:
                       two desktop instances = split-brain grants).
5. REGENERATE CONTRACTS  npm run contracts — MUST BE THE LAST STEP before any
                       commit touching routes or contracts. Not "before commit"
                       in spirit — literally last edit. (⚠ incidents x2: edits
                       after regen -> CI arch-drift failure.)
6. GATES (&&-chained!) npx tsc -p tsconfig.node.json --noEmit &&
                       npx tsc -p browser/tsconfig.browser.json --noEmit &&
                       npx eslint .
                       NEVER separate with ';' — a failing tsc must stop the
                       chain. (⚠ incident: ';'-chain pushed red.)
7. FACADE MAP          common/facade-route-map.json += "/api/<fam>": "ts".
8. RESTART FACADE      The facade CACHES the route map at startup (loadRouteMap
                       in main()). Editing the map without restarting the
                       facade yields "not found" for the NEW family only.
                       (⚠ incidents x2: /api/memory, /api/experts.)
9. RESTART ARCH        If service/route code changed: kill PID on 4778, spawn
                       detached with AIDE_ARCH_PORT env, wait for LISTEN.
10. LIVE VERIFY        Real request through :4777 (not direct to 4778) — proves
                       map + unwrap + handler together. Assert the RESPONSE
                       BODY content, not just HTTP 200.
11. BATTERY            scripts/<family>-battery.mjs with REAL probes (state
                       assertions, adversarial inputs). Wire into package.json
                       test chain. Windows-only probes get a win32 guard.
12. JOURNAL + COMMIT   AGENT_NOTES entry + push. Commit message lists gates
                       actually observed, not assumed.
```

## Restart matrix (which process owns which change)

| Changed | Restart |
|---|---|
| frontend app.js/index.html/styles.css | browser refresh only |
| common/facade-route-map.json | FACADE |
| common/contracts/* or node/src/** | ARCH daemon (+ facade if map changed) |
| harness/*.mjs consumed by arch | ARCH daemon |
| daemon/server.mjs (legacy) | LEGACY daemon |

## Pitfalls catalog (all incurred once — do not incur twice)

| Pitfall | Signature | Prevention |
|---|---|---|
| Facade map cached | New family 404s via :4777 but works via :4778 | Step 8 mandatory |
| OpenAPI drift | CI arch gate fails `openapi-drift.test.ts` | Step 5 literally-last |
| Verb mismatch | Client PUT where route declares POST -> BAD_REQUEST | Step 3: copy method from contract tests |
| Response-shape mismatch | "response violates the contract" INTERNAL | Step 3: return status()-normalized data |
| require depth | ERR_MODULE_NOT_FOUND at boot | Step 3a depth table |
| Split-brain services | Two instances, grants/state disagree | Step 4 single instance |
| Workdir drift | Tool runs from E:\ instead of repo | Pin workdir param EVERY call |
| ';'-chains | Later commands run after earlier failure | Step 6 &&-only |
| Windows-only probes in CI | Battery fails on ubuntu | Step 11 platform guard |

## Threat notes

- New routes are new attack surface: contracts are strict, approval flags
  default false, path/string containment validated server-side (client checks
  are UX, not security).
- Facade is the trust boundary for envelope unwrapping — new ts families inherit
  unwrap behavior automatically; legacy targets stay pure pipe.

## Integration

Pairs with: verification-complete (battery law), aide-windows-dev-reality
(platform traps), aide-ci-diagnostics (annotation harvest when CI is red),
aide-debugging-discipline (trap table).
