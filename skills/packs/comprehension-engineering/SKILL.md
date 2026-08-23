---
name: comprehension-engineering
description: Encoding the anti-memorization corpus doctrine. Use whenever building or scaling training data (pretraining or post-training) for a small from-scratch model and the goal is a model that UNDERSTANDS what it learns, REMEMBERS it, KNOWS it — and never merely memorizes surface patterns. Governs diversity-by-evolution, interleaving, retrieval/testing signals, reasoning-trace preservation, contrastive structure, and the near-dup audits and paraphrase-robust evals that MEASURE comprehension. Complements gold-training-docs (per-doc format), corpus-curation (inventory/mix), synthetic-data-pipeline (teacher rotation), dual-mind-reasoning-traces (trace format).
---

# Comprehension Engineering — Understanding Over Memorization

## Mission

A model that understands what it learns, remembers it, knows it — and does not
memorize it. Three distinct outcomes, three distinct measurements:

| Outcome | Definition | Failure signature |
|---|---|---|
| **Understand** | Composes known primitives into novel situations; applies a mechanism to unseen inputs | Passes cloze on training-phrased items, fails rephrased items |
| **Remember** | Retains the fact/mechanism across the whole corpus and over training time | Late-curriculum forgetting; confuses similar items trained at different times |
| **Know** | Calibrated, verifiable, boundary-aware (knows what it is NOT) | Confident wrong answers on near-distractors; no abstention signal |

Memorization is: surface-pattern matching on near-identical training text. It
produces perfect train loss, brittle eval, zero transfer. It is the #1 small-model
failure and it is **caused by corpus construction choices** — which means the fix
is also a corpus construction choice.

## The Memorization Trap (verified on this machine, 2026-08-07)

Sampling `gold_web_*.txt` (31,045 files) revealed massed near-duplicates:
- Same 8 section types in nearly every doc (nav/hero/about/testimonials/contact/footer…)
- Identical copy blocks: "Made slowly, on purpose, by people who care about the details.",
  footer "LinkedIn / Email / Journal", email "hello@studio.example"
- Only brand names, colors, and section ORDER vary between files

Per Cosmopedia (HF, 2024), dedup + diversity **decided the outcome** of their
build — near-duplicates over-train one pattern and waste budget. At small scale
this is fatal: one repeated template = a 5%+ production failure mode (Ertas).

**The doctrine: no corpus build ships a batch until it has passed a near-dup
audit. Near-duplicate count is a build-quality metric, not an afterthought.**

## The Six Anti-Memorization Levers (build into every corpus build)

1. **Diversity by evolution, not repetition.** WizardLM Evol-Instruct proved
   instruction *evolution* (deepen, diversify, add constraints, change audience)
   raises data quality above both hand-writing and massed copies. When a
   generator would emit doc N+1 by swapping a name or color, instead evolve the
   seed: change the structure, the audience, the constraint set, the worked
   example. Two docs that differ only in variable values are ONE doc of learning.
2. **Interleaving.** Bjork's desirable-difficulty + spacing research (cognitive
   science) transfers to LM training: massed same-pattern practice maximizes
   short-term performance and minimizes retention; interleaved practice does the
   opposite. In the curriculum, mix kinds/domains/topics *within* each level so
   same-pattern docs never cluster. Do not train "all landing pages" then "all
   shops" — train them interleaved.
3. **Retrieval/testing signals.** Retrieval practice (self-testing) beats passive
   reading for humans; cloze/self-test items have the same role for LMs. Every
   corpus build includes verification items where the fact must be RE-GENERATED
   from context (cloze suffixes, self-check blocks), not merely read. A model
   trained only on statements learns statements; a model trained on
   statements + retrieval tasks learns the underlying representation.
4. **Reasoning traces preserved, never stripped.** DeepSeek-R1 distillation
   (EMNLP 2025): answer tokens attend substantially to reasoning tokens — the
   chain IS the signal. Never ship answer-only synthetic data. Where capacity
   forces compression (queen-bee-v5: ≤450-token completions), compress the chain,
   don't delete it.
5. **Contrastive structure.** Understanding includes knowing what something ISN'T.
   Sheldon adversarial probes, distractor suffixes in cloze items, and explicit
   "why not X" analysis teach boundaries. A doc that only ever shows correct
   outputs produces a model with no boundary sense (calibration failure).
6. **Capacity-matched content.** Content the student cannot hold is memorized
   verbatim or dropped (Yin et al. 2025: long CoTs impair small models via
   overthinking). Compress to the student's edge. Compression forces abstraction;
   abstraction IS understanding.

## Comprehension Evals (how you MEASURE it — never trust vibes)

1. **Paraphrase-robust cloze.** Every cloze item must have 2+ phrasings of the
   same fact. Understanding = all phrasings pass. Train-phrased-only pass = memorization.
2. **Near-dup audit.** MinHash/Shingling sample of each batch vs the corpus index.
   Build-quality gate: near-dup rate within a kind must be LOW (target <10% at
   batch level); a batch that is >50% near-dup is rejected, not shipped.
3. **Transfer probes.** Apply a taught mechanism to an input that was NOT in
   training (novel combination of known parts). Pass = composed understanding;
   fail = rote pattern match.
4. **Interference test.** Two similar-but-different facts (e.g., "LRU evicts the
   least recently used" vs "antithetic variates exploit symmetry") must BOTH be
   recalled correctly — no cross-contamination from near-simultaneous training.
5. **Boundary probe.** A near-distractor (plausible wrong continuation) must lose
   to the correct one by a margin, or the model abstains. Margin ≈ 0 or negative
   with high confidence = boundary-less memorization.

## Build-Time Gates (every batch, before staging)

- [ ] **Near-dup audited** — MinHash sample vs corpus index; rate recorded.
- [ ] **Evolved, not copied** — seed variation is structural (audience/constraints/
      example), not just value substitution.
- [ ] **Interleaved** — batch mixes kinds/domains/topics; no massed runs of one pattern.
- [ ] **Chain preserved** — reasoning/verification trace present (spock/sheldon or
      self-check), never answer-only.
- [ ] **Contrast present** — at least one "why not the distractor" or adversarial
      probe per doc family.
- [ ] **Capacity-matched** — completions within the student's budget.
- [ ] **Measured** — token counts from execution; every claim traceable to a run.

## Application Protocol

1. **Scaling an existing generator** (e.g., web corpus): run the near-dup audit
   FIRST, quantify the rate, then add an evolution layer to the generator
   (structural seed variation) before scaling volume. Volume over near-dups is
   memorization at scale.
2. **Adding gold docs** (gold-training-docs / dual-mind / synthesis skills):
   evolve seeds across docs (vary audience, angle, worked example), interleave
   domains in batch order, keep Spock+Sheldon+synth intact.
3. **Post-training** (SFT/distill/preference): traces carry the chain, not the
   answer; capacity-match completions; never ship the student's own generations.
4. **Curriculum ordering** (training-from-scratch): within each phase, interleave
   kinds so identical patterns never cluster; escalate to harder interleavings.

## Relation to Other Skills

- **gold-training-docs / kd-corpus-production**: per-doc format + 5-gate pipeline.
  This skill adds the *anti-memorization* gates (near-dup, evolve-not-copy,
  interleave, chain, contrast) on top.
- **corpus-curation**: inventory, grading, mix budget. This skill supplies the
  C-grade trigger: template-noise batches (Grade C) are near-dup by construction
  and must be evolved or stripped, not scaled.
- **synthetic-data-pipeline**: teacher rotation + Nemotron curation. Every
  teacher batch still passes this skill's near-dup + chain gates.
- **dual-mind-reasoning-traces / human-systems-synthesis**: trace format skills;
  the chain/contrast levers are their reason to exist.
- **training-from-scratch**: cloze/cloze-robustness items are this skill's
  measurement arm; interleaving is its curriculum arm.

## When to Trigger

- Scaling ANY corpus generator to high volume (the memorization risk is highest there)
- Adding any batch of training docs (pretraining or post-training)
- Designing cloze / eval items (make them paraphrase-robust)
- Auditing corpus quality for memorization (run the near-dup audit + paraphrase probe)
- Deciding whether to scale an existing generator vs. evolve its seeds

Base directory: C:\Users\Grey_\.agents\skills\comprehension-engineering
