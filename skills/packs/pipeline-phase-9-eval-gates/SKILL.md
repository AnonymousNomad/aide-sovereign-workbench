---
name: pipeline-phase-9-eval-gates
description: Phase 9 of the from-scratch training pipeline — evaluation and gate verification. The fail-loud gate matrix (format, honest chat, coherence, novelty, safety, regression), the no-vacuous-pass laws (no-gold = FAIL, degeneracy = FAIL), contamination audit rules, paired CI statistics for honest improvement claims, and the fresh-regression-only comparison rule (never compare across normalizer versions). Use when gate-checking ANY checkpoint, comparing two checkpoints, deciding whether a run passed, or auditing an eval's honesty for the 150M rebuild.
---

# Phase 9 — Eval & Gate Verification

Gates are how the pipeline stays honest. Phase 9 defines the evaluation
battery, the pass/fail laws, and the statistics that make improvement claims
real. The project's own history is the cautionary catalog: a gate that
auto-passed no-gold prompts, a DPO that "improved" chat while collapsing
envelope 1.00→0.00, 17 false-fails + 7 false-passes from a buggy normalizer,
vacuous web passes on degenerate outputs, and a 0.25 human-safe score stuck for
weeks. Every one of those was an EVAL bug, not a training bug.

Research sources: NASA SWE-066/SWE-104/SWE-191 + NASA-GB-8719.13 (test levels,
independent verification, regression), verification-complete doctrine (smoke
tests forbidden as proof), Sonar AC/DC Verify pillar (mandatory, comprehensive,
automated, zero-trust, AI cannot verify AI), Qwen /verify deep-verification
lane (A/B against base, vacuity checks, adversarial audit), statistical
paired-testing practice (McNemar / paired bootstrap, CI reporting).

---

## 1. The Gate Matrix (the full battery)

| Gate | What | Pass law | Instrument |
|---|---|---|---|
| G-Format | byte-exact envelopes/web/chat parse | strict parse 100% on gold set; no-gold FAILS | envelope parser + web scorer + chat honest gate |
| G-Chat | honest overlap vs gold | Jaccard ≥ 0.15 AND non-degenerate (len, repetition, template-echo) | honest gate (coherence_score_150.py lineage) |
| G-Coherence | general NLP coherence (Phase 9 adds) | ≥ 2/3 coherence probes pass human-checked rubric; no gibberish | probe set + rubric (rubric defined BEFORE scoring) |
| G-Novelty | not memorized verbatim | overlap vs any training/teacher text < 0.5; no 20+ token exact quote from teacher | overlap scanner vs corpus + teacher logs |
| G-Safety | no harmful/evil output (envelope included) | all safety probes clean; zero evasion attempts (multi-format-retention-repair law) | safety probe set |
| G-Regression | old formats + old skills intact | floors env ≥ 0.8, web ≥ 0.6, code ≥ gate baseline; compare vs STAGE PARENT only | fresh regression battery |

The matrix is deterministic, scripted, and versioned. A gate version bump
(any change to evaluator or rubric) invalidates old comparisons (see §4).

### Why
- A gate that can't fail is not a gate (auto-pass bugs). Fail-loud = exit code
  non-zero + reason printed; a gate that exits 0 with no evidence is a lie.

### Expected bugs / issues
- Gate scores computed with an OLD normalizer after a scorer change (17+7
  false results precedent) — the score line must carry the verifier version.
- Gates that pass on the training set (memorized gold) — every gate runs on
  held-out eval set with gold answers; training-set performance is never a gate.
- A gate that "passes" by returning empty output (vacuous) — degeneracy checks
  (min length, token diversity) are part of every gate.

---

## 2. No-Vacuous-Pass Laws (the honesty core)

1. **No-gold = FAIL**: any eval prompt without a gold answer in the eval map
   FAILS its gate. Auto-passing no-gold prompts is the 2026-08-14 precedent —
   the exact bug that let a 242-pair SFT look "done".
2. **No evidence = FAIL**: a gate result must include the outputs it judged
   (the N outputs, the scores, the rubric row). A gate that reports only a
   number is a lie.
3. **Degenerate = FAIL**: repeated tokens, empty, template-echo (the web
   "degenerate outputs" precedent that vacuous-passed the web gate), or
   >50% copied teacher text — all FAIL regardless of score.
4. **AI cannot verify AI**: an LLM judge is never the gate. LLM-judge results
   are, at most, a sanity signal that still needs deterministic confirmation.
5. **Independent**: the gate implementer must not be the trainer author (same
   person is OK only with the audit step in §5 — the Qwen /verify A/B law).

### Why
- Every historical false-pass traced to one of these five laws being bent.
- The gates exist to protect the SHIPPED behavior, not the training run's ego.

---

## 3. Paired Statistics (honest improvement claims)

- **Compare like-for-like**: new checkpoint vs stage PARENT only (fresh
  regression). Never vs a historical baseline measured with an old normalizer
  or old gate version (the 17+7 false-results precedent).
- **Paired, not pooled**: same prompt set both sides (paired design). Report:
  pass-rate delta, McNemar p-value (or exact sign test), 95% CI via paired
  bootstrap (10K resamples).
- **Decision rule**: claim "improved" ONLY if delta > 0 AND the 95% CI excludes
  0 (or p < 0.05 with a stated alpha). A +0.01 on 20 prompts is noise — say so.
- **Retention floors are absolute**: a stage that passes statistics but violates
  a floor (env < 0.8) is REJECTED. Statistics decide improvement; floors decide
  survival (multi-format-retention-repair law).

### Why
- 20-prompt batteries have huge variance; raw deltas without CI/p are noise.
- Paired design removes prompt-set variance (the same model on the same set).

---

## 4. Gate Versioning & the Comparison Law

Every gate run records: gate_version, verifier_version, prompt_set_hash,
model_checkpoint, parent_checkpoint, date, scores, raw outputs. Comparisons are
legal ONLY between runs with identical (gate_version, verifier_version,
prompt_set_hash). Any change = new comparison epoch. Historical scores stay
for the record but are never used as pass evidence.

### Why
- The 17+7 false-fail/pass flip came from a normalizer change between
  comparison epochs — the law exists so that never happens silently again.

---

## 5. The Audit Step (independent verification)

Before ANY "Gate X passed" claim is recorded:
1. Re-run the gate script from a clean shell (no cached state) — same result?
2. Sample 5 passed and 5 failed outputs; read them; do they deserve their
   verdict? (vacuity check)
3. Adversarial: try to break the gate (feed a word-soup, a copied teacher
   answer, an empty string) — it must FAIL (mutation testing: gates must fail
   when broken).
4. Record the audit in AGENT_NOTES with the sampled outputs.

### Why
- NASA SWE + verification-complete: verification must be independent of the
  work verified. The audit step is the independence.

---

## 6. Verification Checklist (Phase 9 DONE only when ALL pass)

- [ ] Gate matrix implemented + scripted + versioned (gate_version in output)
- [ ] All five no-vacuous-pass laws enforced in code (no-gold FAIL, evidence
      printed, degeneracy checks, no LLM-judge-as-gate, audit step exists)
- [ ] Paired statistics implemented (delta + CI + decision rule)
- [ ] Comparison law enforced (epoch hash check blocks illegal comparisons)
- [ ] Audit step run on every gate family at least once (5/5 vacuity +
      adversarial mutation) and recorded
- [ ] Safety + novelty + coherence + format gates all have held-out prompt sets
      with gold answers and a contamination check vs pretrain cache
- [ ] A gate run's full evidence (outputs + scores + rubric rows) is saved for
      the checkpoint's manifest

---

## 7. Dependencies Summary

Phase 8 checkpoints (stage parents), verifier suite (envelope parser, web
scorer, chat honest gate — all CURRENT versions), held-out eval sets (Phase 3
val lock-box + Phase 7 gold maps), teacher logs (novelty overlap scans), no new
libraries (statistics via numpy/scipy).

---

## 8. When Done

Mark Phase 9 complete in AGENT_NOTES with the gate matrix version, audit
results, and the comparison-epoch hash, then proceed to Phase 10 (Serve &
Release): skill `pipeline-phase-10-serve-release`.