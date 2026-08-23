---
name: aide-cloud-handoff
description: H1+H2 phase SOPs for the AIDE offline-first IDE — H1 portable session handoff bundles (SHIPPED) and H2 Bring-Your-Own-Key provider routing (roles plan/act/utility, DPAPI secret store, journaled opt-in egress). Research-grounded in VS Code 2026 BYOK docs (chatLanguageModels.json, apiType chat-completions/responses/messages, utilityModel), keytar deprecation (unmaintained since 2022 -> safeStorage/DPAPI/@napi-rs/keyring successors), and the project's No-Phone-Home law. Use when building/debugging handoff bundles OR BYOK credential storage, role->model routing, provider endpoints in aide-sovereign-workbench.
---

# H1 — Cloud Handoff (portable session bundles) — SHIPPED 2026-08-23, commit e51dd9d

Daemon NEVER transmits (No-Phone-Home absolute; zero fetch/http in service, CI-asserted). Portable HandoffBundle v1 JSON under `.aide/handoff/`; USER carries it. Redaction ladder: `brief` (default, safe by construction) < `transcript` (requires confirmed:true) < `full` (+include_code, requires both + SECRET_DETECTED scan gate w/ confirmed_secret_scan override). Routes: POST /api/handoff/export, GET /api/handoff/bundles(+get?id=), POST /api/handoff/import -> adopted context receipt. VS Code research base: session = conversation+context; handoff carries FULL history across harness change; /delegate = well-scoped brief to cloud PR flow; fork = up_to_message_index; external sessions adopted on first message.

Lessons: veritas secret-scan scans test sources too — construct planted tokens at runtime ('sk-'+'...'); enforce consent in SERVICE not just contract superRefine; imported bundles need HandoffBundle.passthrough() response schema; assert.rejects misses sync throws — assert.throws; pwsh multi-line Set-Content string concat breaks parsing — one line.

Honest limits: full tier == transcript today (no code_refs yet); import stores but doesn't inject into agent transcripts; workspace_digest unpopulated; distillation template-heuristic. Queued: H1b UI panel, live export->cloud->import smoke.

# H2 — BYOK Provider Routing (roles plan/act/utility)

## Research base (verified 2026-08-23)
1. **VS Code BYOK 2025-10 → 2026-06**: user's own API keys per provider (OpenAI/Anthropic/OpenRouter/Gemini/Azure/Mistral/Ollama/Foundry Local/custom OpenAI-compatible); models land in the SAME chat picker; covers chat + agent workflows + **utility tasks**, never completions. Config = provider-level {name, apiKey, apiType: chat-completions|responses|messages} + model-level {id, url, toolCalling, vision, maxInputTokens, maxOutputTokens}; `${input:...}` input variables keep raw keys out of committed json; custom-endpoint vendor covers any OpenAI-compatible URL (this is the ONE wire protocol AIDE needs).
2. **Utility model concept**: lightweight background models for titles/commit-msgs/rename suggestions; when absent, product must prompt to configure (`utilityModel`). Maps to AIDE roles: **plan / act / utility** — three slots, each routable to local GGUF (default) or a BYOK provider model.
3. **keytar is DEAD** (archived, unmaintained since 2022; Copilot got governance alerts over it). Successors: Electron safeStorage (DPAPI on Windows), @napi-rs/keyring (native Rust — VIOLATES AIDE no-native-deps law), or direct DPAPI. **AIDE choice: DPAPI via PowerShell bridge from the Node daemon** — `[Security.Cryptography.ProtectedData]::Protect/Unprotect`, CurrentUser scope, ciphertext base64 in `<home>/.aide/secrets.json`; machine+user-bound without shipping native binaries. Non-Windows fallback: explicit 'none' backend that REFUSES key storage with typed error (never silently plaintext).

## Design
```
common/contracts/byok.ts   ProviderConfig {id,name,baseUrl,apiType:'chat-completions'|'anthropic-messages',modelId,maxInputTokens?,toolCalling?}
                           RoleRouting {plan?:{providerId,modelId}|'local', act?:..., utility?:...}
                           ByokStatusResponse, ProviderListResponse (NO key material ever leaves store),
                           KeyPutRequest {provider_id}, KeyDeleteRequest, EgressConsent {enabled:boolean}
services/secret-store.mjs  createSecretStore({secretsPath}) — dpapi backend via spawnSync('powershell.exe',
                           ['-NoProfile','-NonInteractive','-EncodedCommand', b64]) Protect/Unprotect;
                           set/get/delete/list(providerIds only); refuses plaintext backend with NOT_SUPPORTED
                           unless env AIDE_ALLOW_PLAINTEXT_SECRETS=1 (CI/dev only)
services/byok-service.mjs  createByokService({workspace,secretStore,egress}) — providers CRUD (config sans key,
                           .aide/byok/providers.json atomic), role routing (.aide/byok/routing.json),
                           resolveChatFn(role) -> local chatFn | provider chatFn (fetch POST baseUrl/chat/completions,
                           Authorization Bearer <key fetched at call time>, timeout, egress journal entry BEFORE call,
                           breaker hooks for resilience R), status()
routes/byok.ts             GET /api/byok/status; GET /api/byok/providers; PUT /api/byok/providers/set;
                           DELETE /api/byok/providers/delete?id=; PUT /api/byok/key {provider_id} (body only,
                           response {stored:true}); DELETE /api/byok/key; GET/PUT /api/byok/routing;
                           POST /api/byok/test {provider_id} -> ping models endpoint w/ journaled egress
```
Laws: keys NEVER appear in route responses/logs/journal (journal records provider_id + host only). Egress ONLY after user stores key AND sets routing AND consent flag — default remains local-only offline. Agent loop integration: BuildRoutesOptions gains byokService; agent start resolves chatFn per requested mode (plan->routing.plan ?? local).

## Tests FIRST
unit test-h2-byok.mjs (fake secret store): provider CRUD roundtrip sans key leakage; routing set/get validation; resolveChatFn local default; provider chatFn injects bearer + journals egress before fetch (inject fetchImpl); test connection happy/fail. arch byok-routes.test.ts: contract shapes, key put returns no material, status reflects stored keys as booleans, dpapi refusal path (env unset) surfaces typed error. Veritas: no secret-shaped literals anywhere (runtime concat if needed).

## Gate
Unit+arch green, CI green, veritas PASS locally first (secret-scan lesson). Journal + roadmap DONE. Queued: H2b UI (provider manager panel, role dropdowns, key masked input), live smoke against real provider WITH user consent.
