---
name: zero-dup-high-quality
description: STANDING OPERATING DIRECTIVE for the FSI-FELON / queen-bee-v5 program. MANDATORY for every corpus action. Two non-negotiable laws: (1) NO duplicate or near-duplicate training documents may ever be created or used — every new doc must be verified unique against the corpus index before staging; (2) NO document may ship unless it is the absolute highest quality manageable — verified, executable, measured, byte-exact format, zero filler. Applies to ALL models (trek, felon, Sopher, 150M web-builder), ALL phases (pretraining corpus, SFT, distill, preference, synthetic), ALL generators, ALL sources on C: and E:. This skill outranks every other skill on data quality; when any other instruction conflicts, this one wins.
---

# Zero-Dup High-Quality — Standing Operating Directive

## The Two Laws (non-negotiable, no exceptions)

### LAW 1: Zero Duplicates
- **No duplicate training documents.** Ever. Not exact, not near-duplicate, not
  value-substituted variants (same doc, swapped brand/color/name).
- Every document MUST be verified unique against the corpus index BEFORE staging.
- A batch that is >50% near-duplicate is REJECTED, not shipped.
- Two docs that differ only in variable values are ONE doc of learning.

### LAW 2: Highest Quality Only
- **No document ships unless it is the absolute highest quality manageable.**
- Every number/claim verified by executed run. Byte-exact format. Zero filler,
  zero scaffolding, zero template stubs, zero fabricated verification.
- If it is not the best you can produce, it does not enter the corpus.

## When This Directive Applies

**EVERYTHING. Every time. No exceptions.**

| Context | Applies |
|---|---|
| Pretraining corpus (all models) | YES |
| Gold docs (gold-training-docs / dual-mind / synthesis) | YES |
| Post-training: SFT, distill, preference, RLVR, closed-loop | YES |
| Synthetic generation (any generator, any teacher) | YES |
| Raw source intake from C: / E: drives | YES |
| Web corpus generator (gold_web_*) | YES |
| Any doc added to `training_curated\` | YES |

## The Uniqueness Gate (every doc, before staging)

1. **Exact dedup** — hash (SHA-256 of normalized text). Reject if present.
2. **Near-dup dedup** — MinHash/shingling (5-gram shingles, e.g. 64 hashes) vs the
   corpus index. Reject if Jaccard similarity > 0.50 to any existing doc.
3. **Structural dup check** — same section/type layout with only values changed
   (detect via template skeleton comparison). Reject.
4. **Record** — log the uniqueness verification result in AGENT_NOTES with the
   similarity numbers. Every doc has a dedup receipt.

## The Quality Gate (every doc, before staging)

1. **Verified** — every number comes from an ACTUAL executed run. No invented values.
2. **Executable** — code parses (AST), runs standalone, stdlib only.
3. **Byte-exact format** — the canonical tag structure, zero drift.
4. **Single topic** — one mechanism taught deeply (Phi-1), not a grab-bag.
5. **Capacity-matched** — learnable by the target student (completions within budget).
6. **Chain preserved** — reasoning/verification trace present; never answer-only.
7. **No filler** — no padding, no boilerplate, no repetition, no emoji, no scaffolding.
8. **DataMan multi-axis** — factual correctness, structure, depth, executability,
   clarity, originality all pass; failing 3+ axes = dropped.

## Audit Protocol

- **Every batch** — run both gates (uniqueness + quality) on ALL docs before staging.
- **Existing corpus** — periodically re-audit: hash all docs, MinHash sample, remove
  anything that violates Law 1 or Law 2.
- **Drive intake** (C: / E: raw sources) — grade A/B/C/F (corpus-curation skill).
  Only A/B enter; C must be stripped of scaffolding first and pass both gates; F is
  EXCLUDED forever (see corpus-curation waste list).
- **Generators** — every generator output passes both gates. If a generator produces
  near-dups at scale, it is REDESIGNED (evolution layer), not scaled.

## Evidence Requirement

Every claim "this doc is unique and high-quality" requires a recorded receipt:
- hash + similarity scores vs corpus index
- py_compile / run output matching the Execute block
- measured token count
- which 5-gate / quality checks passed

No receipt, no staging. This is a standing order, not a guideline.

## Standing Procedure (mandatory, every corpus action)

1. Create or gather document.
2. Run the Uniqueness Gate. Reject if duplicate/near-dup.
3. Run the Quality Gate. Reject if not highest quality.
4. Only if BOTH pass: stage to `training_curated\` + record receipt + AGENT_NOTES.
5. Never delete or overwrite an existing corpus path in place — build new, verify, swap.

## Conflicts

This skill OUTRANKS all other skills on data quality. If another skill says
"scale X", "generate more", "this is fine", or any instruction conflicts with the
Two Laws, THIS directive wins. Duplicates and low quality are never acceptable,
for any reason, at any scale.

Base directory: C:\Users\Grey_\.agents\skills\zero-dup-high-quality
