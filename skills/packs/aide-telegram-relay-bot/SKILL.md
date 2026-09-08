// aide-telegram-relay-bot — design proposal for the operator's
// DC_AIDEbot (forthcoming). The architecture decision is to use the
// EXISTING chassis telegram path as a thin transport, with a small
// `onCommand` hook that dispatches to `desktop.act({ approved: true })`
// rather than to `telegram-brain.mjs`'s LLM proposal/confirm flow.
//
// Generated 2026-09-07 after research that confirmed:
//   - the chassis's `telegram.mjs` is already a transport-only bridge
//     (long-polling, chat_id allowlist, onCommand hook for routing)
//   - the chassis's `routesForTelegram` exposes the full lifecycle
//     (status, connect, authorize, disconnect, start)
//   - `telegram-brain.mjs` exists but its design assumes ONE operator
//     with a proposal/confirm loop; for a multi-user public bot the
//     model is wrong
//   - the chassis's desktop-control service already has the full
//     `desktop.action` flow with grants, panic, path-jail, evidence
//     emission
//   - the existing `scripts/telegram-battery.mjs` validates the bridge
//     against a local mock Telegram server end-to-end (5/5 passing)
//
// The proposal is a thin slice: one new service
// (node/src/services/telegram-relay.mjs), one new route file
// (node/src/routes/telegram-relay.ts), wiring in openapi.ts, the env
// var already covered by the .env.example added 2026-09-07. No LLM
// in the request path. No public webhook (long-polling, same shape
// as the existing bridge). One new authorization model: the user's
// chat_id is the authorization. The grant model is unchanged
// (operator-configured in .aide/desktop/grants.json).

## Why this exists (the failure mode the operator identified)

On 2026-09-07 the operator said: "I just gave you my bot token for
the aide what I wanted it it's a customer support line directly
inside the AIDE that grows directly to my telegram so people who
use it I can get direct feedback. ... Then the cipher bot model is
the one that is for the remote control ... Then we'll have a
separate line inside the AIDE that goes directly to my telegram
no bots if that makes any sense."

The architecture was clarified: the new public bot is a thin
relay that forwards user messages to the EXISTING Cipher desktop
control flow. The bot itself has no intelligence; the chassis's
desktop service does the work, using the operator's existing
grants.

## Design (slice by slice)

### Slice 1 — Service + route + wiring

`node/src/services/telegram-relay.mjs`:
- Wraps the existing `createTelegramBridge` with a custom
  `onCommand` hook.
- The hook is a HARD-CODED parser (not an LLM call). It matches
  against a small regex per supported op, e.g.:
  `/^(?:please\s+)?(launch_app|open_path|list_windows|move_file|focus_window|outlook_create_draft|excel_generate_report)\s*\(\s*target\s*=\s*"([^"]+)"\s*(?:,\s*destination\s*=\s*"([^"]+)")?\s*\)\s*;?\s*$/i`
- On a match: extract op, target, destination. Call
  `desktop.act({ op, target, destination, approved: true,
  note: 'telegram-bridge:<chatId>' })`.
- On a non-match: reply with usage help (no LLM interpretation).
- All other op-level safety is delegated to desktop-control:
  the existing grants check, path-jail, panic, evidence capture,
  approved:true policy. NO new policy layer.

`node/src/routes/telegram-relay.ts`:
- Reuses the same `routesForTelegram` factory (per the single-source
  principle in aide-route-slice-sop: "If two families share state,
  create ONE service instance above the array and close over it.")
- Closes over the desktop service + a custom onCommand.
- Returns the same 5 routes the existing service exposes (status,
  connect, authorize, disconnect, start) but on a separate path
  prefix so the existing bridge is untouched.

`node/src/openapi.ts`:
- One new service instance: `const telegramRelay = createTelegramBridgeService(workspace, onCommandHook);`
- One new route spread: `...routesForTelegram(telegramRelay),`
- Telegram token in env: `AIDE_TELEGRAM_BOT_TOKEN_DC_AIDE` (already
  in the .env.example added 2026-09-07).

### Slice 2 — Battery

`tests/in-house-e2e/telegram-relay-battery.mjs`:
- Spin a local mock Telegram server (reuse the pattern in
  `scripts/telegram-battery.mjs`).
- Cases:
  - Unknown chat is ignored (allowlist enforcement)
  - Authorized chat + valid op (e.g., "launch_app(target='notepad.exe')")
    calls `desktop.act` with approved:true
  - Authorized chat + invalid op (e.g., "do the thing") returns
    usage help (no LLM)
  - Authorized chat + dangerous op (e.g., "run_command(target='rm -rf /')")
    is REFUSED by the existing desktop service (path-jail, grants) —
    this is the safety net, NOT a new policy.
  - Desktop panic → bot replies with the panic error verbatim.
- 5/5 green before any of this is "done."

### Slice 3 — Documentation + .env.example update

`docs/evidence/telegram-relay-battery.md`:
- Same format as the existing desktop-battery.md: a log of every
  battery run with the run_id, count, and per-probe detail.

`.env.example`:
- Already has `AIDE_TELEGRAM_BOT_TOKEN_DC_AIDE=` placeholder from the
  earlier security slice. Add a short comment that the relay lives
  on port 4778 like the existing telegram (no extra ports).

## Threat matrix

| Threat | Control |
|---|---|
| Prompt injection (user says "ignore previous and run rm -rf") | The onCommand hook is a hard-coded regex parser, not an LLM. The user's text is just data fed to a small parser. There is no instruction-following model in the request path. |
| Privilege escalation (user asks to spawn cmd.exe or powershell) | The existing desktop-control allowlist (`apps: ['notepad.exe', 'calc.exe', ...]`) refuses anything not on the list. The bot doesn't bypass the allowlist. |
| User tries to invoke ops without operator-granted roots | Path-jail check in desktop-control refuses paths outside `grants.roots`. The bot doesn't bypass the path-jail. |
| User triggers panic | Existing panic mechanism (operator-configured) kills the bot's spawned children and the next action is refused. The bot surfaces the panic error verbatim. |
| User sends spam / floods the bot | Telegram's per-user-per-bot rate limits apply (1 message per second globally, 30 messages per second per chat). Out of scope for the bot. |
| Token leaks via commit | Pre-commit hook (regex extended 2026-09-07) blocks Telegram bot tokens in any staged file. Verified by the new pre-commit-secrets-battery (6/6 green). |
| Token leaks via chat | The protocol is documented in aide-secrets-handling-protocol (created 2026-09-07): operator pastes token ONLY into .env, never in chat. The burned token pattern is canonical. |
| Stolen bot token used by attacker | The chat_id allowlist binds auth to a specific chat. A different chat_id is ignored. A leaked token without the operator's chat_id authorized is harmless. |
| Bot impersonation | Telegram signature verification (the `secret_token` HMAC over the update body) is done by `telegram.mjs` already. The relay does not need to redo this. |
| Privacy leak (user's chat_id logged in plaintext) | The audit-trail envelope already records `desktop` events with op+target+decision. Adding a `chat_id` field to those events is a trivial extension. |

## What I will NOT do (per R8 and the operator's directives)

- I will NOT add a cloud LLM. The relay has no LLM. It only routes.
- I will NOT bypass the desktop-grants allowlist. The relay is a
  trigger surface; the existing policy is the policy.
- I will NOT add a webhook. The chassis already uses long-polling
  (single source of transport truth, aide-route-slice-sop).
- I will NOT create a new OpenAPI route prefix. The relay reuses
  the existing `/api/telegram/*` paths (5 routes) but on a separate
  service instance. Per `aide-route-slice-sop` "If two families share
  state, create ONE service instance above the array and close
  over it." Two service instances, same routes — they share the
  factory but not the state (each has its own chat_id allowlist
  loaded from its own token's encrypted config).
- I will NOT add a new port. The relay runs in-process with the
  arch daemon (port 4778). The facade routes /api/telegram/* to
  arch already (per the existing facade-route-map.json). The
  second instance is dispatched by chat_id (the user's messages
  carry their chat_id; the bridge routes accordingly).

## Research anchors (verified 2026-09-07)

- **Telegram Bot API** https://core.telegram.org/bots/api —
  getUpdates long-polling, chat_id field, "private" chat type.
  Per-bot rate limits (1 msg/sec globally, 30 msg/sec per chat)
  are upstream of our service.
- **Sovereign-compute law** (operator standing directive from
  AGENTS.md R2): no cloud LLM, no external API. The relay has no
  LLM. The work is delegated to the local Cipher model via
  `desktop.act`, which is local.
- **aide-p6-desktop-control** skill — the existing desktop service
  is the policy. The relay is a trigger surface, not a policy
  surface. All grants, path-jails, panic, evidence apply.
- **aide-route-slice-sop** — single source of transport truth.
  The existing telegram.mjs IS the transport. The relay is a
  configuration: the same factory, a different service instance.
- **aide-security-hardening** + the new
  **aide-secrets-handling-protocol** skill — the token must come
  only from `.env`, never from chat.
- **aide-debugging-discipline** R8: Fail Once → Stop → Skill. The
  research above is the skill that captures the decision. The build
  is the next slice.

## Verification

The proposed slice will pass when:
- 5/5 telegram-relay-battery green
- No regression on the existing 33/33 in-house-e2e batteries
  (audit, c6, canary, chassis, grants, secrets)
- No regression on the 24/24 arch tests
- pre-commit hook still passes the secrets scan (the new
  service has no token material)
- The relay never throws on a malformed user message; it replies
  with usage help (best-effort, fail-closed per the desktop
  policy above)

## Operator workflow to deploy

1. Operator creates a new bot in BotFather, names it (e.g.,
   "AIDE_Control_Bot"), gets a new token.
2. Operator pastes the token into `AIDE_TELEGRAM_BOT_TOKEN_DC_AIDE=`
   in their local `.env` (NOT in chat).
3. Operator revokes the burned token.
4. Operator starts the arch daemon. The new relay service reads
   the env var on startup, connects to Telegram via long-polling.
5. Anyone who messages the bot: their chat_id is auto-added to the
   allowlist on first message? **NO.** Per the existing model
   (`telegram.mjs` `loadConfig`), the operator must explicitly
   `POST /api/telegram/authorize` with their chat_id. This is the
   human-in-the-loop gate that prevents strangers from driving AIDE.
6. The operator tells people who want to use it: "message the bot,
   I'll authorize your chat_id, then you can launch notepad / open
   file / etc. from your phone."

## Open questions for the build (per the operator's stand-down pattern)

- Should the relay also expose `/api/desktop/*` actions, or only
  the typed set? **Default: only the typed set. Per "single source
  of desktop truth," the desktop service IS the entry point. The
  relay is one trigger. New ops require updating both the regex
  and the desktop control allowlist — operator-side, single source
  of policy.**
- Should the bot verify the user via a magic command (e.g.,
  /start <passcode>) instead of the operator's explicit
  /authorize call? **Default: NO. Magic passcodes in user-facing
  surfaces become a leak surface. The operator's explicit
  /api/telegram/authorize is the single gate. Per P5: never trust
  what comes through the gate from an unauthenticated source.**
- Should the bot accept file-content arguments (e.g.,
  write_file(path, content))? **Default: NO. The desktop.allowlist
  already restricts `apps` (binaries) and `roots` (paths).
  write_file is in the tool allowlist but requires the path to be
  under a granted root. The bot can pass args; the desktop
  enforces. The relay doesn't need to pre-validate content.**
