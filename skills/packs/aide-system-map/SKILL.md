---
name: aide-system-map
description: The AIDE "system map" — a single dashboard that shows a user (or a new agent) everything AIDE has live, right now, in this workspace. Eight subsystem cards (in-house model, workbenches, skills, agent loop, micro-experts, DNA-helix memory, veritas+selfheal, BYOK+desktop), each with a live status, a last-updated timestamp, a doctrine link, and a journal link. Read-only: never mutates state, never caches. The "tell them everything" surface the audit calls out and the walkthrough step 5 IS. Use when building/auditing the cockpit system-map panel, when the user asks "what does AIDE actually have?", when an agent needs to discover what subsystems are live before making a plan, or when reviewing production-readiness claims (the system map is the proof the claim is real, not aspirational).
---

# System Map — the "tell them everything" dashboard

## Why this matters

Born 2026-09-01 from the sleeper-mode production-readiness directive. The user said: "we've got built-in workflows, in-house skills, agents, orchestrator, everything — explain to them how it operates and improves any model that uses it." The system map IS that explanation, live. Every status is read from a real source — not a claim, not a checkbox, a live read. The walkthrough step 5 (`aide-onboarding-walkthrough` §5) is the first-run instance; this skill is the always-on panel.

## The 8 subsystem cards (the spec)

Each card is a `<system-map-card>` component. Pure read: on mount, on interval (30s), and on focus, the card calls the corresponding route and renders status + last-updated + doctrine link + journal link. No state mutation, no caching, no optimistic updates. Cards:

1. **In-house model** — `GET /api/models/status` — North-Mini-Code-1.0
   - Live: status = `ready` / `loading` / `error` / `not_loaded` + model_id + port + memory_used_mb
   - Source: `models/manifest.json` (10 model entries, in-house flag)
   - Doctrine: `aide-cipher-house-model`
   - Journal: `.aide/logs/arch-out.log` (last 50 lines, scrollable)
2. **3 Workbenches** — `GET /api/workbenches` — sovereign-coder/pipeline/architect
   - Live: per-workbench status = `installed` / `available` / `disabled` + plugins_count + skills_count + mcp_count
   - Source: `workbenches/sovereign-{coder,pipeline,architect}.json` (3 bundles, pluggable, per-bundle governance)
   - Doctrine: `aide-bundle` workflow
   - Journal: `aide-bundle install <id>` log
3. **197 Skills** — `GET /api/skills/count` + per-skill status
   - Live: total + per-skill `loaded` / `unloaded` (lazy activation per `aide-skill-curation`)
   - Source: `skills/packs/` directory (verified 2026-09-01: 197 packs)
   - Doctrine: `aide-skill-curation` (when to load what)
   - Journal: per-skill `last_used_at` (from DNA-helix X1 spine)
4. **Agent loop** — `GET /api/agent/status`
   - Live: status = `online` / `offline` / `degraded` + active_sessions + last_action_at + model_in_use
   - Source: `node/src/services/agent-loop.mjs` (the orchestrator)
   - Doctrine: `aide-orchestrator-awareness` + `aide-offline-agent-loop`
   - Journal: `.aide/logs/agent-events.jsonl`
5. **Micro-Experts** — `GET /api/experts/list`
   - Live: per-expert name + role + domain + holdout_agreement + manifest_sha + status = `loaded` / `frozen` / `training`
   - Source: `harness/micro-experts.mjs` + `.aide/experts/` manifests (3 trained: task-router @ 0.978, diff-risk-gate @ 1.00, request-intent-classifier @ 1.00, per `aide-micro-expert-collective` FIRST-TRAIN RECIPE)
   - Doctrine: `aide-micro-expert-collective` (the collective, the FIRST-TRAIN RECIPE, the holdout-agreement floor)
   - Journal: `node scripts/experts-battery.mjs` last-run log
6. **DNA-Helix memory** — `GET /api/memory/status`
   - Live: X1 spine events + X2 joins + X3 retention + total_entries + oldest + newest
   - Source: `harness/memory-spine.mjs` + `helix-join.mjs` + `helix-retention.mjs` (commits `448b888`)
   - Doctrine: `aide-helix-memory` (X1+X2+X3, the 3-strand helix)
   - Journal: `.aide/memory/helix.jsonl`
7. **Veritas + Selfheal** — `GET /api/veritas/status` + `GET /api/selfheal/status`
   - Live: credo version + 5 oaths status + last_evidence_scan + selfheal status = `green` / `yellow` / `red` + last_repair_at
   - Source: `harness/veritas.mjs` + `scripts/selfheal.mjs` (commit `54af97b`)
   - Doctrine: `aide-veritas-layer` + `aide-credo-guardrail` + `aide-cipher-self-healing-sop`
   - Journal: `.aide/logs/selfheal.log`
8. **BYOK + Desktop control** — `GET /api/byok/status` + `GET /api/desktop/status`
   - Live: per-provider `connected` / `invalid_key` / `unreachable` / `not_configured` (no key material, only booleans per `aide-cloud-handoff` H2) + desktop status = `enabled` / `disabled` + active_grants
   - Source: `aide-cloud-handoff` H1+H2 (8 BYOK routes + 4 provider routes) + `aide-p6-desktop-control` Stage A bounded grants
   - Doctrine: `aide-cloud-handoff` + `aide-provider-connect` + `aide-p6-desktop-control`
   - Journal: `egress-journal.jsonl` (journaled egress, never the key)

## Files to touch (when wiring)

| File | Change |
|---|---|
| `common/contracts/system-map.ts` | NEW: zod schemas for `SystemMapSnapshot` (the 8-card state) + `SubsystemStatus` (live/offline/N/A + last_updated + doctrine_url + journal_url). All `.strict()`. |
| `node/src/services/system-map.mjs` | NEW: `createSystemMapService({workspace, fetchImpl})` — `getSnapshot()` calls the 9 routes in parallel (8 cards + veritas sub-route), returns the snapshot. No caching. No mutation. 5s per-route timeout. |
| `node/src/routes/system-map.ts` | NEW: `GET /api/system-map/snapshot` — returns the snapshot. |
| `node/src/openapi.ts` | EXTEND: register `routesForSystemMap(systemMapService)`. |
| `common/openapi.json` | REGENERATE. |
| `browser/src/cockpit/system-map/SystemMap.tsx` | NEW: the 8-card grid + the live poll (30s interval) + the focus-refresh + the doctrine/journal links. |
| `browser/src/cockpit/system-map/cards/*.tsx` | NEW: 8 card components, one per subsystem. |
| `browser/src/cockpit/system-map/index.ts` | NEW: exports. |
| `tests/arch/system-map-doctrine.test.ts` | NEW: parses this skill + asserts the 8 card names + the 9 routes + the contract schemas. |

## Threat matrix

| Threat | Likelihood | Blast radius | Mitigation | Detection test |
|---|---|---|---|---|
| Card blocks on a hung route | medium (9 routes in parallel, one hang = whole panel frozen) | system map looks broken | per-route 5s timeout via `AbortController`; one hung card = that card shows "degraded" + the other 7 render normally | mock a hanging route, assert 5s timeout fires + the other 7 are fine |
| System map leaks a BYOK key | low (routes are doc-shaped) | credential leak | the snapshot shape explicitly excludes key material; veritas secret-scan in CI; the route contract is the 8-card shape, nothing more | the snapshot never contains a key string; test asserts shape only |
| Stale snapshot (route returns cached data) | low (we never cache) | user sees old data | no caching by design; 30s poll + focus-refresh + manual "refresh" button | mock a route that returns stale data, assert the UI surfaces the timestamp |
| A subsystem card crashes the whole panel | low (1 of 8 cards) | whole panel fails to render | error boundary per card; crashed card shows "error: <message>" + a "retry" button; the other 7 keep working | throw inside a card, assert the other 7 still render |
| The snapshot route becomes a DoS vector | low (no auth on local socket) | the daemon stalls | per-IP rate limit on `/api/system-map/snapshot` (1 req/s per workspace, drop excess with 429); 5s per-route timeout caps blast radius | hit the route 100x in 1s, assert at most 1 success + the rest 429 |
| Doctrine link is broken (skill deleted) | low (stable) | 404 in the UI | the link is `aide-<name>`; the route resolves to `/skills/packs/<name>/SKILL.md`; missing file = 404 with a "skill removed in this build" inline message | delete a skill, assert the card surfaces the message gracefully |
| The 30s poll drains the battery on a laptop | medium (always-on) | battery drain | poll only when the panel is visible (IntersectionObserver); stop on tab blur; resume on focus | mock a 30s tick while the panel is hidden, assert no request fired |
| A subsystem has no route yet (e.g. a new skill ships without wiring) | medium (rolling releases) | card shows "no data" | the card is graceful: shows "— (not yet wired in this build)" + the doctrine link | add a card that references a nonexistent route, assert the graceful fallback |

## Dependencies

Upstream skills (must be loaded first):
- `aide-ide-research` R1+R2 (load before any AIDE feature)
- `aide-vscode-parity-roadmap` per-phase skill spec
- `aide-onboarding-walkthrough` (sister skill, walkthrough step 5 IS the system map)
- `aide-cipher-house-model` (card 1)
- `aide-skill-curation` (card 3)
- `aide-orchestrator-awareness` + `aide-offline-agent-loop` (card 4)
- `aide-micro-expert-collective` (card 5, FIRST-TRAIN RECIPE)
- `aide-helix-memory` (card 6)
- `aide-veritas-layer` + `aide-credo-guardrail` (card 7)
- `aide-cloud-handoff` + `aide-provider-connect` + `aide-p6-desktop-control` (card 8)

Repo primitives:
- `common/contracts/*.ts` (zod-strict pattern)
- `node/src/services/*.mjs` (service factory pattern)
- `node/src/routes/*.ts` (route registry)
- `node/src/openapi.ts` (buildRoutes, single-source-of-truth hoist)
- `browser/src/cockpit/*.tsx` (component tree)

## Pitfalls (Windows + this repo)

- **Snapshot parallelism**: `Promise.all` with `AbortController` per route is the only safe pattern; sequential calls blow the 5s budget on a slow disk
- **Never cache**: the user reads the system map to know "what is LIVE right now"; any cache makes the answer a lie
- **The 8 cards are READ-ONLY**: this skill must NEVER write to any `.aide/` file; that would conflate the read surface with the write surface (the walkthrough IS the write surface for state)
- **The 8 routes already exist** for some cards (models, workbenches, experts, byok, desktop, agent, memory, veritas); the system-map service is a FAN-OUT layer, not a re-implementation
- **Doctrineless cards**: a card that references a skill that does not exist must surface a graceful "skill removed in this build" message, NOT a 500
- **The journal link** points to the LAST log file, not a live tail; the user opens it in a separate panel; do not iframe it (the iframe trick breaks back-pressure)
- **30s poll vs `requestAnimationFrame`**: never use rAF for the poll (battery); use `setInterval` gated by `IntersectionObserver` + `document.visibilityState`
- **The 8 cards are independent**: a card's failure MUST NOT take down the panel; the error boundary is per-card

## Gates (verification battery)

1. `node --check browser/src/cockpit/system-map/*.tsx` exit 0
2. `node --test tests/arch/system-map-doctrine.test.ts` PASS — asserts: (a) this skill file has 8 card names; (b) the `SystemMapSnapshot` zod schema is strict; (c) the 9 source routes exist (the 8 + veritas sub-route); (d) the snapshot shape never includes a key-shaped string
3. `node --test tests/arch/system-map-resilience.test.ts` PASS — asserts: (a) one hung card does not block the other 7; (b) a thrown error in a card shows the graceful error state; (c) the 30s poll stops when the panel is hidden
4. `npm run contracts` is a no-op (openapi.json regenerates byte-identical)
5. `scripts/egress-audit.mjs` PASS (no provider host in browser/dist)
6. Manual: open the cockpit, navigate to the system map panel, verify all 8 cards render with live status, verify the 30s poll updates a card after a manual change (e.g. start/stop the in-house model), verify the panel survives a thrown error in one card, verify battery drain is bounded (use a profiler)

## Rollout (2 PRs)

### PR A — Contracts + service + route + tests (smaller, runtime-only)
- `common/contracts/system-map.ts` (zod schemas)
- `node/src/services/system-map.mjs` (fan-out, parallel fetch, 5s timeouts)
- `node/src/routes/system-map.ts` (`GET /api/system-map/snapshot`)
- `node/src/openapi.ts` (register)
- `common/openapi.json` (regenerate)
- 2 arch tests (doctrine parse + resilience)
- Commit: `feat(system-map): fan-out service + snapshot route (PR A of aide-system-map)`

### PR B — Cockpit panel + manual smoke
- `browser/src/cockpit/system-map/` (the 8 card components + the grid + the 30s poll)
- Add a top-level cockpit route: `/system-map`
- Link from the walkthrough step 5 + from the cockpit header
- Manual smoke on a real workspace
- Commit: `feat(cockpit): system map panel (PR B of aide-system-map)`

## References

- `aide-ide-research` (R1+R2: load before any AIDE feature, 3 sources per claim)
- `aide-vscode-parity-roadmap` (per-phase skill spec)
- `aide-onboarding-walkthrough` (sister skill, walkthrough step 5)
- `aide-cipher-house-model` (card 1)
- `aide-skill-curation` (card 3)
- `aide-orchestrator-awareness` + `aide-offline-agent-loop` (card 4)
- `aide-micro-expert-collective` (card 5, FIRST-TRAIN RECIPE)
- `aide-helix-memory` (card 6)
- `aide-veritas-layer` + `aide-credo-guardrail` (card 7)
- `aide-cloud-handoff` + `aide-provider-connect` + `aide-p6-desktop-control` (card 8)
- `aide-master-roadmap` (the no-phone-home law, audit line 73)
- `docs/AUDIT-2026-08-31.md` PART 6 (the 10-feature advantage, audit line 165-167: "Telegram + desktop control + bounded sandbox" + "Micro-Expert Collective" + "Veritas evidence gates" are the 3 of the 10 that the system map shows live)
- `E:/pip_temp/competitor-onboarding-byok.md` (the 7-source gap analysis that motivated this skill)
