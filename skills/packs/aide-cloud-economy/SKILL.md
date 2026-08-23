# C — Cloud Economy (distilled intent, tiered execution, budget governor, provider efficiency)

Phase skill for the C-series. Master router: aide-master-roadmap. Governs EVERY interaction with paid cloud tokens. Core principle (collaborator directive): **the cloud model receives distilled intent, never raw conversation** — the harness does filtering/compression/routing so the user pays for cognition, not context overhead. Position in roadmap: sits on top of H2 (provider registry) and R (resilience ladder); feeds I (orchestrator metrics). Depends on: H2 key/config store, R capability state + escalation ladder, X2 Veritas gates, V1 egress log, A2 index (for relevant-context slicing).

Research base (2026): FrugalGPT (arxiv 2305.05176 — LLM cascade: cheap model first, scorer judges reliability, escalate only when unreliable; up to 98% cost reduction matching GPT-4; load-bearing component = the judge). RouteLLM (arxiv 2406.18665 — router decides BEFORE generation; MF router cuts cost ~85% keeping 95% of strong-model quality; calibrate threshold on OWN traffic). Cascade-vs-router doctrine (2026): cascades win when output is CHEAPLY VERIFIABLE (code parses/typechecks/tests pass — exactly our Veritas ladder); escalation rate is a property of the JUDGE, not task difficulty; documented failure = broken verifier silently escalating ~90% of traffic; escalation rate belongs on a dashboard with alerts; escalation is an attack surface (injected text ordering "use the stronger model" drains budget). UCCI: calibration-first routing on token margins, 31% cut. ICML 2025 unified cascade-routing framework: quality estimators are THE critical factor. Prompt-caching economics (OpenAI + Anthropic docs): cache reads 0.1x input; writes 1.25x (OpenAI GPT-5.6+/Anthropic 5m) or 2x (Anthropic 1h); min cacheable prefix 1024-2048 tokens; usage fields `cached_tokens`/`cache_read_input_tokens`/`cache_creation_input_tokens`; keep instructions/tools/schemas STABLE, request-specific content AFTER the reusable prefix; reuse `prompt_cache_key` for shared prefixes. Mem0: structured memory extraction cuts token spend ~90%.

## The Law

**Distilled-Intent Law**: no raw conversation transcript ever crosses to a paid API. Every cloud call carries a machine-built brief (C1), routed by tier policy (C2), charged against a budget ledger (C3), using a per-provider efficiency profile (C4). A call that cannot state its tier, brief hash, and estimated cost BEFORE firing is a bug.

## 1. C1 Context Distillation Pipeline

The brief builder converts session state into a structured, deterministic, cache-friendly document:

```ts
CloudBrief = {
  schemaVersion: 1,
  intent: string,                    // one paragraph: what the user wants NOW
  taskType: 'plan'|'act'|'review'|'utility',
  repoContext: {                     // sliced by A2 retrieval + tree-sitter symbols
    files: FileSlice[],              // relevant chunks w/ path+range, NOT whole files
    symbols: SymbolRef[],
    diagnostics: Diagnostic[],       // live problems touching the slice (B2 feed)
  },
  planState: { steps, currentStep, decisions[] },  // agent-loop state, NOT chat history
  recentOutcomes: Outcome[],         // last N Veritas verdicts (verified facts, not prose)
  openQuestions: string[],
  budgetClass: 'must-be-right'|'cheap-ok',
  estTokensIn: number,
}
```

Rules:
- Strip: system prompts, tool schemas, failed attempts, raw logs, dead-end tangents — unless load-bearing for THIS intent (a failing test output IS load-bearing; the 10 prior wrong attempts are not).
- Stable-prefix ordering: static harness preamble -> stable repo context -> volatile tail (intent, questions). This is what makes provider prompt caches hit; reshuffle nothing between calls sharing a prefix. Set/reuse `prompt_cache_key` per session.
- Brief is hashed and stored locally (`.aide/briefs/`) BEFORE send — auditable record of exactly what left the box (No-Phone-Home compliance + user-inspectable).
- Compression target: brief <= ~15% of raw session size typical; measured per call, logged to ledger.
- PII/code gating honors H1 rule: code slices included ONLY when the user explicitly delegated code to cloud for this task.

## 2. C2 Tiered Execution Router

Route BEFORE generation (RouteLLM pattern) + cascade AFTER (FrugalGPT pattern) wherever verification exists:

| Class | Route | Rationale |
|---|---|---|
| exploration, search, summaries, titles/utility | LOCAL always | cheap-ok; H2 utility role |
| scaffolding, bulk generation | LOCAL always | volume x cost = budget death on cloud |
| first-attempt feature work | LOCAL | act role; Veritas gates judge it |
| retry-after-2-failed-verification-loops | CLOUD (rung 3 of R ladder) | must-be-right; local already proven stuck |
| high-stakes review (pre-commit, security-sensitive diff) | CLOUD or strong-local per profile | X2 gate consumer |
| architecture/planning when local planner confidence low | CLOUD | plan role escalation |

Cascade rules:
- Cloud output that is cheaply verifiable (parses/typechecks/tests pass via Veritas ladder) NEVER gets a second cloud pass. Verification replaces re-asking.
- Unverifiable output (prose plans, judgments): local review model critiques first; cloud re-check only on substantive disagreement. (Judge quality is the whole game — the judge here is deterministic gates + local reviewer, both observable.)
- Every cloud-sourced artifact is badged provider+model+cost (label output, not app — R doctrine).
- Never route to a breaker-open provider (R circuit breaker state is an input).

## 3. C3 Budget Governor

Ledger `.aide/cloud-ledger.jsonl`, append-only: `{ ts, provider, model, tier, taskType, briefHash, usage: { uncachedIn, cacheWrite, cacheRead, out }, costUsd, trigger }`.

- Cost math (cache-aware, per-provider price table from C4): `costUsd = uncachedIn*1.0 + cacheWrite*1.25 + cacheRead*0.1 + out*outRate`, all scaled by per-million rates. Exact to 6 decimals; unit-tested.
- Budgets: daily + weekly soft caps in settings. Threshold notifications at 50%/80% via B4; at 100% every further cloud call requires explicit per-call consent card ("Over budget — est $X. Send anyway? [Send] [Run locally instead]"). Never silent, never app-wide lockout (REFUSING is per-request only — R doctrine).
- Cache-efficiency tracking: hit-rate = cacheRead/(cacheRead+cacheWrite+uncachedIn). If cacheWrite stays high while hits stay low across calls sharing a session prefix -> unstable-prefix bug (something upstream reshuffles the brief); alert with the offending section identified.
- **Escalation-rate dashboard**: rolling-7d % of turns escalated local->cloud, split by taskType. Alert if total >40% (documented broken-judge symptom) or if any single type spikes vs its baseline. This number is a first-class health metric of the whole economy.
- Anti-drain guards: max spend per turn AND per session (hard stops); escalation requests originating from USER-TYPED text ("use the better model") are honored, ones injected via file/workspace content are logged and rate-limited (escalation-as-attack-surface).
- Batch-eligible work (bulk gen queues) may defer to provider batch APIs at discounted rates when latency-tolerant.

## 4. C4 Per-Provider Efficiency Profiles

`profiles/<provider>-<model>.json`: `{ priceTable: {in, cachedIn, cacheWrite5m, cacheWrite1h, out}, ctxLimit, strengths: string[], avgCostPerVerifiedSuccess: { [taskType]: usd }, acceptanceRate: { [taskType]: number }, notes }`.

- `strengths` seeded from vendor docs/benchmarks (kd-teacher-strengths envelope style: distill ONLY within verified competence), then UPDATED from own ledger: avgCostPerVerifiedSuccess and acceptanceRate recomputed from C3 data weekly (calibrate on own traffic — RouteLLM/UCCI rule; provider marketing is a prior, our ledger is the truth).
- Router selection = cheapest profile whose strengths cover the class AND whose acceptanceRate clears the floor for must-be-right work. Ties break toward lower avgCostPerVerifiedSuccess, not sticker price (a cheap model that fails verification twice is expensive).

## Integration Map

- Consumes: H2 registry/keys; R capability + breaker state; R escalation ladder (cloud = rung 3); X2 verification verdicts (cascade judge + outcomes feed); A2 index (brief slicing); B4 notifications (threshold cards).
- Feeds: I orchestrator metrics dashboard (spend, escalation rate, cache hit-rate); V1 egress log (every cloud call appears there too — two independent records must agree).
- Offline-first unchanged: with zero providers configured, everything above degrades to "local-only, ledger empty" and NO feature breaks (In-the-Box Law).

## Tests FIRST

1. Brief builder unit: raw fixture session -> brief contains zero raw turns/system prompts/failed attempts; stable-prefix ordering asserted (serialize two consecutive briefs, shared prefix length >= static+repo sections); hash deterministic.
2. Compression metric: fixture session -> brief <= 15% tokens, logged.
3. Router unit: table drives routing exactly; local-first classes go local even when cloud reachable; cloud classes blocked while breaker open; injected escalation text from workspace content does not reroute.
4. Cascade unit: verified cloud output produces no second cloud call; unverified prose triggers local-review-then-maybe-cloud path.
5. Ledger unit: cost math with cache multipliers exact; 50/80/100% threshold events fire once each; consent card blocks at cap until explicit approval.
6. Escalation monitor: synthetic ledger >40% escalations -> alert fires; per-taskType spike detection.
7. E2E (mock provider): local fail x2 -> escalation brief sent (assert brief shape, no raw turns) -> verified success -> ledger entry + output badge; over-budget -> card blocks; provider cache fields mapped (`cached_tokens` AND `cache_read_input_tokens` fixtures).
