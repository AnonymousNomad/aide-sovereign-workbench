---
name: aide-house-model
description: The House Model — AIDE's fluid, self-improving engine system. Static capable base + per-user LoRA adapters trained on verified in-AIDE trajectories, hot-swapped via llama.cpp /lora-adapters, gated by battery regression before promotion, plus [learned] context blocks for instant effect. Use when designing the learning loop, choosing base models, building the train->gate->promote pipeline, or answering 'can the model improve from use'.
---

# House Model — The Fluid Engine

Operator vision 2026-08-25: not static GGUFs — a capable model in a closed
loop with guardrails and SOPs that reinforces itself, learns from mistakes,
and becomes a better developer the more it is used. Laptop-class hardware.

## Verdict (research-grounded, not hype)

POSSIBLE, in three tiers of increasing depth. Evidence:
1. **In-context tier**: Lost-in-the-Middle/ICL literature + our own drift hook
   prove models condition on injected rules; [learned] blocks = accumulated
   operator-specific rules injected per request. Zero training needed.
2. **Adapter tier (THE fluid layer)**: llama.cpp natively supports unmerged
   LoRA adapters — POST /lora-adapters hot-swap measured sub-20ms (Medina 14B
   production benchmark, May 2026); rank-32/alpha-64 ≈ 500MB f16 adapters;
   base stays resident in VRAM; multiple adapters coexist; aLoRA PR #15327
   adds invocation-triggered adapters without cache clears.
3. **Weights tier**: RLVR study (2605.30478) shows 0.6B–1B models gain +13pp
   pass@1 from unit-test-reward LoRA training — small models DO learn from
   verification feedback, which is exactly what AIDE's gates produce.

## Base model decision (laptop-class, Aug 2026)

Primary: **Qwen2.5-Coder-7B-Instruct** (Apache-2.0) — coder-specialized
(matches Feedback-Over-Form finding: code-specialized beats general pipelines),
q4_K_M ≈ 4.7GB fits 6GB VRAM with adapter+KV headroom, huge GGUF ecosystem.
Alternatives: Qwen2.5-Coder-3B (RAM-tight machines), Qwen3-4B, SmolLM2-1.7B
(weak cognition, fast). License clean for adapter distribution.

## The Learning Loop (three tiers feed one another)

```
USE -> gates verify every outcome -> events.jsonl (Loop C capture)
     -> [learned] blocks inject instantly                    (tier 1)
     -> nightly QLoRA on verified trajectories               (tier 2)
        -> battery regression gate BEFORE promote
        -> adapter vN+1 hot-swaps in (<20ms)
     -> corpus grows; full FT milestone later                (tier 3)
```

## Training pipeline (per adapter version)

1. Distill events.jsonl -> dataset (anti-trash filters apply; replay mix with
   general instruction data against catastrophic forgetting).
2. QLoRA rank-32/alpha-64 (Medina-validated config) on OPERATOR schedule
   (overnight); 6GB VRAM = train on CPU+offload or accept tiny batches —
   OR train on a second machine; adapters are portable files (~500MB f16).
3. convert_lora_to_gguf.py -> adapter GGUF -> BATTERY GATE: full 20-task run,
   delta >= 0 required to promote; else archive with reason.
4. Promote = registry entry + hot-swap via /lora-adapters (no restart).

## Threats

| Threat | Control |
|---|---|
| Catastrophic forgetting | replay mix + battery non-regression gate |
| Regression promoted | battery gate is mandatory pre-promote; versions immutable |
| Adapter/base mismatch | intermediate_size compatibility check before load (Medina lesson) |
| Training starves serving RAM | P7 one-job law; train overnight, serve by day |
| Garbage-in flywheel | only VERIFIED outcomes enter datasets (harness gates upstream) |
| Overfitting to one user's quirks | cap adapter rank; periodic base re-eval battery |

## Build order

HM1: events.jsonl capture wiring (Loop C v0) — prerequisite, feeds tiers 1+2.
HM2: [learned] injection (tier 1 live).
HM3: dataset curation script + QLoRA training wrapper (device-training-1060 laws).
HM4: adapter registry + battery-gated promotion + hot-swap integration.
HM5: multi-adapter roles (planner/coder personas via aLoRA invocation tokens).

## Honest limits

Nightly LoRA on 6GB VRAM yields small, incremental gains — expect weeks of
compounding, not step-changes. Quality depends entirely on capture volume and
gate strictness. If usage is too sparse to train, tiers 1+3 still deliver value.
