---
name: pipeline-phase-7-post-train-data
description: Phase 7 of the from-scratch training pipeline — post-training data construction (SFT, distillation, preference). Capacity-matched SFT pairs with replay mix, short execution-verified distillation traces with prompt erasure, DPO/GRPO preference pairs with verified margin gates, and the per-item verification gates that make the data honest before ANY post-train run. Use when building any SFT/distill/preference dataset for the 150M rebuild, deciding what belongs in post-train vs pretrain, debugging "the model memorized but didn't generalize", or auditing pair quality before a Phase-8 run.
---

# Phase 7 — Post-train Data

Pretraining (Phases 5-6) gave the base raw language; post-training gives it
behavior. Phase 7 builds the DATA for SFT, distillation, and preference stages —
and the data is where small-model post-training lives or dies. This project's
own history is the warning: a 242-pair chat SFT disproven at 5e-5, a DPO with 13
pairs failed-at-data, vacuous gates passing word soup. Phase 7's gates exist so
Phase 8 never trains garbage.

Research sources: LIMA (2305.11206) curation, Orca-2 (2311.11045), phi-1
(2306.11644) exercises, LLaMA2 SFT (2307.09288), DPO (2305.18290), GRPO
(2402.03300), Yin et al 2025 (long CoTs hurt small students), SmolLM2
(2502.02737), Muennighoff (2311.17016), post-training-sft/-distill/-preference,
kd-teacher-strengths, zero-dup-high-quality, original-trace-engineering.

---

## 1. Standing Laws (inherited from Phase 3, apply to ALL post-train data)

1. **Zero-dup / near-dup**: every pair verified unique against the global index
   (including against the pretrain corpus — an SFT pair quoting a pretrain doc is
   a redundant repeat, and one quoting a val/test doc is contamination).
2. **Capacity-matched**: the 150M model cannot learn what a 4B teacher says in
   800 tokens. Pairs must be within the student's demonstrated envelope (max
   length, format complexity, reasoning depth). (kd-teacher-strengths law.)
3. **Verified, not vibes**: every answer passes a deterministic gate (parse,
   execute, format, contamination) BEFORE it enters a dataset. No LLM-judge
   vibes; no vacuous pass (the 2026-08-14 no-gold gate bug is the precedent).
4. **Honest held-out**: every post-train eval prompt has a gold answer in the
   eval map. No-gold prompts FAIL (never auto-pass).

---

## 2. SFT Pairs (instruction → answer, in-domain)

### What to do
- **Scope**: 1-3K pairs (LIMA: 1K curated beats 50K noisy; SmolLM2 used ~20K).
  For the 150M: START with 1-2K in-domain pairs, one epoch.
- **Format**: `{"instruction": "...", "answer": "...", "kind": "web|chat|env|code",
  "source": "...", "checksum": "..."}`. Kind-tagged so Phase 8 can gate per-kind.
- **Sources** (in order of preference for THIS project):
  1. Verified gold docs already passing the Phase-3 pipeline (e.g. the 476
     clean W1 web pairs, the 242+1,456 chat pairs — but each re-verified).
  2. Teacher-generated pairs (Qwen3.5-4B local) — with the SAME gates as scraped
     data: quality, dedup, contamination, format.
  3. Exercises-with-solutions (phi-1's ~180M-token trick): problem → stepwise
     solution, execution-verified where executable.
- **Replay mix (anti-forgetting)**: SFT on new behavior (e.g. chat) without
  replay destroys old formats (this project: env 0.87→0.33, web 1.00→0.87 when
  SFT'd without replay). Every SFT dataset must include ~20-30% replay pairs
  from the OTHER kinds the model must retain (web + envelope + code), sampled
  from verified gold data. The mix is per-run config, recorded in the dataset
  manifest.

### Why
- LIMA/phi evidence: curation > volume for SFT on a small model.
- Kind-tagging + replay mix is the multi-format retention law from this
  project's own multi-format-retention-repair skill — the envelope is
  hair-trigger (a single byte-format drift breaks the gate).

### Expected bugs / issues
- Teacher answers too long for the student's 1024-token window → truncation
  destroys the answer. Gate: tokenized length ≤ 80% of window.
- SFT pair whose instruction is OUTSIDE the product domain (irrelevant QA) →
  the model learns irrelevant behavior. Keep the pair taxonomy in-domain.
- No replay → format collapse (documented). No kind tag → can't build the mix.
- Duplicate instruction with different answers (two teachers) → the model
  learns to hedge. Dedup on instruction+answer normalized.

---

## 3. Distillation Traces (reasoning transfer, capacity-matched)

### What to do
- **Teacher**: Qwen3.5-4B local (verified competence envelope: it CAN explain,
  it is NOT for web/format tasks — kd-teacher-strengths law: distill within the
  teacher's verified envelope only).
- **Trace format** (dual-mind reasoning-trace doctrine, 3 blocks):
  1. Induction (step-by-step derivation)
  2. Adversarial cross-check (attack the first pass, find the flaw)
  3. Synthesis (final answer with the corrected path)
  Length: SHORT. Yin et al 2025: long teacher CoTs actively HURT small
  students. Target: total trace ≤ 256-384 tokens for a 150M student.
- **Verification**: every trace's final answer passes a deterministic verifier
  (execution for code, parse for format, reference-check for factual QA).
  Unverified traces NEVER enter the distill set (generate → verify → keep).
- **Prompt erasure** (MapCoder-Lite doctrine): train on the QUESTION + the trace,
  NOT the original teacher prompt, so the student learns the reasoning, not
  prompt-following of a 4B prompt.
- **Diversity**: 1 teacher × N seeds can collapse; vary seeds, paraphrases,
  and constraint sets (vocab/audience) like the phi recipe (Phase
  textbook-quality skill §3).

### Why
- Capacity-matching is the difference between distillation that lifts the
  student (short verified traces) and distillation that overwhelms it (long
  teacher CoTs, or 4B-level reasoning compressed into 150M — the student
  memorizes the format and mangles the reasoning).
- Execution/reference verification is the ONLY honest gate (closed-loop
  generate → AST-verify → self-correct → confidence).

### Expected bugs / issues
- Traces written from the teacher's own prompt-injection (the trace quotes
  "system: you are...") → prompt-erasure filter must strip any teacher-system
  residue; assert no "system" markers in the final answer block.
- Verification that passes empty/short traces (vacuous) → min-length + content
  gates (like the 2026-08-14 no-gold bug: no gold = FAIL).
- Near-dup traces across seeds (teacher repeats itself) → MinHash dedup on the
  trace, <1% target (Cosmopedia parameter).
- The teacher's longest-token answer passing the length gate but the student
  truncating mid-reasoning at inference → cap trace length at the gate, and
  re-verify at Phase 8 eval with actual student generation.

---

## 4. Preference Pairs (DPO/GRPO data)

### What to do
- **DPO pairs**: `{"prompt": ..., "chosen": ..., "rejected": ..., "margin": ...}`
  Built from VERIFIER results: for each prompt, generate N student/teacher
  outputs, score them deterministically, pair chosen (passes verifier / higher
  score) vs rejected (fails / lower score). **Margin gate**: only pairs with
  score margin ≥ 0.01 (web median 0.0139 was usable; 0.0018 was NOT — this
  project's DPO failed-at-data on 13 low-margin pairs).
- **Minimum viable**: ≥100-300 pairs per task family with real margins; 13 pairs
  is a waste of a run (documented).
- **GRPO**: ONLY for tasks with an exact verifier (code passes tests, math has a
  known answer). Not for subjective/format tasks.
- **Kind separation**: envelope/format pairs and web pairs are different
  distributions — never mix them in one preference batch without per-kind
  margins.

### Why
- Preference optimization needs signal separation: if the scorer can't tell
  chosen from rejected (tiny margins), DPO has nothing to learn (this project's
  failed-at-data DPO is the precedent).
- Exact-verifier-only GRPO prevents reward hacking on subjective scores.

### Expected bugs / issues
- Pair leakage into pretrain corpus (a pair's text already seen in pretrain) →
  the model knows the answer; contamination scan pairs vs the pretrain cache.
- Margin computed on a buggy normalizer (the 2026-08-11 logo_cloud/contact
  normalizer bug flipped 17 false-fails and 7 false-passes) → every margin must
  be computed with the CURRENT verified scorer, and the scorer itself audited
  before pair-building.
- Rejected outputs that are ALSO valid (two correct answers, one preferred) →
  DPO fights itself; check rejected actually fails the verifier.

---

## 5. Dataset Manifest (every post-train dataset carries one)

```json
{
  "name": "sft_chat_v2",
  "kind_mix": {"chat": 0.7, "replay_web": 0.15, "replay_env": 0.15},
  "n_pairs": 2000,
  "max_tokens": 800,
  "verifier_version": "web_pipeline_2.1+env_1.0",
  "dedup_threshold": 0.8,
  "contamination_scan": "13-gram vs pretrain cache + val/test + benchmarks: 0 hits",
  "teacher": "qwen3.5-4b (enable_thinking=false)",
  "generator": "gen_chat_corpus_v2.py",
  "created": "2026-08-16",
  "replay_sources": ["476 clean W1 web pairs", "123 envelope traces"]
}
```
The manifest is the contract Phase 8 consumes: it decides gates, mix, and
expectations. Every dataset change (new pairs, new verifier) bumps the manifest
version — Phase 8 logs it against the run.

---

## 6. Verification Checklist (Phase 7 DONE only when ALL pass)

- [ ] Every pair passes its deterministic gate (parse/execute/format/reference) —
      zero vacuous passes; no-gold eval prompts FAIL
- [ ] Zero-dup: global dedup incl. against pretrain cache — audit log of drops
- [ ] Contamination: 13-gram scan vs pretrain cache + val/test + benchmarks = 0
- [ ] Capacity-matched: tokenized length ≤ 80% window; trace length ≤ 384
- [ ] Prompt erasure: no teacher-system residue in any trace final block
- [ ] Kind tags + replay mix present and documented in the manifest (≥20% replay
      for any single-kind SFT)
- [ ] DPO pairs: margin ≥ 0.01 measured with the CURRENT verified scorer;
      rejected outputs actually fail the verifier; ≥100 pairs per family
- [ ] GRPO pairs: exact verifier only
- [ ] Dataset manifest complete (kind_mix, n, verifier version, contamination
      result, teacher, generator, replay sources)
- [ ] Sample audit: 10 random pairs human-read; every one is in-domain, correct,
      and unique

---

## 7. Dependencies Summary

Phase-3 pipeline (dedup, contamination, quality gates), Phase-2 tokenizer
(capacity measurement), the verifier suite (web pipeline 2.1 + envelope + chat
honest gate), teacher Qwen3.5-4B local server (Phase model-runtime), generators
(gen_chat_corpus_v2.py, trace generator). No new libraries — this phase is
DISCIPLINE, not code.

---

## 8. When Done

Mark Phase 7 complete in AGENT_NOTES with the dataset manifests (kind mix,
pair counts, margin stats, contamination result), then proceed to Phase 8
(Post-train Runs): skill `pipeline-phase-8-post-train-runs`.