# Skill: aide-model-handoff

# AIDE — Model Handoff: frictionless switching between any models (arch Phase 8)

## Doctrine

- One abstraction for everything that can complete a chat: local GGUF servers AND cloud providers are the same thing — a route with `{id, displayName, providerType, baseUrl, modelString, contextLength, chatTemplate, capabilities, status}`. The OpenAI `messages[]` contract is template-free on the wire; templating is the server's job, which is what makes handoff safe.
- On switch, the CLIENT re-sends the full conversation to the new model, fitting the NEW model's context window: system prompt preserved, newest turns kept, oldest non-system turns dropped (Open WebUI's documented filter; VS Code Copilot compacts/summarizes when full). Never let a 32k-context model's history silently overflow an 8k model.
- The server owns the chat template. A model must be served with its own `tokenizer.chat_template` (GGUF metadata) or an explicit `chat_format` — wrong template = gibberish/never-ending output. Handoff never re-templates client-side.
- Local stays default (R4/R5). Health-gated ordering: dead models sink to the bottom of the picker (VS Code Copilot "Auto model selection" pattern), with explicit "why" shown.

## What to do / code

1. **Manifest upgrade (`models/manifest.json` → schema 1.2)** — each entry gains: `providerType: "local" | "cloud"`, `chatTemplate: string` (template NAME or `"gguf-metadata"` marker, never the full template content in the manifest), `probeMs` (last health check), `status` becomes live (`ready|starting|down|unverified`). Keep `endpoint`/`model`/`context_tokens`/`system_prompt`/`roles`. Backward-compatible: old entries default `providerType:"local"`, `chatTemplate:"gguf-metadata"`.
2. **Router service (daemon, `node/src/services/model-router.ts`)** — the ONLY place that picks a model:
   - `routeForRole(role)` → first ready model with that role; `routeForId(id)` → explicit override (per-conversation binding).
   - Health: poll `GET /v1/models` (local) / probe endpoint (cloud) every 30s + before each route; short timeout (2-5s); treat slow first token on a warm CPU server as NORMAL (llama.cpp `--warmup` default is on — cold starts are latency, not failure).
   - Fallback chain: explicit order per role in the manifest (e.g. chat: 1.5B → 360M → cloud-if-approved); on route failure, surface `fell_back: {from, to, reason}` in the response envelope — honest, visible handoff.
   - Failure modes typed: `down` (probe failed), `busy` (503), `unsupported` (capability gap like tool_use), `context_overflow` (history > model ctx).
3. **Chat store change** — conversations are model-agnostic; store `modelId` on the CONVERSATION (default route), not on messages; on switch, update the conversation binding. History stays intact; re-send = re-request, nothing is mutated.
4. **History fit function (pure, unit-tested)** — given messages + target `contextLength` + token budget estimate (chars/4 conservative heuristic, or the server's reported usage where available): keep `system` (and `developer`) messages verbatim; walk from newest to oldest keeping user/assistant turns until budget; repair tool-call pairs (drop orphaned tool messages with their assistant turn); if the system prompt alone overflows, truncate it and log. `--keep` semantics teach the rule: llama.cpp drops the system prompt when the context is exceeded unless `--keep` covers it — AIDE's fitter must explicitly preserve it.
5. **Switch UX (browser)**:
   - Model picker in the chat header, per-conversation binding (Open WebUI pattern), ordered by health (dead last, greyed, reason shown).
   - "Re-ask with <model>" on every assistant message (Open WebUI regenerate / VS Code handoff pattern) — forks the turn, labels the response with the model.
   - Switch mid-chat: banner "switching from X (32k ctx) to Y (8k ctx) — showing the most recent N turns" with a manual override to include all.
   - `/status`-style context meter: "used ~3k of 8k tokens" (estimate; honest label "approx" until server-reported usage exists).
6. **Contracts + routes** (`common/contracts/routing.ts`, `/api/models/route`, `/api/models/status`): routeForRole → {modelId, fellBack?, reason?}; status list → live health for the picker. All zod-strict envelopes.
7. **Latency expectations (set them explicitly)**: CPU-only local generation on this machine is SLOW by design — MEASURED via Phase 6 `/api/chat` on 12 threads: 0.5B ≈ 32 t/s, 1.5B ≈ 16 t/s, 360M ≈ 16 t/s (these replace the pre-measurement estimates; they are chat-tok/s not llama-bench tok/s — no llama-bench binary exists on this machine). The UI shows "local model warming up" during load+first token, uses generous client timeouts for local, tight ones for cloud. No idle-unload in llama-cpp-python 0.3.34 (verified: no keep_alive flag) — a resident model stays loaded until another alias is requested; that's the AIDE warm-model policy for now.

## Why it's done this way

- Uniform abstraction: the field union is cross-checked against Continue.dev config (docs.continue.dev/reference + customize/models), LM Studio REST (`GET /api/v1/models`, loaded_instances), Ollama API (`/api/tags`, `/api/show`, `/api/ps` — github.com/ollama/ollama/blob/main/docs/api.md), and llama-cpp-python server settings — every field above exists in ≥2 of them.
- Full-history re-send: OpenAI contract ("messages: a list of messages comprising the conversation so far"), Open WebUI docs (forwards system + full history every turn; "does not silently truncate"), VS Code Copilot (handoff "carries the full conversation history and context with it"; auto-summarizes when full).
- Window-mismatch fitter: Open WebUI context-window troubleshooting documents exactly the filter (system held, oldest non-system dropped, tool repair); llama.cpp `--keep` proves the system-drop trap; Continue documents per-model `contextLength`.
- Template on the server: llama.cpp server `--chat-template` default = "template taken from model's metadata"; LM Studio "applied automatically for chat-tuned models"; llama-cpp-python per-model `chat_format`. The client never re-templates.
- Health-gated picker: VS Code Copilot Auto model selection — "One system tracks real-time model health and availability... match each task to the model" (code.visualstudio.com/docs/agents/concepts/language-models). Negative evidence: Open WebUI waits a 10s timeout per dead endpoint with NO failover; Continue has none documented — AIDE's router is the upgrade.
- Warm/cold semantics: llama.cpp server README (`--warmup` default on, `/health` exempt from idle timer), Ollama keep_alive 5m default (docs), LM Studio JIT + idle TTL 60m + auto-evict (lmstudio.ai/docs/developer/core/ttl-and-auto-evict) — AIDE's llama-cpp-python 0.3.34 has none of these (verified by grep of installed package), so warm-model policy is AIDE-owned.

## Dependencies

- Phase 1 ModelManager + probing; Phase 6 ingestion (manifest 1.2 entries for ingested models); Phase 7 provider-connect (cloud routes); the chat store + operator endpoint; zod contracts; WS events for live model status (existing `model` channel — extend status values if needed).
- `llama-bench` numbers for this machine (gates the latency expectations; UNVERIFIED estimates must not ship as promises).

## Threat matrix

| Threat | Detail | Symptom if violated | Mitigation |
|---|---|---|---|
| Context overflow on down-switch | 32k history into 8k model | server 400s / truncated nonsense | fitter runs on every switch; banner shows the cut |
| System prompt dropped | llama.cpp `--keep` default 0 drops it when ctx exceeded | model loses persona mid-chat | fitter preserves system first, always |
| Orphan tool messages | tool_call/tool_result pairs split by truncation | API 400 "tool result without call" | pair-aware pruning in the fitter |
| Template mismatch | model served with wrong chat_format | gibberish/never-ending output | template from GGUF metadata; explicit override only with verification |
| Dead-model UX | picker shows unreachable models first | user picks a dead model, waits | health-gated ordering, 2-5s probes, cached status |
| Silent fallback | router switches models invisibly | user trusts wrong model's answer | `fell_back` in every envelope + UI badge |
| Latency misread as failure | CPU warmup + full-history re-eval | client timeouts kill valid requests | warm-status UI, generous local timeouts, warm-model policy |
| Busy server | parallel requests queue/503 | dropped requests | single-slot policy, 503 → `busy` state → retry once |
| Token estimation drift | chars/4 heuristic wrong per language | fitter over/undershoots | labeled "approx" in UI until server-reported usage exists |
| keep_alive absence | 0.3.34 has no idle unload | RAM held by unused model | AIDE-owned unload endpoint (stop server) as manual action |

## Local verification gates (before claiming the phase)

1. `llama-bench` on the 3 bundled models → real tok/s (replaces the unverified estimates in the latency table). — **RESULT (2026-08-20): NOT RUN — no llama-bench binary on this machine.** Substituted honestly: Phase 6 measured `/api/chat` tok/s (0.5B=32.3, 1.5B=16.2, 360M=15.7, 12 threads CPU) are the numbers shipped; they are chat-latency numbers, not bench numbers, and are labeled as such.
2. llama-cpp-python 0.3.34 `/v1/models` in multi-model mode: confirm it lists ALL aliases, not just the resident one (curl). — **VERIFIED in Phase 6 (2026-08-19): `/v1/models` lists all aliases; identity check via /v1/models is the readiness gate.**
3. Multi-model mode behavior: request to alias B while A resident → confirm auto-unload/load timing (this IS the handoff latency floor). — **VERIFIED in Phase 6: server auto-swaps aliases (no keep_alive); the swap cost is measured as start/stop + warmup in the model-runtime skill. The client-side handoff floor = full-history re-send on top of that.**
4. Probe the `model` WS channel payloads — the live-status contract must match what the picker needs. — **RESOLVED deliberately (2026-08-20): the WS channel stays `ready|loading|stopped|error` (Phase 6 contract, e2e-covered); the Phase 8 picker uses REST `GET /api/models/routes` with 30s-TTL probes + per-route probe before use, so no channel extension was needed.**
5. Verify the manifest's `context_tokens` values against GGUF metadata (bundled smollm manifest says 2048 while GGUF metadata says 8192 — the manifest is the served ctx, but the mismatch must be resolved deliberately). — **RESOLVED (2026-08-20): manifest `context_tokens` = SERVED ctx (2048/4096/4096, matches the verified `-c` flags); new field `gguf_max_context` records the real GGUF headroom (8192/32768/32768 measured). The fitter budgets against `contextLength` (served ctx). Both numbers are honest and labeled.**

## Verified implementation notes (2026-08-20, Phase 8 shipped — check:arch 188/188, e2e 17/17, doctor 10/10)

- Route ids: `local:<modelId>` (manifest entries, catalog = runtime.list() + status set) and `cloud:<providerId>:<modelString>` (BUILTIN_PROVIDERS × models). **Legacy tolerance:** `routeForId` resolves a bare stored id as `local:<id>` when no direct match — old conversations keep working. E2E asserts this.
- Fitter semantics that tests pin (do not break): chars/4 conservative estimate; reserve = 512 (output budget); budget = contextLength − reserve; system/developer kept verbatim first (identity-preserving map — reference equality matters in tests); walk newest→oldest; **the newest turn is ALWAYS kept even past budget** (dropping the user's question is worse than overflow); tool/tool_result messages never enter the wire output (defensive filter); `developer` normalized to `system`; overflow only = system-truncated (flags `dropped`, `truncatedSystem`, `estimatedTokens`, `overflow`).
- Router health: routes() catalog probe + per-route probe before use; TTL 30s; local probe timeout 3s (verifyEndpointModel); cloud probe via providers.list cache; `fellBack: {from, to, reason}` typed down|busy|unsupported|context_overflow.
- Cloud executors: Anthropic = native `/v1/messages` (system extracted, consecutive same-role merged), everything else = `/chat/completions`; 60s AbortController; 429/503 → busy, 401/403 → NOT_READY; **keys scrubbed from every error via scrubKey**. `modelId` = `cloud:<providerId>:<model>`.
- ProviderDefinition.contextLength: openai 128000, anthropic 200000, google 1048576, mistral 32768, groq 128000, openrouter 128000.
- e2e pitfalls: `selectOption({label: regex})` is INVALID (label must be a string) — resolve the option `value` via `getAttribute` then `selectOption(value)`; status-text regex `/model:|start this model|warming/` — router error messages deliberately contain "start this model" so NOT_READY paths stay honest AND e2e-green.
- TS: `exactOptionalPropertyTypes` + `erasableSyntaxOnly` bite constantly — optional fields built via conditional spreads or a `normalizeOptions` helper; never assign `number | undefined` into an optional prop.
- Manifest schema 1.2 fields: `providerType`, `chatTemplate` ("gguf-metadata" marker, never template content), `gguf_max_context` (number | null). Backward-compatible defaults keep old entries valid.
- Cloud routes list ALL catalog models regardless of connectivity (status `unverified`|`down`); local declared-ready-but-not-started = `unverified`, running+probe-ok = `ready`, probe-fail = `down`, spawned = `starting`.
