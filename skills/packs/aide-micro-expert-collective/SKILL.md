---
name: aide-micro-expert-collective
description: Design and build AIDE's Micro-Expert Collective — thousands-scale registry of distilled 1K-10K-parameter specialist decision modules (routers, gates, classifiers, checkers) trained from the primary in-house model's recorded behavior, activated by response-threshold allocation over shared reinforcement signals, managed in hot/cold residency tiers with performance-based retention. Use when building, extending, or auditing any micro-expert capability.
---

# Micro-Expert Collective (MEC)

## MISSION

Multiply the primary in-house model's judgment across thousands of narrow decisions without invoking it. Each micro-expert is a 1K–10K-parameter distilled module that answers ONE recurring question (route/gate/classify/score/check) in microseconds on CPU, bound to built-in tool actions. The primary model remains the only generator; the collective supplies instant, cheap, parallel judgment.

Why this way: agentic systems spend most invocations on repetitive narrow calls (NVIDIA SLM-agent position paper, arXiv 2506.02153). Serving those from a 4B generator wastes the scarcest resource (GPU tokens/sec). Distilled micro-heads cost ~0 to serve and scale in count, not size.

## RESEARCH BASE (verified 2026-08-25)

| Source | Established | Rule adopted |
|---|---|---|
| NVIDIA, "Small Language Models are the Future of Agentic AI" (2506.02153) | Agentic workloads are dominated by repetitive specialized invocations; heterogeneous systems (small specialists + big reasoner) are the natural design; paper outlines an LLM→SLM conversion algorithm | Narrow recurring decisions go to micro-experts; generation never leaves the primary |
| Agent Distillation (NeurIPS 2025) | Full task-solving BEHAVIOR (not just CoT) transfers via distillation; 0.5B agents match next-tier CoT-distilled models when tools included | Distill from recorded tool-using trajectories, not chat text |
| MoRSE (2608.09251) | (role, subtask)-conditional LoRA experts + prototype-based semantic router + two-layer credit assignment stabilizes co-optimization | Router scores experts against per-expert prototypes; keep expert quality and routing quality as SEPARATE metrics |
| MoRAgent (2512.21708) | Role factorization (reasoner/executor/summarizer); rule-based role gate + learned routers; balance + orthogonal losses prevent expert collapse | Registry enforces one-role-per-expert declarations; balance stats monitored |
| The Avengers (AAAI 2026) | embed → cluster → score → vote routing lets small-model collectives beat frontier models on 15 benchmarks | Query embedding routes to expert cluster; voting for ambiguous bands |
| Dorigo/Bonabeau ant-algorithm foundations (FGCS 2000) | STIGMERGY: coordination via environment-carried variables (accumulate + decay); RESPONSE THRESHOLDS: specialists engage below threshold, generalists above as stimulus rises; properties = flexibility, robustness, decentralization, self-organization | Shared signal store IS the coordination medium; no direct expert-to-expert messaging ever |
| MIT CSAIL task allocation (DISC 2014) | Constant-memory workers sensing only BINARY feedback (deficit/surplus) converge near-optimal in O(log colony size) | Allocation reads a single boolean per domain ("needs more capacity?"), not numeric load reports |
| Ecology-driven specialization (Swarm Intelligence 2020) | Harsh environments force strong specialization; weakly-specialized collectives can OUTPERFORM fully-specialized ones | Experts may hold overlapping domains; do not enforce exclusive territories |
| APEX (2608.11688) / MoE-SpAc (2603.09983) / SMoE (2508.18983) / DALI (2602.03495) | Hot/warm/cold expert residency; utility-scored prefetch and eviction; substitution of cold experts by similar warm ones; workload-aware replacement beats LRU | At our parameter scale residency is trivial (see PITFALLS) but UTILITY SCORING and WORKLOAD-AWARE retention transfer directly |

Honest novelty statement: 1K–10K-param decision heads are standard ML artifacts (probes, distilled routers). The contribution here is operational: a registry + distillation loop that turns the primary model's own recorded decisions into a governed fleet, using colony-computing allocation rules.

## ANATOMY OF A MICRO-EXPERT

```jsonc
// .aide/experts/<name>.json — self-contained, human-inspectable
{
  "name": "diff-risk-gate",
  "role": "gate",                      // route | gate | classify | score | check
  "domain": "agent.proposal.diff",     // dotted domain key (allocation namespace)
  "input_features": ["lines_added", "lines_removed", "files_touched",
                     "has_test_change", "touches_auth", "cyclomatic_delta"],
  "classes": ["low", "review", "block"],
  "architecture": { "type": "mlp", "hidden": [16], "activation": "tanh" },
  "weights": { "W1": [[...]], "b1": [...], "W2": [[...]], "b2": [...] },
  "meta": {
    "trained_at": "<iso>", "train_rows": 1200, "val_agreement": 0.97,
    "primary_model": "<cipher-id>", "version": 3
  }
}
```

Runner contract (`harness/micro-experts.mjs`, zero deps):
- `load(name)` → cached parse; `infer(name, features) → {class, confidence}`
- Forward pass: dense+tanh layers, softmax output — ≤60 lines of JS
- Weights stay plain JSON (a 10K-param fp32 head = ~40 KB; load < 1 ms — no binary format, no quantization needed)

WHY plain JSON: inspectability is a trust surface (operators audit what gates their code), sizes are trivial at this scale, and diffability makes retraining reviews readable. Binary formats buy nothing here.

Tool binding: each `role` maps to built-in actions (route→domain dispatch; gate→approve/block callback; classify→tag emitter; check→pass/fail verdict into Veritas evidence). Binding declared in the manifest's `role`; execution stays in daemon services, never inside the expert.

## DISTILLATION PIPELINE (no pretraining, no retraining of any base)

1. HARVEST — labeled rows come from streams we ALREADY record: agent-loop `.traj.json` outcomes, desktop-control trajectory rows (with mechanical assertions), telegram-brain proposal/confirm rows, memory-spine events. Every row already carries observation features + verdict.
2. LABEL — supervision = the PRIMARY MODEL's own decision (or the mechanical assertion) on that row. We are cloning the queen's judgment, so teacher labels are free and continuous.
3. TRAIN — CPU-only, seconds: standard cross-entropy on the feature vector → class. Feature extraction functions live next to the harvest sites so train/serve use identical transforms (train-serve consistency law).
4. VALIDATE GATE — held-out split must show ≥95% agreement with primary labels AND zero class-collapse (each class F1 ≥ 0.85 where classes have support). Fail → more data or narrower domain; NEVER ship a drifting expert (R3 analog).
5. DEPLOY — write JSON into `.aide/experts/`, bump version; registry hot-reloads by mtime watch.

Rejection-recovery examples (refusals, overrides) ARE valid training rows — the collective must learn boundaries, not just happy paths.

## ACTIVATION & COORDINATION (colony rules, technical form)

- STIGMERGIC SIGNAL STORE: `.aide/experts/signals.json` holds per-domain counters `{invocations, agreements, disagreements, last_used}` — written by the runner after every inference against its eventual ground truth. Experts coordinate ONLY through these environment variables; no direct messaging exists in the protocol.
- RESPONSE-THRESHOLD ACTIVATION: each expert declares `threshold` per domain signal; when a request's routed signal intensity exceeds it, the expert activates. If the designated expert is absent/frozen, rising stimulus recruits the next-lowest-threshold covering expert (Bonabeau reallocation — graceful degradation without central control).
- BINARY-FEEDBACK ALLOCATION: capacity planner reads only booleans (`domain_overloaded?`) per domain — per MIT CSAIL result this suffices for near-optimal spread; numeric load reporting is explicitly NOT required and adds failure modes.
- OVERLAP ALLOWED: domains may be covered by multiple experts (ecology paper: weak specialization can beat strong). Selection among overlapping experts = highest utility score wins; ties → newest validation stamp.

## RESIDENCY & RETENTION (freeze/prune laws)

- HOT: parsed weights cached in the runner Map (default for experts hit in the last session window).
- COLD: file on disk, unloaded — "frozen" state costs one stat() call. At 40 KB there is no need for prefetch pipelines (APEX/DALI machinery targets billion-param experts; adopt their UTILITY METRICS, discard their I/O machinery).
- FREEZE rule: expert unused for N sessions OR utility (agreement-weighted invocations, decayed) below floor → moved to `.aide/experts/dormant/`. Frozen experts still answer registry queries ("this domain HAS a specialist") and thaw on demand.
- PRUNE rule: val_agreement drops under 0.90 against CURRENT primary outputs on fresh rows (the queen evolves; a stale clone is worse than none) → expert retired to `archive/` with provenance. Re-distillation always possible from retained rows.
- All transitions journaled to the memory spine (kind:'expert').

## FIRST THREE EXPERTS (build order)

1. `task-router` (role=route, domain=orchestrator.intent) — classes: code/debug/business/research/question. Features: message length, verb flags, path mentions, history depth. Trained from describe-box → phase-router labels.
2. `diff-risk-gate` (role=gate, domain=agent.proposal.diff) — low/review/block. Trained from approval-card outcomes (approved/rejected + assertion results). Feeds Veritas evidence as an advisory signal — NEVER auto-blocks (approval law unchanged).
3. `request-intent-classifier` (role=classify, domain=telegram.message) — business/code/system. Trained from telegram-brain /ask rows. Lets the bridge answer pure questions locally without waking the generator.

## PITFALLS / THREATS

- Label drift: if the primary model updates, ALL experts silently rot. Mitigation: periodic re-validation sweep (scheduled task lane) comparing each hot expert against fresh primary outputs; retirement is cheap by design.
- Feature skew between train and serve: extractors must be ONE function imported by both paths — duplicated extractors are the #1 silent killer of distilled heads.
- Over-trust creep: a 97% gate will still misjudge; gates ADVISE, approvals decide (Veritas hierarchy unchanged). Never let a micro-expert be the sole authority for a destructive class.
- Class imbalance from skewed logs (mostly-approved history trains a yes-bias): rebalance or reject at validation (per-class F1 floor exists exactly for this).
- Registry sprawl: hundreds of overlapping low-utility experts degrade allocation speed and auditability — retention laws exist to be ENFORCED, not decorated.
- Security: expert files are trusted local artifacts like manifests; treat external-supplied expert packs like plugin packs (trust gate before load — plugins doctrine applies).

## DEPENDENCIES

None new. Node stdlib only (fs, crypto for hashing). Training uses a ≤100-line SGD loop in the same module (CPU, seconds). No native modules, no Python, no GGUF tooling.

## VERIFICATION BATTERY (`scripts/experts-battery.mjs`)

1. Runner determinism: same inputs → byte-identical inference results across runs.
2. Round-trip: synthetic dataset (500 rows, 3 separable classes) → train → val agreement ≥0.95 on held-out → deploy → infer matches labels.
3. Cap enforcement: architecture >10K params rejected at save.
4. Threshold reallocation: remove active expert → signal rises → backup expert engages within one cycle.
5. Freeze/prune: utility floor breach → dormancy transition journaled; thaw-on-demand restores service.
6. Train-serve consistency: extractor function identity asserted (same module reference both paths).
7. Evidence: every transition and every gate decision lands in memory spine.
Gate: all green + one LIVE end-to-end demo — a describe-box message routed by `task-router` picks the same phase the primary model would pick, observed through :4777.
