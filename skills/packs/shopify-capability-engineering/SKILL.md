---
name: shopify-capability-engineering
description: Build and extend verified Shopify themes and web artifacts through capability routing, official-doc retrieval, deterministic compilation, Theme Check, browser validation, and explicit escalation. Use for every Shopify or custom website feature request.
---

# Shopify Capability Engineering

The model is a planner and designer. The production system is the compiler,
verifier, capability registry, and escalation boundary. Do not ask a 140M model

## Platform Contract

Shopify themes are structured artifacts:

- `layout/theme.liquid`
- `templates/*.json` and Liquid templates
- `sections/*.liquid` and section schemas
- blocks and section groups
- `snippets/*.liquid`
- `assets/`, `config/`, and `locales/`

Theme app extensions are a separate integration boundary. Metafields are typed,
namespaced data with ownership and access rules. Payment data stays at Shopify's
checkout boundary. These facts come from official Shopify documentation and must
be represented in the capability registry, not guessed by the model.

## Full-Stack Surface Map

"Full Shopify website" means the request is decomposed across all applicable
 surfaces, not treated as a theme-only prompt:

- storefront theme or headless Storefront API/Hydrogen UI;
- app/admin UI and App Bridge surface;
- Admin GraphQL queries/mutations and explicit scopes;
- Storefront GraphQL queries/cart/checkout boundary;
- authentication, managed installation, session tokens, and token exchange;
- typed metafields/metaobjects and ownership/access policy;
- theme app blocks/embeds and assets;
- webhooks with HMAC verification, duplicate IDs, ordering tolerance, and
  reconciliation jobs;
- Shopify Functions with versioned GraphQL input/output schemas, deterministic
  execution, and runtime/resource limits;
- deployment configuration, environment secrets, observability, rollback, and
  contract tests.

The model may generate the plan and scaffolds for these surfaces. It may not
invent credentials, scopes, API responses, external app behavior, or payment
state. Unsupported or connector-dependent surfaces must escalate.

## Capability Levels

Every request receives one explicit status:

- **SUPPORTED**: verified compiler + tests exist for the requested capability.
- **SUPPORTED_WITH_CONNECTOR**: a named app/API connector and credentials are
  required; the model may generate the contract, not invent live behavior.
- **REVIEW_REQUIRED**: code can be drafted but Theme Check/browser/security
  verification is unavailable or incomplete.
- **UNSUPPORTED**: no verified capability exists; return a precise escalation,
  never confident fabricated Liquid, API, metafield, or payment logic.

The capability record contains: ID, platform surface, required files, official
source URLs, validator commands, security boundary, supported test fixtures,
and escalation message.

## Production Pipeline

1. Normalize and sanitize the brief; preserve the original request hash.
2. Detect platform and capability IDs; ambiguous requests route to review.
3. Retrieve only versioned official docs and approved verified examples.
4. Have the model produce a typed theme plan, not arbitrary files first.
5. Compile the plan into the Shopify directory structure.
6. Validate JSON/JSONC, Liquid escaping, schema settings, asset references,
   forbidden secrets/payment content, accessibility metadata, and capability
   contracts.
7. Run Shopify Theme Check. Missing tooling is a BLOCKED gate, not a pass.
8. Render/preview the theme and run responsive, keyboard, contrast, motion,
   and visual novelty checks.
9. Run an independent security/human-systems audit and record all diagnostics.
10. Deliver only a verified artifact or a structured escalation report.

For a full-stack request, additionally verify authentication, scopes, GraphQL
schema/version, webhook HMAC/idempotency/reconciliation, Function resource
limits, and deployment/rollback behavior. Shopify recommends CLI scaffolding for
auth and app structure; use the official client libraries rather than inventing
protocol code.

## Adapter and Retrieval Policy

- Keep the frozen base as the general planner and envelope authority.
- Use the web LoRA for web/design behavior; add capability adapters only after a
  measured capability gap is confirmed.
- One request selects one explicit adapter route; never silently stack adapters.
- Retrieval supplies current Shopify API/version facts; adapters supply behavior,
  not live credentials or unverified documentation.
- New capability data passes the anti-trash, provenance, dedup, contamination,
  execution, and comprehension gates before training.

## Verifiers

- Shopify Theme Check: syntax, missing templates, unknown/deprecated tags,
  unused variables/snippets, and performance issues.
- Liquid safety: escape dynamic output, reject executable/script-bearing input,
  preserve checkout/payment boundaries.
- Schema verifier: valid section/block settings, IDs, types, defaults, and
  template references.
- Browser verifier: responsive screenshots, console errors, keyboard/focus,
  contrast, reduced motion, and required touch-target checks.
- Capability verifier: feature-specific fixture and negative/unsupported probe.

## Escalation Contract

When a request exceeds the verified capability set, return:

- requested capability ID;
- what is supported;
- exact missing connector/tool/data;
- security and data boundary;
- smallest safe next action;
- whether a larger model or human Shopify developer is required.

The correct answer to an unseen subscription app or complex metafield workflow is
not a plausible Liquid guess. It is an explicit escalation with a testable plan.

## Gates

- No release without Theme Check or an explicitly recorded blocked status.
- No generated app integration without a connector contract and fixture.
- No full-stack claim without a surface-by-surface contract and integration test.
- Webhooks require HMAC verification, duplicate suppression, and reconciliation;
  delivery ordering must not be assumed.
- Shopify Functions require versioned schemas, deterministic code, and resource
  budget tests; payment customization is not card handling.
- No payment, credentials, secrets, or fake API success.
- No unsupported feature marked complete.
- Every feature family has held-out paraphrase, transfer, negative, and security
  probes; memorized template variants do not count as coverage.
- Promotion requires all existing web/envelope gates plus Shopify artifact gates.
