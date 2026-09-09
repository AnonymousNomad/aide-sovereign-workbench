---
name: sft-format-marker-loop
description: Detects and fixes the "marker attractor loop" failure mode in small-model SFT — the model learns to open the ChatML envelope but then emits <|im_start|>/<|credo|> repeatedly forever, never producing content or <|im_end|> (700-token cap exhausted). Caused by over-aggressive marker-token loss weighting (extreme weights) interacting with greedy self-reinforcement and exposure bias. Use whenever a post-SFT model opens the envelope but loops on marker tokens, whenever marker weighting has been tuned and overshot, or before choosing marker/token weights for a small-model format SFT. Research-grounded: WIT (TACL 2025), CFT (arXiv 2510.10974), Fu et al. NeurIPS 2022 (self-reinforcement loops), Welleck 2020 (unlikelihood), Holtzman 2019 (degeneration), He 2019 / Xu 2021 (exposure bias), AIDE harness deterministic-enforcement doctrine. Triggered by: a marker-weighted SFT run producing pure im_start/credo loops at generation, or a boundary-probe showing P(marker) above the content prior but free-run failing to progress.
---

# SFT Format Marker Loop — Extreme Weighting Creates a Greedy Attractor

## Failure pattern (2026-09-09, verified on cipher v6 52.9M, 960 pairs, lr 2.5e-5)

A sequence of two runs on the SAME base (`best_local30a12.pt`) with the SAME fixed-mask shards (`E:\shards_v6\sft_cross_1024_fix`, 516,514 loss tokens):

| Run | Marker weights | Boundary P(im_start) | Gate2 greedy behavior (the ORACLE) |
|---|---|---|---|
| fixed-mask, w=1 | all 1.0 | 9.9e-5 … 1.0e-3 | 0/7 open; space + corpus text |
| flat `--marker-w 20` | im_start/credo/im_end = 20 | 2.3e-4 … 2.4e-3 | premature `<|im_end|>` in 3–13 tokens |
| asym `--marker-w-im 40 --marker-w-credo 20 --marker-w-end 1.0` | 40 / 20 / 1 | 6.6e-4 … 1.8e-2 | **5/7 open `<|im_start|>`, then LOOP: `im_start im_start im_start credo im_start…` for the full 700-token cap; `closes_im_end` False in all modes** |

Best checkpoints archived: `best_sft_local30a12_pre_asym_20260909_0345.pt` (flat-20), `best_sft_local30a12_pre_markerw_20260908_235905.pt` (w=1). Train-time logs: `sft_run_markerw.log`, `sft_run_asym.log`; gates: `sft_gate2_markerw.log`, `sft_gate2_asym.log` (E:\pip_temp\opencode\).

**The signature is simple:** the opener is learned (big progress vs 0/7), but the model cannot ESCAPE the marker tokens. Every marker outranks every content token at every position after the first. This is NOT "format half-learned" (see `fsi-sft-few-pairs-undertrained` — that one never opens) and NOT "loss drops but format absent" (see `fsi-sft-50m-56-pairs-format-collapse`). It is a NEW mode: **overshoot** — the weighting worked too well and pinned the decoder distribution onto the marker manifold.

## Law (per R8)

**Marker-token loss weighting on a small model is a knife edge: too little → opener never fires (prior wins); too much → the token's logit is inflated globally, greedy decode locks into a self-reinforced marker loop, and the format is DEAD (worse than the pre-weighting model for generation). The weight must be MODERATE enough that content tokens still dominate the total loss budget, AND the training must close the teacher-forcing/free-run gap. If a marker loop appears after weighting, STOP weighting escalation; reduce weights toward moderate and (if the loop persists) close exposure bias + apply decode-side grammar enforcement. NEVER keep raising the weight on the same tokens.**

## Why this happens (research, cited)

1. **Self-reinforcement loops (Fu et al., NeurIPS 2022 "Learning to Break the Loop"):** LM repetition is driven by (a) preference to repeat previous content, (b) a **self-reinforcement effect — the more a token repeats in context, the higher its probability** , (c) higher-initial-probability tokens reinforce FASTER and stronger. Our 40x im_start made it the highest-initial-probability token → each repeated `im_start` in context boosted the next `im_start`. Greedy decode then strands the model in the attractor.
2. **Holtzman et al. 2019 (The Curious Case of Neural Text Degeneration):** greedy (argmax) decoding is the failure configuration; degeneration loops are its canonical symptom. Combined with (1): extreme-weight-inflated markers + greedy = guaranteed attractor.
3. **WIT (TACL 13:1360–1380, 2025, "On the Effect of Instruction Tuning Loss on Generalization"):** conventional IT (prompt weight 0, response weight 1) is **never optimal**; and critically for us — **extreme response weighting encourages memorization/overfitting of response patterns; moderate response-token weights offer the best robustness/generalization trade-off.** "No universal values of optimal weights exist across models or datasets." Our 40x/20x sits squarely in the warned-against extreme regime.
4. **CFT (arXiv 2510.10974, "Selective Critical Token Fine-Tuning"):** uniform weighting neglects that only a small subset of tokens is functionally indispensable. CFT weights ONLY tokens proven critical via counterfactual perturbation (< 12% of tokens), and CRUCIALLY frames the failure of naive weighting as **"distribution collapse on replaceable tokens."** A blind static multiplier on 3 free token IDs is the crude approximation — it cannot distinguish "im_start at the boundary (critical)" from "im_start anywhere (collapse)" at the logit level, because the gradient raises the token's global logit at ALL positions.
5. **Exposure bias (He et al. EMNLP 2019; Xu et al. BlackboxNLP 2021 "Relating Neural Text Degeneration to Exposure Bias"):** teacher-forced MLE trains the model to predict `credo` right after TRUE `im_start`; it never sees its OWN `im_start`-repeated context during training, so free-run divergence is invisible to the loss. Xu et al. show repeated content is "likely to co-occur with exposure bias" and that mistakes **self-reinforce** after the loop starts. Scheduled sampling (Bengio 2015)/professor forcing (NeurIPS 2016) are the standard training-side closes.
6. **AIDE deterministic-enforcement doctrine (aide-harness-prompt-scaffolding skill, verified):** "prose guides, code enforces" — hard format rules are enforced by DETERMINISTIC gates and parsers, never by hoping the LM emits them. The ChatML envelope is a fixed grammar: it can be grammar-enforced at decode time (mask `im_start` after position 0, mask repeated `credo`, terminate on `im_end`). This is not "cheating" — it is the documented product architecture, and it means a decode-side fix is legitimate production behavior, not a test hack.

Why this is NOT about pair count first: our 960 pairs exceed the "≤100 pairs" boundary but we still hit a hard failure. The primary cause here is the weight magnitude + greedy + teacher-forcing gap. Data scale (LIMA 1K+) remains a contributing dependency (see dependency matrix), but the ADJUSTABLE knob that caused THIS regression is the marker weight.

## How to detect (must run before deciding anything)

1. **Gate2 (generation, both greedy and house modes)** — after training, run `sft_gate2_trainfmt.py` (7 kinds). Count:
   - `opens_im_start` per mode ✓ (progress indicator)
   - `cont tokens` — if it hits the cap (700) on any test with ALL marker tokens → **marker loop confirmed**.
   - `closes_im_end` — must be True with real content between open/close; False + loop = loop confirmed.
2. **Boundary probe** (`sft_boundary_probe.py`): P(marker) vs P(space▁) at the first answer position, per prompt. Loop risk is HIGH when P(im_start) at the boundary rivals/exceeds space but gate free-run loops anyway — the decoder has learned the OPEN but not the PROGRESS (chain `im_start→credo→\n→sop tags→content→im_end`).
3. **Loop-quantifier (add to any future gate script):** over the first 100 free-run tokens count max repeated count of any single token; if `im_start` or `credo` appears ≥ 5 times AND those tokens are >50% of the sample → loop confirmed, escalating weights is FORBIDDEN.
4. **Check train-time marker share:** from metrics.csv, compute fraction of loss budget at markers (weight × marker positions / weighted total). Above ~25% of budget at markers is a red flag for this regime.

## Dependency matrix

Every action below has hard dependencies. Do NOT skip a dependency or invert an order. "GATED" rows must be measured, not assumed.

| # | Action | Depends on (must be true first) | Produces | Exit gate (measured) |
|---|---|---|---|---|
| D1 | Decide product contract: does production/harness inject-and-scan the envelope via deterministic gates (AIDE doctrine), or must the RAW model self-generate the full envelope? | Read `aide-harness-prompt-scaffolding` (verified: deterministic enforcement) + check gate script intent | contract = HARNESS-ENFORCED or RAW-FREE-RUN | Written decision + why; if uncertain, ASK the operator (R2/ask-dont-circle) |
| D2 | Classify the failure signature (see "How to detect") | Gate2 + boundary-probe outputs from the CURRENT model | classification: half-learned / absent-format / **marker-loop** / premature-close | Classification recorded; marker-loop requires THIS skill |
| D3 | Decode-side containment (fixes symptom, ships today) | D1 = HARNESS-ENFORCED (eligible); current model produces opener or partial envelope | Constrained-decode gate: hard-mask duplicate `im_start`/`credo`, require progression through fixed grammar states, terminate on `im_end` | Re-run gate2 with constraints: 7/7 open-once + progress to tags/content + close exactly once. If D1 = raw-free-run, this is DIAGNOSTIC ONLY (SKIP to D4) |
| D4 | (If loop persists after D3 OR raw contract) Re-train with moderate weights | D2 = marker-loop; archive current best via `checkpoints_archive\*_pre_<name>.pt`; syntax-check `train_v6.py` | New checkpoint via `--marker-w-im 5 --marker-w-credo 3 --marker-w-end 1.0 --best-by-eval` (moderate, per WIT; NOT 40/20) | Boundary probe: P(im_start) ≥ space▁ on ≥ 3/4 prompts AND loop-quantifier: no token ≥5 repetitions in first 100 free-run tokens |
| D5 | If STILL loops after D4 → close exposure bias (training-side) | D4 completed and measured loop; scheduler/ckpt wiring confirmed in `train_v6.py` | Scheduled-sampling-lite: on ~15% of steps feed model-generated continuation as the input window (professor-forcing-lite), max finitely bounded risk | Same gate as D4; PLUS train/eval ce within 0.5 of prior run (stability guard) |
| D6 | If STILL fails after D4+D5 → the weight-tweak lane is at its limit | D5 measured | Escalate OUT of the weight lane | STOP. Scale data toward LIMA 1K+ diverse pairs (see fsi-sft-few-pairs-undertrained) and/or model 146.5M (local140a50). Never keep raising marker weights. |
| D7 | Promote/archive + journal + skill update | Any passing gate (D3/D4/D5) | Archived A/B + AGENT_NOTES entry + skill addendum with numbers | R4: only verified artifacts; record exact weights, evals, gates |

## Threat matrix

| Threat | When it bites | Detection | Control |
|---|---|---|---|
| Marker loop (attractor) — the core failure | Marker weight extreme (≥20x), greedy decode | Gate2 hits cap with all-marker output; loop-quantifier ≥5 repeats | Moderate weights (≤5–8x opener); decode-side grammar mask; never escalate weight |
| Premature close | `im_end` weight inflated (flat w=20 case) — closer token's global bias raised | Gate2 closes in 3–13 tokens, no content | `im_end` weight = 1.0 (denominator dilution does the suppression); never boost closer |
| Weight escalation spiral (R8 violation) | Belief that "more weight kills the loop" | Prior run classification is marker-loop and next run raises weight | The LAW above: loop means STOP escalating; reduce weight |
| Exposure-bias divergence masked by teacher forcing | Training loss looks healthy; free-run diverges | Loss drops; gate loops | D4 → D5 scheduled-sampling-lite; D3 decode containment in parallel |
| Decode-side masking hides a broken model (shipping symptom, not cause) | D3 passes so team "ship it" without D4/D5 | No planning to re-train; mask lives only in gate not production | D1 contract written; D3 explicitly labeled containment; D4/D5 still queued |
| Data-scale confound: blaming weights for a data problem | Corpus still near 960 pairs, low diversity | Varied prompts generalize poorly even at good weights (probe spread) | D6 escalation to LIMA-scale data / larger model; do NOT interpret as "need more weight" |
| Eval-best checkpoint picks an overfit/looping epoch | best-by-eval monitors plain ce only | best ckpt loops though an earlier ckpt doesn't | Keep eval on val set separate; verify loop-quantifier on the CHOSEN checkpoint before promotion |
| Param-confusion (which weight flag did this run use) | Multiple --marker-w* flags now exist | Log header omits the weights | Print resolved w_im/w_cr/w_en in the run header; archive name records weights |

## Exact action plan for THIS project (current state)

State on 2026-09-09: asym (40/20/1) checkpoint is `best_sft_local30a12.pt`, gate = marker loop confirmed (5/7 open, cap-hit loop). flat-20 archived as `pre_asym`. Fixed-mask pre-markerweight archived as `pre_markerw`.

1. **D1:** Confirm contract with operator. Production scaffold (aide-harness-prompt-scaffolding) already enforces format deterministically → default = HARNESS-ENFORCED; decode-side containment is production-eligible. If the operator wants raw self-format as the product contract, state D4 path instead.
2. **D2:** Already complete (marker-loop).
3. **D3 (if harness-enforced):** add grammar-constrained decode to `sft_gate2_trainfmt.py` — after one `im_start`, mask it; after one `credo`, mask it; require progression (sop/task/para tags then content); terminate at `im_end`. Re-run gate2: expect 7/7 open + progress + close. Record.
4. **D4 (regardless of D3):** re-train from `best_local30a12.pt` (BASE, not the looped ckpt) with `--marker-w-im 5 --marker-w-credo 3 --marker-w-end 1.0 --best-by-eval`, 1200 steps, all else unchanged. Why base not looped ckpt: the loop is in the checkpoint's weights; starting from the looped state risks redeeming the attractor or converging to a local loop basin.
5. **D5 (conditional):** only if D4 gate still shows a loop. Implement professor-forcing-lite. Re-train.
6. **D7:** on first green gate, archive both A/B checkpoints, journal numbers to AGENT_NOTES.md, append verified addendum to this skill.

## Verification battery (the "done" definition)

- Gate2 constrained-greedy: 7/7 `opens_im_start` exactly once, ≥2 tag/content tokens between open and close, `closes_im_end` True, no token repeated ≥5×.
- Boundary probe: P(im_start) ≥ P(space▁) on ≥3/4 prompts.
- Loop-quantifier: 0 samples with ≥5 repeats of any marker in first 100 free-run tokens.
- Eval checkpoints: 0 NaN, best-by-eval improved over prior best, best ckpt verified not-looping.
- Only claim "fixed" with the above green; anything less is R2-fail-open (say so, show the numbers).

## Cross-references

- Sister skills: `fsi-sft-few-pairs-undertrained` (never-opens mode), `fsi-sft-50m-56-pairs-format-collapse` (loss-drops-format-absent mode) — read all three against a failure before choosing
- `aide-harness-prompt-scaffolding` (deterministic enforcement doctrine — why decode-side containment is production-legit)
- `curriculum-learning-design` (scheduled-sampling-lite implementation wiring)
- `device-training-1060` (this machine's training discipline; checkpoints/archive paths)
- Project evidence: `sft_run_markerw.log/.err`, `sft_run_asym.log/.err`, `sft_gate2_markerw.log`, `sft_gate2_asym.log`, `sft_boundary_probe{2,3}.log` (E:\pip_temp\opencode\), checkpoints under `E:\FSI-FELON\models\fsi_felon_cipher\checkpoints_v6\` + `checkpoints_archive\`
- AGENTS.md R8 (Fail Once → Stop → Research → Skill → Act → Verify)