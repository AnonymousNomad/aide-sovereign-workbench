---
name: fsi-sft-50m-56-pairs-format-collapse
description: Detect the "loss drops but format doesn't learn" failure mode in 50M-param LMs trained on ≤100 SFT pairs. Cross-entropy drops 0.2-0.3 over 1-2 epochs but the generated output remains random tokens (the model has memorized the input opening but not the answer structure). Triggered by the twice-fail law — apply at the first sign of "loss is dropping but generation is garbage."
---

# SFT Loss Drops but Format Doesn't Learn on 50M + ≤100 Pairs

## Failure pattern (2026-09-06, observed on cipher v6 52.9M)

After running SFT on 56 LIMA-style pairs (loss-masked, 1-2 epochs, LR 5e-5, wd 0.01, grad_ckpt on, base = best_local30a12.pt):

- **Loss DOES drop:** train CE 10.36 → 10.16 (over 2 epochs, -0.20)
- **Eval CE drops slightly:** 10.36 → 10.30 (-0.06)
- **BUT generation is still random tokens:** model emits `<|im_start|><|credo|>` then Latin/math/garbage, never `<|im_end|>`, no coherent content.

The loss-mask helps (the model now only gets loss on the answer tokens), the recipe is right (LR 5e-5, wd 0.01, 1-2 epochs per LLaMA2/Phi-1), and the model has more capacity than 1 epoch (it does improve). But the gain is too small to manifest in generation.

## Law (per R8)

**For a 50M model, ≤100 SFT pairs cannot teach the ChatML envelope. The loss is dominated by the "predict the next answer token" task, which the model solves with random tokens (because it has no better prior). To learn the format, the model needs ≥200 pairs AND a model with enough capacity to attend to the full envelope. For 50M, that's ≥500 pairs.**

## Why this happens (per the SFT literature)

1. **LIMA (2305.11206):** "1,000 curated examples beat 65,000 uncurated." The minimum is 1K. 56 is 5.6% of the LIMA target. SmolLM2 used 20K for a 1.7B model; scaling down, 50M needs 1-5K.
2. **Phi-1 (2306.11644):** Used 28 epochs over 37.7M tokens of curated data for a 350M model. 1 epoch on 56 pairs = 56 sequences = ~50K tokens. Phi-1 had 740x more data per epoch.
3. **50M is the bare minimum** for format-learning. The cipher v6 52.9M with 12 layers, d=384 has effective receptive field well under 2K tokens. For long SFT answers (500-1500 tokens), the model literally cannot attend to the full sequence.
4. **The loss is dominated by entropy, not format.** With 50M params and 50K tokens of training, the optimizer reduces loss by finding better low-entropy continuations. The model can drop loss 0.2 by predicting Latin/math/random tokens with slightly higher likelihood — without learning any format.

## How to detect (the proper Gate 1) — 2026-09-08 CORRECTED

```python
def gate_1_byte_exact_format(model, tokenizer, test_prompts, kind_tags):
    """Test if the SFT'd model produces the full ChatML envelope.
    
    Per pipeline-phase-7 §6 + pipeline-phase-8 §6: byte-exact formats parse.
    A model that loses 0.2 ce but still produces garbage has FAILED the gate.
    The gate checks GENERATION, not just loss.

    CRITICAL (2026-09-08): the prompt MUST match the TRAINING input shape.
    The converter builds `instr + <|im_end|>` and the answer is
    `<|im_start|><|credo|><sop_type>...</sop_type>...<|im_end|>`.
    So the eval must feed `encode(prompt + "<|im_end|>")` and check the
    CONTINUATION opens with <|im_start|> and closes with <|im_end|>.

    OLD template `encode(f"<|im_start|><|credo|>\n{prompt}")` is WRONG: that
    shape never appears in training (after <|credo|> training always has
    <sop_type>, never task text). Its im_start/credo checks were VACUOUS
    (those tokens were in the input, echoed) and im_end=False was
    uninformative (OOD prefix). Any gate that puts im_start/credo into the
    prompt is testing the wrong distribution.
    """
    IM_START, IM_END = 24023, 24024
    for prompt, kind in zip(test_prompts, kind_tags):
        # TRAINING-MATCHING prompt: instr + IM_END (same as the converter).
        ids = encode(prompt + "<|im_end|>")
        cont = []  # continuations only, NOT the echoed prompt
        for _ in range(600):
            next_id = greedy(model, ids)
            ids = ids + [next_id]
            cont.append(next_id)
            if next_id == IM_END:
                break
        if not cont or cont[0] != IM_START:
            return ("FAIL", prompt, "continuation does not open with <|im_start|>")
        if ids[-1] != IM_END:
            return ("FAIL", prompt, "no <|im_end|> in 600 tokens")
        content = decode(cont)
        if looks_like_garbage(content):
            return ("FAIL", prompt, "garbage content (entropy collapse)")
        # Per LIMA: check content is topically on-task
        if not on_topic(content, prompt):
            return ("FAIL", prompt, "off-topic response")
    return ("PASS", None, None)
```

## How to fix (in order, per the research)

1. **Scale the data to LIMA 1K minimum.** Per LIMA: 1,000 curated examples. For 50M, the LIMA-aligned target is 1-5K pairs. Mass-generating 20 variants of the same section IS NOT LIMA — LIMA is 1K diverse pairs.
2. **Distill from a teacher.** Per `post-training-distill`: for each SFT task, sample N candidate completions from the current model, run through the verifier, keep ONLY the passing ones. With a teacher (Qwen3.5-4B local) generating SFT-style answers, the verifier gate can produce 1K+ verified pairs in hours.
3. **Scale the model.** Per the locked design: the full cipher is `local140a50` (146.5M), 3x the capacity. Same 56 pairs + 146.5M may close the format gap where 52.9M doesn't.
4. **Combine #1 and #3:** 1K LIMA-style pairs + 146.5M model = the canonical SOTA path for a 50-150M cipher.

## Cross-references (2026-09-08: gate templates corrected above)

- E:\pip_temp\opencode\sft_gate2_trainfmt.py + .log (the CORRECTED probe: training-matching `instr + im_end` prompt; SFT model 7/7 fails to open envelope)
- E:\pip_temp\opencode\convert_sft_to_shards_v2.py (the loss-mask boundary bug: `t >= instr_len` never grades the `im_end -> im_start` opening transition; fixed by grading `t >= len(instr_ids)`)
- E:\pip_temp\opencode\pilots\sft_2ep_88.log (the 2-epoch run that DROPS loss but DOESN'T learn format)
- E:\pip_temp\opencode\gate1_2ep.log (the OLD generation test — its im_start+credo "pass" was a vacuous echo; superseded by gate2)
- C:\Users\Grey_\.agents\skills\fsi-sft-few-pairs-undertrained (sister skill: covers the related "less than 200 pairs" failure)
- C:\Users\Grey_\.agents\skills\pipeline-phase-7-post-train-data
- C:\Users\Grey_\.agents\skills\pipeline-phase-8-post-train-runs
- C:\Users\Grey_\.agents\skills\post-training-distill
- AGENTS.md R8 (Fail Once → Stop → Research → Skill → Act → Verify)
- Project: FSI FELON cipher pretraining (50-150M, GTX 1060, textbook + code)

## 2026-09-08 23:50 VERIFIED addendum (R8): loss-magnitude, not mask, is the binding constraint

Cross-reference to fsi-sft-few-pairs-undertrained. Same 52.9M SFT run after
the corrected mask: gate2 still 7/7 opens_im_start=False, but the boundary
probe proves the association EXISTS (P(im_start) rose ~40x over base to
3e-5..1e-4) yet UNDERFIRES because marker tokens are ~0.2% of CE mass vs a
2e-2..1.6e-2 space-? prior. Evidence files:
- E:\pip_temp\opencode\sft_boundary_probe.log (3-checkpoint boundary probe table)
- E:\pip_temp\opencode\sft_gate2_fixedmask.log (7/7 fail, but corpus-fluent house output = base prior surfaced)
- Retrain: sft_run_fixedmask.log (best 9.3920 at step 800 = TRAIN-best mis-selection; eval rose 9.64->10.03)

ACTIONABLE: (1) upweight envelope/marker targets in the SFT CE loss; (2) select
best by EVAL not train loss; (3) lengthen schedule so LR is not ~0 for the
final 100 steps. The decode collapse is a symptom of underweighted format
supervision � fix the loss or the model will keep eating pretrain priors.
