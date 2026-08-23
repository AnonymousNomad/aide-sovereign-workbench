# Skill: aide-provider-connect

# AIDE — Provider Connect: subscription login + chat/work import (arch Phase 7)

## Doctrine

- Reality check first: **consumer subscriptions do NOT grant API access.** ChatGPT Plus/Team, Claude Pro/Max, and Gemini consumer apps are separate products from the API consoles (OpenAI platform, Anthropic Console, Google AI Studio). Users can only (a) paste an API key from a console, or (b) import their exported chat history. Username/password/SSO login can NEVER drive API calls. Say this in the UI, honestly.
- One wire contract: OpenAI-compatible `POST /v1/chat/completions` with Bearer auth is the universal seam (OpenAI reference, llama.cpp server, Mistral, Groq, OpenRouter all speak it). Anthropic native is `POST /v1/messages` with `x-api-key` + `anthropic-version` — treat as a distinct adapter or via a compat shim; do NOT fake shapes.
- Keys live ONLY in the daemon, DPAPI-encrypted (CurrentUser, non-interactive — the PromptStruct flow is deprecated and breaks 2027-02). The browser receives provider IDs + status only; key material never crosses WS, logs, or session JSON.
- Online is opt-in (R4): local GGUF models stay the default; every provider host must be user-approved and pass the egress allowlist. Offline users lose nothing.

## What to do / code

0. **DPAPI binding (VERIFIED 2026-08-20)**: PowerShell .NET `ProtectedData` via `powershell.exe -NoProfile -NonInteractive` spawn — zero new npm deps, round-trip verified on this machine (protect→unprotect → exact plaintext, blob hides plaintext, re-encrypt differs). NOT FFI/native addon. **PITFALL (root-caused): `powershell.exe -Command <script> <arg>` JOINS all trailing args into the command string — `$args[0]` inside the script is null.** Pass payloads via an env var (`AIDE_DPAPI_IN`), never as a positional arg. Also: the availability probe must EMIT output (`; "ok"`), or the run() empty-output check rejects it. Always append `; "ok"` style markers; include stderr tail in errors (spawn stderr collection).
1. **Provider registry (daemon, `node/src/services/providers.ts`)** — built-in entries, each with `id`, `name`, `kind` (`openai-compatible` | `anthropic`), `baseUrl`, `modelId` list, and `egressHost`. Built-ins (hosts VERIFIED reachable on 443, 2026-08-20 — incl. `generativelanguage.googleapis.com`): `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`, `api.mistral.ai`, `api.groq.com`, `openrouter.ai`. Users may add any OpenAI-compatible `baseUrl` — it becomes an allowlisted host only after explicit approval (`approveHost: true` in the connect payload).
2. **Credential store (daemon, `node/src/services/credentials.ts`)** — DPAPI via PowerShell binding above, CurrentUser scope. File layout: `workspace/.aide/credentials.dpapi` `{version, providers:{id: base64-blob}}` (one blob per provider). The UI stores only `providerId` + `connected: true/false`. On save/read, the daemon must scrub the key from all error messages and logs (`scrubKey`).
3. **Connect flow**: user picks provider → pastes key in the browser (POST to daemon over localhost, HTTPS not applicable locally) → daemon stores DPAPI → probe: one minimal chat-completions call (`messages:[{role:'user',content:'ping'}]`, `max_tokens:1`, 5s timeout via AbortController) → status `connected`/`invalid_key`/`unreachable`. Show result, never the key. Anthropic probe uses native `/v1/messages` with `x-api-key` + `anthropic-version: 2023-06-01`. Status cached 60s TTL.
4. **Egress (VERIFIED implementation)**: the browser `egress.ts` guard stays local-only (no shape change — dist must never reach a provider host); the ALLOWLIST lives daemon-side (`workspace/.aide/provider-hosts.json`): built-in hosts pre-listed, custom hosts require explicit per-host approval. `scripts/egress-audit.mjs` FAIL rule: none of the 6 provider hosts may appear in `browser/dist` (only in daemon code).
5. **Importers (daemon, `node/src/services/importers/`)** — three formats, all parsed daemon-side, imported into the local chat store:
   - **ChatGPT `conversations.json`** (IMPLEMENTED, schema-tested with synthetic fixtures): node-map per conversation `{id (REQUIRED), title, create_time, mapping, current_node}`; walk `mapping` via `parent` from `current_node` to linearize the active branch; message fields `author.role` (system/user/assistant/tool), `create_time`, `content.content_type` + `content.parts[]` (string parts); tool messages skipped; `updatedAt` = last message create_time else conversation create_time (×1000 → ms). REAL-EXPORT GATE: still OPEN — no genuine export obtainable from this environment; importer verified only against documented shape + synthetic fixtures.
- **Claude export `conversations.json`** (IMPLEMENTED): `{uuid, name, chat_messages:[...], current_leaf_message_uuid}`; messages `{uuid, sender: "human"|"assistant", content:[{type: "text"|"thinking"|"tool_use"|"tool_result", ...}], created_at, parent_message_uuid}` (osteele/claude-chat-viewer zod schema; LibreChat confirms the filename). Policy (IMPLEMENTED): `text` blocks → content; `thinking`/`tool_use`/`tool_result` → DROPPED with an explicit warning; empty export `{conversations:[]}` imports 0 (valid).
- **Gemini Takeout** (MyActivity.json): NO official schema exists; community converters extract HTML-encoded chats. DECISION (2026-08-20): no importer — the Providers UI shows the Gemini row and only ChatGPT/Claude import options; Gemini import stays labeled experimental/absent until a real Takeout sample exists.
   - Import semantics (Open WebUI verified practice): additive, never overwrite; new IDs per import; preserve title + per-message Unix timestamps + model slug; roles map to the local store's user/assistant (+system where the store supports it); linearize the CURRENT branch only.
6. **Contracts + routes** (`common/contracts/providers.ts`, `/api/providers/*`): list (no keys), connect {providerId, key}, disconnect, status, import {format, payload} → {imported: N chats}. zod-strict, envelope pattern like everything else.
7. **UI**: Providers panel (one line per provider: name, status dot, Connect/Disconnect); Import panel (file pick → format autodetect: `mapping` key present = ChatGPT; `chat_messages` = Claude; else MyActivity heuristic); imported chats appear in the chat list with source badge. No key ever displayed.

## Why it's done this way

- Subscription ≠ API: Anthropic states it verbatim (https://support.claude.com/en/articles/9876003 — "doesn't include access to the Claude API or Console"); OpenAI keys exist only at platform.openai.com (https://help.openai.com/en/articles/4936850). Shipping a login form that cannot work would be the dishonest UX this project rejects.
- OpenAI-compatible contract: OpenAI reference (https://platform.openai.com/docs/api-reference/chat/create), llama.cpp server README (Bearer `no-key` example), Mistral (https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key), Groq (https://console.groq.com/docs/quickstart), OpenRouter (https://openrouter.ai/docs/quickstart) — one adapter covers all except Anthropic native.
- DPAPI: Microsoft docs (https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata) — same-user/same-machine binding + MAC integrity; VS Code's SecretStorage proves the pattern for IDE secrets ("stored encrypted... not synced across machines"). Open WebUI persists keys as DB config vars (weaker), Continue writes keys into config.yaml (weaker) — DPAPI is the stronger floor for a desktop IDE.
- Import formats: OpenAI export flow (https://help.openai.com/en/articles/7260999), Claude export flow (https://support.claude.com/en/articles/9450526), Gemini takeout (https://support.google.com/gemini/answer/16920332); schema ground truth from pionxzh/chatgpt-exporter, txtatech/chatgpt-export-to-text, osteele/claude-chat-viewer; import semantics from Open WebUI data-controls docs (https://docs.openwebui.com/features/chat-conversations/data-controls/import-export) and LibreChat (https://www.librechat.ai/docs/features/import_convos).
- Daemon-only secrets: Theia two-process architecture (https://theia-ide.org/docs/architecture/) — "any frontend code may assume browser as a platform but not Node.js"; the daemon is the only privileged host.

## Dependencies

- Node 20+ daemon; zod contracts; egress guard (Phase 4) + `egress-audit.mjs`; the local chat store (operator/chat endpoints from Phase 1 legacy work — the arch chat store); DPAPI binding (FFI to Crypt32 — pick and verify the binding early, it gates the phase).
- Local models remain default; no change to bundled model servers.

## Threat matrix

| Threat | Detail | Symptom if violated | Mitigation |
|---|---|---|---|
| Subscription-login fantasy | Consumer plans have no API | feature silently broken, user rage | UI states the split honestly; only API keys connect |
| Key exposure via WS/logs/session | keys echoed in events or error strings | credential leak | daemon-only; scrub all error paths; store `providerId` only in UI state |
| CRYPTPROTECT_LOCAL_MACHINE | machine-scope DPAPI = any user decrypts | local multi-user leak | force CurrentUser scope |
| PromptStruct DPAPI flow | deprecated; breaks Feb 2027 | decrypt failures after OS updates | non-interactive NULL prompt struct only |
| Egress allowlist bypass | user-added baseUrl pointing at a malicious relay | data exfiltration to attacker host | explicit per-host approval + persist + audit-script rule |
| Import schema drift | export formats change without notice | parser crashes / silent empty imports | per-format schema guards + sample fixtures + honest "0 chats matched" reports |
| Import bombs | huge exports freeze the daemon | OOM / blocked event loop | size cap, streaming parse, per-chat limits |
| Anthropic native shape | /v1/messages is NOT OpenAI-compatible | 404s or malformed requests | separate adapter; never pretend compat |
| Tool/thinking blocks | Claude thinking/tool content types | mangled conversations | explicit policy per content type (drop/collapse) |
| Provider probe cost | 1-token probe with long timeout | UI hangs on dead hosts | 5s timeout, max_tokens 1, cached status |

## Local verification gates (status as of 2026-08-20)

1. ~~Obtain ONE real ChatGPT `conversations.json` export~~ — NOT OBTAINABLE in this environment; importer built from documented shape, tested with synthetic fixtures; gate stays OPEN (README states it).
2. ~~Obtain ONE real Claude export~~ — same: OPEN; synthetic-fixture tested.
3. ~~Gemini Takeout sample~~ — RESOLVED: no importer; experimental label not needed since no Gemini import surface ships.
4. ~~Verify Google reachability~~ — DONE: `generativelanguage.googleapis.com` reachable on 443 (all 6 hosts verified).
5. ~~Pick + smoke-test the Node DPAPI binding~~ — DONE: PowerShell .NET ProtectedData via spawn (zero deps); round-trip verified; env-var payload passing (see section 0 pitfall).
6. ~~Re-locate the OpenAI "Plus does not include API access" article~~ — DONE: old slug 7039783 404s; canonical now https://help.openai.com/en/articles/8156019-is-api-usage-included-in-chatgpt-subscriptions (Plus FAQ 6950777 also states the split).

## E2E-verified browser pitfalls (2026-08-20, both were REAL bugs found by tests)

- Connect form was rendered into `listEl.lastElementChild` (LAST row) instead of the clicked row — `renderRow`'s `onAction` must receive the row element and render the form INTO it.
- Format autodetect must inspect entries INSIDE `{conversations:[...]}`: `mapping` on an entry = ChatGPT, `chat_messages` = Claude — checking only top-level/chat_messages rejected standard ChatGPT exports.
