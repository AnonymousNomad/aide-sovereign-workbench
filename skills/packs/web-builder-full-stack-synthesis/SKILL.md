---
name: web-builder-full-stack-synthesis
description: Govern the full FSI-FELON website and Shopify builder mission by connecting human behavioral science, ethical power analysis, psychology-informed usability, cybersecurity, accessibility, design, Shopify APIs, backend logic, and verified deployment through one closed loop. Use for every capability, data, architecture, training, and production decision.
---

# Web Builder Full-Stack Synthesis

The product is not a model that emits pretty text. It is a verified system that
turns incomplete human briefs into safe, beautiful, functional websites and
Shopify applications, while knowing what it cannot implement.

## Mission Contract

The system must connect, not separately memorize:

- human incentives, trust, power, persuasion, deception, and autonomy;
- psychology-informed cognitive load, clarity, error recovery, and accessibility;
- psychiatry-adjacent safety principles only (consent, uncertainty, cognitive
  burden, no diagnosis or mental-state inference);
- cybersecurity threat modeling, secure defaults, trust boundaries, and abuse
  resistance;
- web visual language, responsive interaction, performance, and novelty;
- Shopify theme, app, API, auth, data, webhook, Function, deployment, and
  observability contracts.

The model proposes. Typed intermediate representations, compilers, official
schemas, deterministic verifiers, browsers, and human review decide what ships.

## Research and Rights SOP

Use a source hierarchy:

1. Official platform specifications and versioned docs (Shopify, W3C, OWASP,
   CISA, NIST).
2. Open textbooks and primary academic sources (OpenStax, NCBI/NIH, Stanford
   Encyclopedia of Philosophy, peer-reviewed research).
3. Public-domain primary works (for example, Project Gutenberg's *The Prince*).
4. Licensed or explicitly permitted datasets and examples.

For copyrighted works such as *The 48 Laws of Power* and *The Laws of Human
Nature*, use concept labels, independent summaries, citations, and original
examples only. Do not ingest or reproduce the books as training text without
rights. Every research item records URL, version/date, rights status, extracted
concept, and how it becomes a safe design or security test.

## Connected Closed Loop

1. **Brief intake**: sanitize input, identify user goal, audience, constraints,
   budget, data, platform, and missing decisions.
2. **Human-systems analysis**: Spock maps goals, incentives, trust boundaries,
   cognitive needs, and legitimate persuasion; Sheldon independently red-teams
   manipulation, unsupported claims, security, accessibility, and power abuse.
3. **Freestyle design**: produce a small set of structurally different directions
   from limited information, state assumptions, distinguish supplied facts from
   placeholders, and ask only high-value questions. Never turn missing facts into
   invented testimonials, metrics, authority, urgency, or integrations.
4. **Capability routing**: map each requested feature to a registry entry and
   choose website, Shopify theme, app, API, webhook, Function, or escalation path.
5. **Typed plan**: emit a versioned full-stack IR describing pages, components,
   data models, API contracts, auth/scopes, events, integrations, tests, and
   deployment requirements.
6. **Compile**: generate deterministic HTML/CSS/JS, Shopify theme files, app
   extension scaffolds, GraphQL queries, backend handlers, and test fixtures from
   the IR. Do not let free-form model output directly become production code.
7. **Verify**: run parsers, Theme Check, JSON/schema validation, Liquid escaping,
   GraphQL/schema checks, webhook HMAC/idempotency tests, Function resource tests,
   browser tests, WCAG/COGA checks, ASVS checks, and human-systems audit.
8. **Repair**: feed exact verifier failures back through a bounded retry loop;
   preserve every attempt and never train on an unverified failed output.
9. **Release or escalate**: release only a complete artifact pack with hashes,
   evidence, and rollback metadata; otherwise return a specific missing
   capability/connector/tool escalation.

## Full-Stack Shopify Surface Gates

Every full Shopify request must explicitly cover applicable surfaces:

- storefront theme or Storefront API/Hydrogen UI;
- layout/templates/sections/blocks/snippets/assets/config;
- app/admin UI and App Bridge;
- Admin GraphQL queries/mutations and scopes;
- managed installation, session tokens, and token exchange;
- metafields/metaobjects with typed ownership/access;
- theme app blocks/embeds;
- webhooks with HMAC verification, duplicate suppression, ordering tolerance,
  and reconciliation jobs;
- Shopify Functions with versioned GraphQL input/output, deterministic runtime,
  and resource limits;
- deployment, environment secrets, monitoring, rollback, and contract tests.

Payment customization may use Shopify's platform Functions. Card handling,
credential storage, fake payment success, or checkout impersonation is always
outside the model's generated code boundary.

## Unknowns and Escalation

The model must say `UNSUPPORTED` or `REVIEW_REQUIRED` when a feature lacks a
verified compiler, current official contract, connector, credential, or fixture.
An escalation contains the missing capability, security boundary, required
connector/tool, safe next action, and whether a larger model or human engineer is
required. “Plausible Liquid” is not a pass.

## SOTA-for-Class Gates

Do not call the system production-ready for the full mission until a fixed,
versioned matrix passes:

- standard and novel website briefs;
- limited-information freestyle briefs with assumption accuracy;
- Shopify theme sections/templates/blocks/products/cart flows;
- Storefront API and Admin GraphQL contracts;
- app/admin surface and authentication scaffolds;
- metafields/metaobjects;
- webhooks and reconciliation;
- Shopify Functions within resource limits;
- accessibility/cognitive-load and security stress cases;
- unsupported app/payment/custom-backend requests.

Metrics include artifact compile success, Theme Check, browser console/errors,
responsive behavior, WCAG/COGA checks, ASVS checks, novelty, user-goal fidelity,
claim accuracy, human-safe acceptance, escalation precision, latency, and
reproducibility. A visual score cannot override a security or capability failure.

## Model and Adapter Policy

- Keep the frozen base as the general planner and envelope authority.
- Use the web adapter for web/design behavior; add capability adapters only after
  a measured gap and verified training/eval data exist.
- Retrieval supplies current platform facts; adapters supply learned behavior;
  compilers and tools supply exact implementation.
- One request uses one explicit adapter route unless a tested composition policy
  proves clean interference and train/serve parity.
- The bounded debate trace records explicit Spock/Sheldon outputs, markers,
  evidence, and synthesis. It reports unknown when disagreement reasons were not
  explicitly emitted; it never fabricates hidden chain-of-thought.

## Required Artifact Pack

Every real task produces: brief hash, route, adapter, IR, source/output files,
verifier versions/results, browser screenshots, security/accessibility findings,
latency/memory, hashes, and escalation status. Public posting happens only after
the user approves the destination and exact artifact/copy.
