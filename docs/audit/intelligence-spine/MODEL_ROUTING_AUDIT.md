# Model Routing Audit

## Live selection

[ModelRouter](../../../node/src/services/model-router.ts) combines local runtime inventory with built-in cloud provider routes. routeForRole filters local models with that role and uses endpoint health; fallback selects another ready local candidate. routeForId can fall back to a local role candidate when a requested route is down. chat/stream report selected model ID; agent composition discards everything except text.

[ModelRuntime](../../../node/src/services/model-runtime.ts) handles manifest/model lifecycle, identity checks, external-server adoption, warmup, hardware gates, effective context and one HTTP-400 overflow retry. These are useful mechanisms to preserve. Manifest endpoints are used directly for fetch; their “local” classification does not itself validate loopback. Startup uses loopback for spawned engines. Actual model availability was not probed in this audit.

## Provider authorities

- ProviderService: built-in providers, stored credentials, connect-time host approval and health; separate from BYOK settings. chat does not consult BYOK consent.
- BYOKService: workspace provider/routing/consent files plus secret-store adapter. Roles plan/act/utility; defaults local. resolveChatFn tests consent when creating the closure, not at each request, and fetch lacks timeout/cancellation.
- Legacy ModelManager/ProviderManager remain used by legacy Operator/Workflow. They are compatibility authorities, not the TS agent router.
- Embeddings use an environment-selected adapter in openapi.createEmbedGate, not ModelRouter/consent.
- Telegram chooses a running model, prefers an ID containing cipher, then first running model; this is not enforced in-house identity.

## Roles and review

| Label | Actual semantics |
|---|---|
| Agent plan | Tool-mode restriction and planning prompt; local model still role chat |
| Agent act | Tool mode; local model role chat |
| Architect/editor | Same callback called twice; optional, ≤8 cycles; architect tool calls can bypass the planning-only pass |
| Standalone reason/build/verify | Provider slots; no enforcement of distinct instance/model or independent review state |
| BYOK plan/act | Configuration assignments at session creation; not three-role governance |
| Subagent reviewer | Contract enum and null-service tests; not a live reviewer runtime |
| Micro-experts | Separate classifier service; confidence filter is advisory, not permission |

Correlated review is unmitigated: the same model and shared plan can supply both patch and APPROVE. Physical model reuse is reasonable on this hardware, but independent context, criteria and deterministic tests are still required. Different model names alone would not establish independence.

## Reproduced miswiring

routesForAgent only wraps expert advice when chatFnOverride exists. Local requests leave it undefined; provider mode creates it. Pure invocation of the actual route factory yielded local consults=0, provider consults=1. The existing expert test reimplements the wrapper and cannot catch that route guard.

## Resource and context risks

Router fits against effective model window when available; fallback/overflow metadata exists but agent receives only text. Local output is capped at 512 tokens, which can truncate complete tool/code output. Unknown context uses a legacy full prompt. Skill/Resident context may be measured before fitting and then discarded. Provider-backed streams are buffered responses rather than true token streaming, and caller abort is not forwarded into ProviderService chat.

No automatic download or recommendation work is needed to fix these seams. Acceptance should pin actual model identity/config per invocation, expose fallback, enforce role/tool boundaries, and verify a same-model reviewer can reject a coder result using independently gathered evidence.

