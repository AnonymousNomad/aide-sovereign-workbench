---
name: aide-onboarding-walkthrough
description: The AIDE first-run walkthrough — a 5-step interactive sequence that takes a new user from "I just installed" to "I have a configured cockpit with my workbench, my BYOK (or offline-only), my desktop-control opt-in, and the system map explaining what AIDE is." Research-grounded in the 7-vendor pattern (Cursor Quickstart, VS Code Agents Quickstart, Cline Plan & Act, Windsurf Things to Try, Claude Code Quickstart, Aider tutorial videos, Continue chat-mode). Use when building/auditing the cockpit walkthrough, when a new user reports being confused on cold start, when scoping the P2 Onboarding phase (audit line 89, gate 4 line 149), or when reviewing whether AIDE ships the same "install to first commit" experience as the rivals.
---

# Onboarding Walkthrough — the 5-step SOP for the new user

## Why this matters

Born 2026-09-01 from the sleeper-mode production-readiness directive. Every AI IDE / CLI in 2026 ships a first-run walkthrough (verified across 7 sources: Cursor, VS Code Copilot, Cline, Windsurf/Devin, Claude Code, Aider, Continue). AIDE has the doctrine + the runtime for every walkthrough component (privacy, BYOK, workbench, desktop, system map) but no UI ties them together. This skill IS the wire-in. Per the audit (line 89): P2 Onboarding, 1 week, ships at end of week 3 (Gate 4, line 149).

## The 5 steps (the spec)

Each step is a `<walkthrough-step>` component in the cockpit. State is held in `walkthroughState: { currentStep, completed: Record<stepId, boolean>, userChoices: { name?, role?, workbench?, byokProvider?, byokKeyStored: boolean, desktopEnabled: boolean } }`. Persisted to `<workspace>/.aide/onboarding-state.json` so the walkthrough is resumable across restarts. Each step has a `next` button (validates required fields) and a `skip` button (marks step as `skipped:true` and advances). On `next` for step 5, mark `walkthroughComplete:true` and route to the cockpit home page.

### Step 1 — Welcome
- Tile: AIDE logo + 3 workbench thumbnails (sovereign-coder / sovereign-pipeline / sovereign-architect, loaded from `workbenches/*.json`).
- Form: name (string, max 80), role (enum: developer / researcher / student / other).
- Default selection: sovereign-coder (most common per the audit).
- `next` is enabled when name is non-empty.
- Citation: per Cline "Authorize with Cline" + Windsurf "1. Select your preferred theme 2. Log In 3. Start Building" + Cursor "Get started — Go from install to your first useful change."

### Step 2 — Privacy
- Single card. The exact copy (operator canon, from `aide-credo-guardrail`):
  > **AIDE is offline-first.** Your code. Your models. Your data. Nothing leaves without your hand.
  > We journal every egress (if you opt in). See `aide-master-roadmap` law #2 (No-Phone-Home).
  > Built-in workflows. In-house skills. Agents. Orchestrator. Everything improves with use.
- One button: "I understand. Continue." (no choice, no opt-out; this is the doctrine, not a preference).
- Citation: per VS Code Copilot "Trust Center FAQ" + Claude Code "Privacy choices" + Cursor "Trust & Safety" (the privacy disclosure IS the step, not buried in a settings menu).

### Step 3 — BYOK opt-in
- Provider picker (dropdown): OpenAI / Anthropic / Cohere / OpenRouter / Mistral / Groq / Gemini. Each shows `egressHost` from `aide-provider-connect` §1 (built-ins, hosts verified 2026-08-20).
- API key input (password-masked, never echoed).
- On `connect`: POST to `/api/byok/key {provider_id, api_key}` per `aide-cloud-handoff` H2. Daemon stores DPAPI, returns `{stored: true}`. UI shows success or `invalid_key` / `unreachable` per the connect-flow in `aide-provider-connect` §3 (5s timeout, max_tokens 1, status cached 60s).
- `skip` is highlighted as "Continue offline" (the DEFAULT). BYOK is opt-in, not opt-out. Cline ships the same pattern: "use the Cline Provider for pay-as-you-go access, ClinePass for a flat monthly subscription, or bring your own provider key" (Cline docs, §Authorize with Cline).
- Citation: Cline (explicit "bring your own provider key") + Claude Code ("Most surfaces require a Claude subscription or Anthropic Console account. The Terminal CLI, VS Code, and JetBrains also support third-party providers.") + Aider (14 providers including Ollama, the offline-friendly default).

### Step 4 — Desktop control opt-in
- Single card. The exact copy:
  > **AIDE can drive your desktop** when you grant it. Every action is journaled. You can panic-stop at any time. Default = OFF. Click to enable.
- One button: "Enable desktop control" (opt-in). `skip` = "Not now" (default).
- On `enable`: POST to `/api/desktop/grant { scope: "default" }` per `aide-p6-desktop-control` (Stage A bounded grants). The cockpit shows the desktop control panel after walkthrough completion.
- Citation: the rivals do NOT ship desktop control. AIDE IS the differentiator (audit line 326). The opt-in pattern is the safer default (P5: never harm the operator; every action journaled per `aide-credo-guardrail`).

### Step 5 — System map
- One screen showing 8 cards in a grid. Each card is a subsystem with status (live / offline / N/A), last-updated timestamp, and a journal link.
- The 8 cards:
  1. **In-house model** (North-Mini-Code-1.0 — `models/manifest.json`) — status from `/api/models/status`
  2. **3 Workbenches** (sovereign-coder/pipeline/architect) — installed/available per `/api/workbenches`
  3. **197 Skills** — count from `skills/packs/` directory
  4. **Agent loop** (online/offline) — from `/api/agent/status`
  5. **Micro-Experts** (3 trained: task-router, diff-risk-gate, request-intent-classifier) — from `/api/experts/list`
  6. **DNA-Helix memory** (X1 spine / X2 join / X3 retention) — from `harness/memory-spine.mjs`
  7. **Veritas + Selfheal** (credo + 5 oaths + bounded repair) — from `scripts/selfheal.mjs`
  8. **BYOK + Desktop control** (if enabled in steps 3-4) — from `/api/byok/status` + `/api/desktop/status`
- "Click any tile to expand" → tile expands to show the subsystem doc + the doctrine skill + the runtime status.
- Final button: "Open the cockpit" → routes to `/` and marks `walkthroughComplete:true`.
- Citation: per Cursor capabilities list + VS Code "Customize agents" doc + Cline "Memory Bank" (the rivals show users what they have; this IS the system map).

## Files to touch (when wiring — the runtime PRs)

| File | Change |
|---|---|
| `common/contracts/onboarding.ts` | NEW: zod schemas for `OnboardingState`, `OnboardingStep` (discriminated union of 5 step types), `OnboardingChoice` (provider, workbench, desktopEnabled, name, role). All `.strict()`. |
| `node/src/services/onboarding.mjs` | NEW: `createOnboardingService({workspace})` with `getState()`, `setState(state)`, `nextStep()`, `prevStep()`, `skipStep()`, `complete()`. Persists to `<workspace>/.aide/onboarding-state.json` atomically. Never mutates other `.aide/` files. |
| `node/src/routes/onboarding.ts` | NEW: 4 routes — `GET /api/onboarding/state`, `PUT /api/onboarding/state`, `POST /api/onboarding/next`, `POST /api/onboarding/complete`. All zod-strict. |
| `browser/src/cockpit/walkthrough/Walkthrough.tsx` | NEW: the 5-step state machine + step router. |
| `browser/src/cockpit/walkthrough/steps/Welcome.tsx` | NEW: Step 1. |
| `browser/src/cockpit/walkthrough/steps/Privacy.tsx` | NEW: Step 2. |
| `browser/src/cockpit/walkthrough/steps/ByokOptin.tsx` | NEW: Step 3 (reuses the connect form from `aide-provider-connect`). |
| `browser/src/cockpit/walkthrough/steps/DesktopOptin.tsx` | NEW: Step 4. |
| `browser/src/cockpit/walkthrough/steps/SystemMap.tsx` | NEW: Step 5 (reuses the cards from `aide-system-map`). |
| `browser/src/cockpit/walkthrough/index.ts` | NEW: exports `Walkthrough` + the 5 steps. |
| `node/src/openapi.ts` | EXTEND: register `routesForOnboarding(onboardingService)` in the build routes. |
| `common/openapi.json` | REGENERATE: `npm run contracts` (per `aide-typescript-strict-pass`). |
| `tests/arch/onboarding-walkthrough-doctrine.test.ts` | NEW: parses this skill + asserts the 5 step names + the contract schemas + the 4 routes. |

## Threat matrix

| Threat | Likelihood | Blast radius | Mitigation | Detection test |
|---|---|---|---|---|
| BYOK key echoed in WS events / logs / error strings | medium (real bug class — see `aide-cloud-handoff` §0 DPAPI pitfall) | credential leak | daemon-only; scrub all error paths; store providerId only in UI state; veritas secret-scan in CI | the key string never appears in any test fixture or `egress-journal.jsonl` |
| Desktop control granted accidentally | low (opt-in only) | machine-wide action | default = OFF; every action journaled; panic-stop button on every desktop route; bounded grants (Stage A) | the walkthrough defaults to desktop OFF, the test asserts that |
| Walkthrough state corruption crashes the cockpit on first launch | medium (state is persisted JSON) | new users see a broken app | atomic write (write to `.partial` then `rename`); zod-strict parse on load; if parse fails, reset to step 1 + journal the corruption | corrupt the file, reload, assert graceful reset |
| Egress allowlist bypass via custom BYOK host | medium (Aider ships this) | data exfiltration | explicit per-host approval + persist to `.aide/provider-hosts.json`; `scripts/egress-audit.mjs` FAIL rule: no provider host in `browser/dist` | add a malicious host, assert refused |
| Walkthrough skipped, user lands on cockpit with no system map context | low (skip is allowed) | user is lost | system map is ALSO a top-level cockpit panel (not walkthrough-only); once seen, always reachable | skip the walkthrough, assert the system map is in the cockpit |
| API key probe (1-token call) hangs the walkthrough | low (5s timeout) | walkthrough stalls | `AbortController` 5s; cached 60s TTL per `aide-provider-connect` §3 | mock a hanging probe, assert 5s timeout fires |
| DPAPI refuses (non-Windows host, AIDE_ALLOW_PLAINTEXT_SECRETS unset) | low (Windows-only) | BYOK step fails cleanly | typed error surfaced to UI as "BYOK requires Windows in this build" with a fallback to Aider-style env-var key | non-Windows test asserts the error message |
| User picks a workbench they later regret | low (can re-pick) | wasted 5 minutes | workbench switcher in the cockpit header (sovereign-coder/pipeline/architect always one click away) | change workbench, assert the cockpit re-loads with new plugins |

## Dependencies

Upstream phase skills (must be loaded first):
- `aide-ide-research` — R1+R2 (3 sources per claim, this skill cites 7)
- `aide-vscode-parity-roadmap` — the per-phase skill spec this follows
- `aide-cloud-handoff` H1+H2 — the BYOK routes (8 BYOK + 4 provider)
- `aide-provider-connect` — the connect-flow doctrine + the 6 verified hosts
- `aide-p6-desktop-control` — the desktop control Stage A bounded grants
- `aide-p2-descent-intro` — the cinematic that plays BEFORE this walkthrough
- `aide-p2-onboarding` — the parent P2 phase (audit line 89, gate 4 line 149)
- `aide-system-map` — the sister skill (the walkthrough step 5 IS the system map UI)
- `aide-typescript-strict-pass` — for the zod-strict contract pattern
- `aide-credo-guardrail` — the credo copy that lands in step 2
- `aide-master-roadmap` law #2 (No-Phone-Home, offline-first) — the doctrine that step 2 enforces

Repo primitives this skill depends on:
- `common/contracts/*.ts` (zod-strict pattern)
- `node/src/services/*.mjs` (service factory pattern, see `worktree.mjs` for the canonical shape)
- `node/src/routes/*.ts` (route registry, see `routesForWorktree` for the canonical shape)
- `node/src/openapi.ts` (buildRoutes, single-source-of-truth hoist pattern)
- `browser/src/cockpit/*.tsx` (the cockpit component tree)
- `scripts/egress-audit.mjs` (the CI gate that catches browser→provider leaks)

## Pitfalls (Windows + this repo)

- **DPAPI payload passing**: pass keys via env var `AIDE_DPAPI_IN`, never as a positional arg to `powershell.exe` (the trailing-args-join bug from `aide-provider-connect` §0)
- **Status cache**: the 60s TTL on `GET /api/byok/status` means the walkthrough sees a stale "connected" right after a key delete; the UI must show the cache timestamp
- **The walkthrough must NEVER block on a probe**: every network call has a 5s timeout via `AbortController`; if the probe fails, default to offline and let the user retry
- **The credo copy is operator canon** (audit line 325, `aide-credo-guardrail`); do not paraphrase, do not "improve" it, ship it verbatim
- **The walkthrough is resumable** (state persists); test that closing the tab mid-step and reopening lands on the same step
- **The walkthrough must NOT auto-play on every cold start** (descent cinematic does); only show when `walkthroughComplete != true`
- **`prefers-reduced-motion`** users skip the descent AND the walkthrough animation; show the steps instantly with no transition (per `aide-p2-descent-intro` tier C)

## Gates (verification battery)

1. `node --check browser/src/cockpit/walkthrough/*.tsx` exit 0
2. `node --test tests/arch/onboarding-walkthrough-doctrine.test.ts` PASS — asserts: (a) this skill file has 5 step names in the spec; (b) the 4 zod schemas in `common/contracts/onboarding.ts` exist and are strict; (c) the 4 routes exist; (d) the BYOK opt-in step explicitly cites Cline "bring your own provider key" + Claude Code "third-party providers"; (e) the privacy step quotes the credo verbatim
3. `node --test tests/arch/walkthrough-state-shape.test.ts` PASS — asserts: the state machine handles forward, back, skip, complete; persisted state is loadable after process restart; corruption triggers graceful reset
4. `npm run contracts` is a no-op (openapi.json regenerates byte-identical, per `aide-production-readiness-plan` Phase 1 gate 1)
5. `scripts/egress-audit.mjs` PASS — no provider host in `browser/dist` (only in daemon code, per `aide-provider-connect` §4)
6. Manual: cold-start the daemon, observe the walkthrough play, complete all 5 steps, see the system map, end on the cockpit home page, restart the daemon, observe the walkthrough does NOT replay

## Rollout (2 PRs)

### PR A — Contracts + service + routes + tests (smaller, runtime-only)
- `common/contracts/onboarding.ts` (zod schemas)
- `node/src/services/onboarding.mjs` (state machine, atomic persistence)
- `node/src/routes/onboarding.ts` (4 routes)
- `node/src/openapi.ts` (register the routes)
- `common/openapi.json` (regenerate)
- 2 arch tests (doctrine parse + state shape)
- Commit: `feat(onboarding): walkthrough state machine + 4 routes (PR A of aide-onboarding-walkthrough)`

### PR B — Cockpit UI + manual smoke
- `browser/src/cockpit/walkthrough/` (the 5 step components)
- Wire the walkthrough into the cockpit root: if `walkthroughComplete != true` AND descent has played, route to walkthrough
- Add the system-map panel as a permanent cockpit top-level item
- Manual smoke on a real workspace
- Commit: `feat(cockpit): onboarding walkthrough + system map panel (PR B of aide-onboarding-walkthrough)`

## References

- `aide-ide-research` (R1+R2: load before any AIDE feature, 3 sources per claim)
- `aide-vscode-parity-roadmap` (per-phase skill spec)
- `aide-cloud-handoff` (H1+H2, BYOK + cloud handoff shipped)
- `aide-provider-connect` (arch Phase 7, 6 verified hosts)
- `aide-p6-desktop-control` (Stage A bounded grants)
- `aide-p2-descent-intro` (the cinematic before the walkthrough)
- `aide-p2-onboarding` (P2 phase, gate 4)
- `aide-system-map` (sister skill, the walkthrough step 5)
- `aide-credo-guardrail` (the credo copy in step 2)
- `aide-master-roadmap` (law #2, No-Phone-Home)
- `aide-typescript-strict-pass` (zod-strict pattern)
- `docs/AUDIT-2026-08-31.md` PART 3 (4-week plan) + PART 5 gate 4 (line 149)
- `E:/pip_temp/competitor-onboarding-byok.md` (the 7-source gap analysis that motivated this skill)
- 7 vendor sources (all primary, all verified 2026-09-01):
  - Cursor — https://docs.cursor.com/welcome
  - VS Code Copilot — https://code.visualstudio.com/docs/copilot/chat/copilot-chat
  - Cline — https://docs.cline.bot/getting-started/installing-cline
  - Windsurf / Devin Desktop — https://docs.codeium.com/windsurf/getting-started
  - Claude Code — https://docs.anthropic.com/en/docs/claude-code/overview
  - Aider — https://aider.chat/docs/install.html
  - Continue — https://docs.continue.dev/getting-started/overview
