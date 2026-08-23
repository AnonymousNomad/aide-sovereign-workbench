---
name: coherence-nlp-training
description: Best practices for training small-from-scratch models to achieve natural language processing (NLP) coherence. Use whenever training or fine-tuning a small model where coherent, general-purpose language understanding is the target, not just domain-specific or output-format generation. Research-grounded in Big Tech small-model pipelines (SmolLM, phi, TinyLlama), catastrophic-forgetting literature, and scaled training recipes.
---

# Coherence-NLP Training — Best Practices for General-Language Capability in Small Models

## The Problem (why small models often fail at NLP)

Small models trained from scratch frequently produce incoherent language or fail at general NLP tasks because:

1. **Catastrophic forgetting:** narrow-domain fine-tuning erases general knowledge learned during pretraining (research: scaling laws for forgetting, phi-4 forgetting analysis).
2. **Curricular imbalance:** when the corpus lacks general language diversity (e.g., web, books, science) and overrepresents a narrow task, the model learns to optimize for that narrow pattern, not general comprehension.
3. **Model capacity limits:** small models need enough data to develop broad mental models of language — a tiny corpus cannot cover the combinatorial space of grammar, semantics, and reasoning.
4. **No negative curriculum:** a pure expert model (e.g., coding only) will not learn to "unlearn" or generalize; interleaving diverse data is essential.

## The Core Recipe (what Big Tech research prescribes)

### 1. Multi-stage training with data curricula (SmolLM2, phi-4, TinyLlama pattern)

**Stage 1 — Foundation:** Broad, high-quality, balanced data covering the whole language spectrum.
- Source mix (from HF/Dharma-AI Specialization Beats Scale and Toloka frontier-lab): web text (~60-85%), academic/science (~10-15%), code (~5-15%), math (~5-15%), instruction/dialog (~2-5%).
- Data quality: use curated, filtered datasets (FineWeb-Edu, DCLM, FineMath, Stack-Edu, SlimPajama-2B).
- Token budget: 11-14T tokens for a 1.7B-3B model, spread across multiple epochs with decreasing learning rate.

**Stage 2 — Specialization (mid-training):** Add task-specific, reasoning-intensive data.
- Sources: OpenThoughts3, MMLU, Hellaswag, reading comprehension, dialogue corpora.
- Goal: improve reasoning, multi-step logic, and domain transfer while retaining the foundation.

**Stage 3 — Alignment:** Instruction tuning, DPO, or RLHF using quality-filtered preference data.
- Use synthetic data generation only as a supplement; most DPO pairs should be human-verified or LLM-verified with chain-of-thought verification.

### 2. Prevent catastrophic forgetting with replay and annealing (research: finetuner's fallacy, replay and gradient alignment)

**Replay (subsample pretraining data):**
- At the end of each stage, replay a fraction (1-10%) of the original pretraining data to reinforce retained knowledge.
- Evidence: phi-4 and SmolLM2 both report that replay reduces forgetting and improves downstream NLP performance.
- Implementation: in the same training loop, after the specialization data, insert a mini-epoch on a reservoir of representative pretraining examples (e.g., 100k random samples).

**Annealing (curriculum decay):**
- Gradually reduce the weight of the specialization data and increase the weight of general data in later stages.
- Goal: prevent the model from overcommitting to narrow patterns before it has a broad foundation.

### 3. Balanced loss weighting (training-from-scratch skill)

Use a loss schedule: early phases emphasize next-token prediction on the foundation mix, later phases add task-specific loss with lower weighting.
- Example: for a 3B model trained on 11T tokens, 85% foundation tokens in stages 1-2, then 70% foundation + 30% specialized in stage 3, with a linear annealing to 50/50 by the end.

### 4. Data filtering and quality gates (anti-trash-data-doctrine + verification-complete)

Every corpus entry must pass the 5-gate KD pipeline:
1. Format gate: parses correctly.
2. Parsing gate: AST valid.
3. Scoring gate: passes quality classifier.
4. Reference gate: unique in the corpus.
5. Verification gate: AST-verified, score > threshold.

Synthetic data: generate only through verified pipelines (e.g., multi-agent prompting with chain-of-thought verification). Never feed unfiltered scraped data.

### 5. Coherence-specific evaluation (beyond perplexity)

Use a multi-metric battery to measure NLP coherence:
- **Perplexity** on diverse test sets (BoolQ, HellaSwag, MMLU, PIQA, winogrande).
- **Reading comprehension** (RACE, QuAcA, etc.) and reasoning (commonsense QA, logical deduction).
- **Cross-domain transfer**: fine-tune on one task, evaluate on another.
- **Self-consistency**: generate multiple answers to the same prompt and measure consistency.
- **Closed-loop verification**: use the dual-mind verification harness (Spock + Sheldon) to verify that the model's reasoning is coherent, not just plausible.

### 6. Training pipeline infrastructure (use the training-from-scratch skill)

**Data curation:** use the SmolLM recipe (the data mixture table from SmolLM3 blog) and the phi-4 filtered web + synthetic mix.

**Training loop:** use the same training regime as SmolLM2/phi-4 (AdamW, warmup, cosine annealing, flash attention if possible, mixed precision).

**Evaluation:** after each stage, run the verification battery; before promoting a checkpoint, run the full gate matrix (honest, format, novelty, safety, full-stack).

## Key Decision Points (where to intervene)

### When to use this skill:
- A small model (≤5B parameters) is being trained from scratch and is expected to handle general language tasks.
- The model shows signs of narrow behavior (e.g., good on code, terrible on commonsense).
- The data corpus is under-diversified or dominated by a single domain.

### When NOT to use this skill:
- If the mission is explicitly narrow (e.g., medical coding only), use domain-specific training.
- If compute is extremely constrained (<1B tokens), prioritize the core foundation mix only.

### What to watch for (danger signs):
- Loss on the foundation validation set starts increasing mid-stage (catastrophic forgetting).
- Downstream NLP scores degrade after adding specialization data.
- Coherence probe (coherence_probe_150.py) shows failure on free-form language tasks.

## Implementation Examples (from Big Tech)

### SmolLM2 (1.7B) pipeline (used in SmolLM3 blog):
- Stage 1 (0-8T): 85% web (12% multilingual), 12% code, 3% math.
- Stage 2 (8-10T): 75% web, 20% code, 5% math.
- Stage 3 (10-11T): 63% web, 24% code, 13% math + reasoning.
- Mid-training for reasoning on OpenThoughts3 (35B tokens).

### phi-4 (14B) pipeline:
- Pretraining: synthetic-heavy (30% web rewrites, 40% synthetic), 20% filtered web, 10% targeted acquisitions, 20% code.
- Post-training: SFT + DPO with curated preference data.

## The Loop for Coherence-NLP (same as the overall workflow)

1. Research the task from primary sources before touching code.
2. Build the data/training/code change.
3. Verify with the REAL test battery (verification-complete skill), never smoke tests.
4. Record the measured evidence in AGENT_NOTES.
5. Report observations, not expectations.

## References (sources used)

- Hugging Face / Dharma-AI: "Specialization Beats Scale" (2025) — the 3B specialist vs. frontier APIs.
- SmolLM3 blog: multi-stage training recipe with data mix.
- phi-4 technical report: synthetic data generation, data mixture, forgetting analysis.
- Toloka frontier-lab data-blend research: six categories for frontier models.
- NASA SWE-066/SWE-104/SWE-191 + NASA-GB-8719.13: test levels, independent verification, requirements traceability.
- Verification-Complete skill: full end-to-end verification, state checking, boundary tests.
- Training-From-Scratch skill: curriculum, hyperparameters, monitoring, spike recovery.

## Quick Start Checklist

- [ ] Define the foundation data mix (web: 60-85%, academic: 10-15%, code: 5-15%, math: 5-15%).
- [ ] Filter all data through the 5-gate KD pipeline; synthetic data must be AST-verified.
- [ ] Design a three-stage training with replay of 5% pretraining data at the end of each stage.
- [ ] Set up the verification battery for coherence (perplexity, reasoning, reading comprehension).
- [ ] After each stage, run the verification battery; before checkpoint promotion, run the full gate matrix.
