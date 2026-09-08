# Skill: fsi-small-model-gate-underflow

# Small-Model Gate Underflow — Do You Continue Pretraining or Go to SFT?

## Trigger

A small model (<=150M params) finishes its budgeted pretraining, the Gate-0-style
cloze / probe battery comes in BELOW the aspirational target (e.g. 11/20 when
12-14/20 was wanted), and the operator asks: do we train longer, or SFT now?

The law: NEVER answer this from vibes. Answer from token-per-parameter (t/p)
accounting + the gate's believed purpose + the model's role in the roadmap.

---

## 1. The decision rule (what to do)

Work the three facts BEFORE deciding:

1. **Tokens-per-parameter (t/p) actually seen.** `tokens_seen / model_params`.
   - < 1 t/p -> severely undertrained. The model is on the STEEPEST part of the
     loss-vs-tokens power law (Kaplan/Hoffmann regime). Every extra token has
     maximum marginal value.
   - Chinchilla target ~= 20 t/p (compute-optimal). We are nowhere near it.
   - Deep under-training is NOT failure - it is the region where "more training
     now" gives the biggest win per token. If compute is unlimited, you train
     ON. The question is only: is more training the RIGHT investment given the
     hardware (GTX 1060) and the model's ROLE (pilot vs. production)?

2. **What the gate ACTUALLY measures.** Per `fsi-cloze-collapse-small-model`,
   the pretrain cloze battery was designed as a COLLAPSE detector, not a
   knowledge benchmark:
   - HARD FAIL = function-word prior collapse (same top-5 for every prompt).
   - The real pass criterion = model differentiates by prompt + mean margin > 0.
   - Items that "lose" are usually long-tail FACT knowledge (capitals, dates,
     element symbols) that small models score poorly on BY SCALING LAW
     (Kandpal et al. "Large Language Models Struggle to Learn Long-Tail
     Knowledge"). A 11/20 with a positive margin is a base that is learning,
     not a base that is broken.
   - Gateway confusion is the #1 trap: don't use a collapse-detector score as
     a knowledge-competence gate, and don't use a factual probe to judge
     pretraining completeness.

3. **The model's role in the roadmap.**
   - PILOT (our case): its purpose is to validate the SFT->gate->serve
     loop end-to-end against REAL traces, NOT to ship production quality. The
     pilot's SFT tells us whether our cross-synthesis trace format is learnable
     and whether gate-level evaluation is honest - before we spend a month on
     the 146.5M production model. A pilot that "passes everything at 20 t/p"
     burns weeks for zero roadmap value.
   - PRODUCTION: full Chinchilla-ish budget or deliberate overtraining strategy.

**DECISION TABLE**

| t/p seen | Role | Gate read | Action |
|---|---|---|---|
| < 1 | PILOT | no collapse, margin > 0 | SFT now (accept underflow, see section 4) |
| < 1 | PRODUCTION | no collapse | keep pretraining (steepest-gain region) |
| 1-5 | ANY | no collapse | SFT now; production optionally tops up |
| > 5 | ANY | no collapse | SFT now; gate underflow is data-curation noise |
| ANY | ANY | COLLAPSE detected | do NOT SFT. Diagnose data/arch first (fsi-cloze skill) |

Rule of thumb encoded in API contract terms: **pretraining fixes the base's
fluency; SFT fixes alignment/fact-following. You cannot SFT collapse away.
You CAN SFT a slightly-undertrained base.** Underflow on a collapse-free base
in the validation-first path is a GREEN light for SFT.

---

## 2. Why - the research

- **Hoffmann et al. 2022 (Chinchilla):** compute-optimal ~= 20 tokens/param.
  Earlier models (GPT-3 at ~1.7 t/p) were "undertrained" yet useful.
- **arxiv 2401.00448 "Beyond Chinchilla-Optimal":** quality keeps improving up
  to 500-10,000 t/p; at < 20 t/p training is still learning, just less compute-
  efficient. Confirms: extra tokens are never wasted, but low t/p alone is not
  a reason to block SFT.
- **SmolLM2-135M (Allal et al. 2025):** trained on 2T tokens (740x Chinchilla)
  then SFT+DPO. Modern small-model practice = DELIBERATELY OVERTRAIN. Data
  curation (FineWeb-Edu filtering) was decisive.
- **L20-Edu-135M (arxiv 2606.22189):** one commodity GPU, 10B fineweb-edu +
  3B curated, reached 87% of SmolLM-135M's mean score on ~2% of the token
  budget. THE evidence that curated data + careful gates dominate raw scale
  for small models. Also: RLVR/GRPO on a weak base FAILED (no cold-start).
- **LIMA (Zhou et al. 2023):** 1,000 diverse, high-quality SFT examples enough
  for alignment when the BASE is strong. Doubling SFT volume ~= flat. Diversity
  and quality >> count. Caveat: presupposes a base that already knows the
  content (base strength is a prerequisite for SFT quality).
- **"Long is More for Alignment" (Zhao et al. 2024):** among 1K chosen IFT
  examples, LONGER responses are a strong, cheap quality heuristic.
- **Kandpal et al.**: long-tail factual recall scales with model size - small
  models will lose factual cloze items. Expected, not a bug.

Net: for a PILOT whose purpose is pipeline validation, on this hardware
(11 days to Chinchilla-optimal on the 1060), the pipeline question is more
valuable than the last 8% of pretrain. SFT now, over-train the PRODUCTION
model later with the corpus already built.

---

## 3. What code to write / how it's done

The concrete artifacts this decision produces (all already in repo):

1. **The collapse/learning read** - `E:\pip_temp\opencode\cloze_likelihood.py`
   (deterministic: `CUBLAS_WORKSPACE_CONFIG=:4096:8` + seed 0 + cudnn det).
   Read: pass fraction vs 50% random baseline + mean margin sign; decode the
   failing items and classify them into "long-tail fact" (expected) vs.
   "function-word prior" (COLLAPSE - stop everything).
2. **The t/p bookkeeping** - compute `tokens_seen / params` from the trainer's
   curriculum: sum(steps_in_phase * seq_len). Log next to every checkpoint.
3. **The pilot SFT corpus builder** - run the cross-synthesis trace generator
   (dual-mind Spock/Sheldon + synthesis, verifier-gated, byte-exact format).
   Quantity law: 1-3K diverse high-quality traces, longer-is-better, NO filler.
4. **The gate after SFT** - use the GATE MATRIX from `pipeline-phase-9-eval-gates`
   (no-vacuous-pass laws: not passing because template-echo, empty, or
   no-gold). Paired stats: only compare against the stage parent.

---

## 4. What NOT to do

- Do NOT continue pilot pretraining to chase a 12-14/20 cloze number when the
  model is collapse-free and the path is validation-first. That's week-burn
  with zero roadmap value (flipped-table: the next model is the one that gets
  the full budget).
- Do NOT treat a factual cloze miss (capital of X, symbol of Y) as a pretrain
  defect. Long-tail recall is a size-scaling fact.
- Do NOT SFT a COLLAPSED base - SFT cannot repair a function-word prior; the
  loRA/data will just re-learn the collapse. Diagnose data/architecture first.
- Do NOT use cloze to justify "train to 20 t/p" when the actual constraint is
  hardware. On GTX 1060 at ~700-1100 tok/s useful, Chinchilla-optimal for
  52.9M ~= 11+ days of GPU. Assume that cost is only payable on PRODUCTION.
- Do NOT scale SFT by volume instead of diversity/quality (LIMA's flat-curve
  result). 5K mediocre traces < 1-2K diverse verified traces.
- Do NOT run RLVR/GRPO on a weak pretrained base expecting reasoning to emerge
  (L20 negative result) - this is our DPO/RL stage, later, on the SFT'd model,
  with exact verifier gates only.
- Do NOT compare the pilot against historical scores measured under a different
  normalizer/gate version (phase-9 comparison law).

---

## 5. Threat / dependency matrix

| # | Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| T1 | Pilot SFT fails to converge on format | med | HIGH (wastes the pilot) | collapse-free read BEFORE SFT; byte-exact trace format; 1-3K diverse traces; Gate 1 format check |
| T2 | Underflow read wrong (collapse hidden) | low | high | decode top-5 per prompt; check per-prompt differentiation; look at lbl/MoE load |
| T3 | SFT gate vacuous-pass (template-echo) | med | high | phase-9 no-vacuous laws; deg-check; independent audit step |
| T4 | Week spent training a pilot to 20 t/p | med | high (time) | decision table: <1 t/p + pilot + no-collapse => SFT now |
| T5 | RL on weak base does nothing | med | low | defer RL until after SFT; exact verifier; cold-start data |
| T6 | Long-tail factual cloze treated as bug -> useless retrains | high | med | classify failures; expect fact-miss on small models |
| T7 | VRAM/seq overflow during SFT | low | med | batch=1 + grad_ckpt + seq cap at 2048; ckpt-every 50 |

Dependency: this skill CONSUMES `fsi-cloze-collapse-small-model` (collapse
read), `pipeline-phase-9-eval-gates` (gate honesty), and the locked
validation-first roadmap. This skill OVERRIDES any raw "gate floor" number
when the floor was aspirational rather than researched.

---

## 6. Quantity table (the numbers)

- Corpus for 52.9M pilot: built 1.097B tokens = already Chinchilla-optimal for
  that size (1.06B). Floor is DATA SIZE, not what the pilot has seen.
- Pilot tokens seen: ~4.6M over 5000 steps (0.09 t/p). Accept for SFT.
- Production 146.5M: needs 20 t/p = ~2.9B tokens ideally. We have 1.097B.
  Strategy: OVERTRAIN the production model on the full 1.097B corpus beyond
  one pass with data-curriculum repetition (SmolLM2-style, small-model
  doctrine), NOT to wait for ideal corpus size.
- SFT corpus: 1-3K diverse high-quality verified cross-synthesis traces.
- Gate thresholds: cloze > 50% + mean margin > 0 + per-prompt differentiation
  = PASS. 12-14/20 is aspirational, NOT a researched floor for a 52.9M.
- Time: pilot 5000 steps ~= 2-3h of GPU wall-clock in 100-125-step chunks.

---

## 7. Verification

Before claiming "decision applied": re-run the cloze battery (deterministic),
confirm pass rate + margin sign + per-prompt differentiation, record t/p seen,
record the roadmap role, then state the SFT decision with the t/p + role +
gate-read facts in one line. Record in AGENT_NOTES.