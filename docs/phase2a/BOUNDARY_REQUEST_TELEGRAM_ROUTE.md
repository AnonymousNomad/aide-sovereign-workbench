# BOUNDARY EXPANSION REQUIRED — Telegram route authority seam

Baseline: covert-production @ bdbaff6eeb435a7a9ffe18551843ed24d4f97a58.

Request exactly one additional production file: **node/src/routes/telegram.ts**. It has NOT been modified. Both previous fixture expansions are APPROVED and are not the stop reason.

## Dependency / why

- node/src/openapi.ts:636 constructs the live bridge through createTelegramBridgeService.
- node/src/routes/telegram.ts:37–38 owns that factory; only workspace and a chatId/text callback can be supplied. Canonical authority and typed trusted callback identity are missing.
- Line 11 exposes authorizeChat(chatId) without actor/execution context.
- Line 19 owns the strict chat_id-only authorization schema. A chat allowlist cannot establish sender execution authority.
- Lines 66–73 discard trusted RouteContext actor information, authorize from a body chat ID and start polling.
- Lines 21–22 convert every service error to CHILD_FAILED, losing canonical denial/conflict semantics.

The approved service changes alone do not update their canonical factory/types or propagate an authenticated actor and consumed operation through these handlers. Avoid a hidden global authority lookup, a parallel factory in openapi.ts, handler monkeypatching or payload-label authority. Extend the existing seam explicitly.

## Smallest proposed mutation

1. Extend factory/TelegramService types to receive the existing canonical authority and trusted actor/execution context.
2. Pass trusted context through connect/authorize/disconnect/start, with no public proof mint or blanket approval.
3. Separate nonprivileged chat allowlisting from execution-capable sender/chat binding. Extend the existing strict schema only where required to represent that binding. Chat-only compatibility must not grant mutation permission.
4. Preserve FORBIDDEN/CONFLICT/NOT_READY and safe decision detail. No polling or fallback executor after denial.
5. Preserve valid status/result shapes and messaging behavior. No bot/identity redesign or dependency.

No common/contracts/telegram.ts exists; schemas are inline in this file. Generated common/openapi.json is already authorized.

## Tests affected — already approved

- scripts/telegram-brain-battery.mjs: real delegation/confirmation, wrong identity/chat, expiry, replay, forged fields and zero desktop effects.
- tests/arch/capability-authority.test.ts: route pairing, exact binding and explicit denial.
- tests/arch/authority-route-coverage.test.ts: authorized new security test for policy/route coverage.
- tests/arch/authority-fixture.ts: real pairing and explicit operation approvals.

## Current evidence and failures

See CHECKPOINT_C_TRANSPORT_RESULTS.json and TRANSPORT_INTEGRITY.json.

- Focused: 13 passed, 0 failed/cancelled/skipped (990.9457 ms).
- Real child transport: 1 passed, 0 failed/cancelled/skipped (1761.9731 ms); 9 HTTP negative cases, 2 exact approved fixture writes, real facade WS event, observed exits.
- Five JavaScript syntax checks passed; browser typecheck exit 0.
- Backend typecheck FAILED: optional adapter type mismatch; Promise.withResolvers unavailable in configured TypeScript library.
- Targeted lint FAILED: 3 app.js browser-global no-undef errors; 7 warnings (6 unused bindings, 1 ignored desktop launcher).
- Those in-boundary repairs remain pending at this scope stop. Keep compiler/lint configuration unchanged.
- Full lint/build/contracts/battery/browser acceptance, agent/Telegram integration, ownership-safe panic and full adversarial matrix remain unrun/incomplete.
- Native source IMPLEMENTED — NATIVE RUNTIME UNVERIFIED; native compilation/startup DEFERRED — RUST TOOLCHAIN UNAVAILABLE.

## Integrity / resume

38/38 protected hashes match. Checked fixture PIDs/listeners are absent. No operator workload stopped, tooling installed, commit or push. NOT ACCEPTANCE-READY.

After approval: fix recorded in-boundary type/lint failures, rerun focused gates, then continue C client acceptance and D service authority through this existing route; E ownership and F adversarial acceptance remain required. No Phase 2B.

Documentation write note: an oversized combined patch failed before execution with Windows error 206. Verified all three intended new documents absent; split into individual apply_patch invocations. Source changes were not retried or broadened.
