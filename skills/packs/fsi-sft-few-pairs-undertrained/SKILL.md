---
name: fsi-sft-few-pairs-undertrained
description: Detect the "SFT format is half-learned" failure mode in small LMs (≤200M params) trained on too-few SFT pairs (<200). The model emits the ChatML envelope start (im_start + credo) but never closes with im_end, and the content between is random tokens. Triggered by the twice-fail law — apply at the first sign of "the model starts with the right format but never finishes."
---

# SFT with Too-Few Pairs on a Small Model — Format Half-Learned

## Failure pattern (2026-09-06, observed on cipher v6 52.9M SFT)

Per pipeline-phase-7-post-train-data, the 7 hand-crafted gold docs were split into 56 SFT pairs. After 1 epoch (28 steps at batch 1, lr 5e-5 with cosine over 28 steps, wd 0.01, grad_ckpt on), the SFT'd model:

- ✓ Emits `<|im_start|>` at the start of every answer
- ✓ Emits `<|credo|>` immediately after
- ✗ **Never** emits `<|im_end|>` to close the turn
- ✗ Content between credo and "end" is random Latin/math/garbage tokens
- ✗ SFT loss did not drop (10.35 → 10.35 over 28 steps)

This is a **half-learned format**: the model learned that im_start + credo is the response opening, but didn't learn the closing convention or the actual content generation.

## Law (per R8)

**SFT on <200 pairs will not produce a working format for a 50-150M model. Stop the SFT run, grow the gold-doc corpus, and retry. SFT on too-few pairs is worse than no SFT — the model has half-learned the format, contaminating downstream distillation.**

## Why this happens (per the SFT literature)

Per LIMA (2305.11206), Phi-1 (2306.11644), SmolLM2 (2502.02737), and LLaMA2 SFT (2307.09288):

1. **LIMA: 1,000 curated examples beat 65,000 uncurated.** For a 50-150M model, the minimum viable SFT corpus is 1K-2K pairs. 56 pairs is 0.28% of that target.
2. **Phi-1: ~28 epochs over a 37.7M-token curated corpus is acceptable in this regime.** 1 epoch is the LOW end of the range. 28 steps × 1 sequence = 28 sequences total, which is NOT 1 epoch on 56 pairs (it's 0.64 epochs at batch 1).
3. **SmolLM2 used ~20K SFT pairs** for the 1.7B model. Scaling to 50M, ~2-5K pairs is the LIMA-aligned target.
4. **LLaMA2 SFT practice: loss-mask the instruction tokens** so the model is only graded on the answer. Without this, the model has to learn to continue the instruction as part of the target, which is a harder optimization.

The 28-step run on 56 pairs at lr 5e-5 (cosine over 28 steps → ~0 effective LR at end) is the **worst possible SFT configuration** for learning the format. The model gets enough signal to memorize "respond with im_start+credo" but not enough to learn the closing or the content.

## How to detect (the gate to write)

```python
def gate_1_byte_exact_format(model, tokenizer, test_prompts, kind_tags):
    """Test if the SFT'd model produces the full ChatML envelope.
    
    Per pipeline-phase-7 §6: byte-exact formats parse (env strict + chat honest
    gate). The model MUST produce <|im_start|><|credo|>{content}<|im_end|> for
    every test prompt. Any prompt that produces content without <|im_end|>
    after 200+ new tokens FAILS.
    """
    for prompt, kind in zip(test_prompts, kind_tags):
        ids = encode(f"<|im_start|><|credo|>\n{prompt}")
        for _ in range(600):
            next_id = greedy(model, ids)
            ids = ids + [next_id]
            if next_id == 24024:  # <|im_end|>
                break
        if ids[-1] != 24024:
            return ("FAIL", prompt, "no <|im_end|> in 600 tokens")
        # Decode and check the content is non-garbage
        content = decode(ids)
        if looks_like_garbage(content):
            return ("FAIL", prompt, "garbage content")
    return ("PASS", None, None)
```

## How to fix (in order, per the research)

1. **Grow the gold-doc corpus to LIMA scale (1K pairs minimum).** Per the LIMA cadence in `pipeline-phase-7-post-train-data` §2, the operator hand-crafts the first 1-2, the model proposes batches of 5-10, the operator verifies, repeat to 1K. At 50M, 1K pairs is the minimum to learn the format.
2. **Add a loss-mask** that hides the instruction tokens (PAD the instruction positions, only score the answer). Without this, the model wastes capacity learning to continue the instruction.
3. **Train for more steps.** 1 epoch over 1K pairs = 500 steps at batch 2. 1 epoch is the LLaMA2 default; 2-3 epochs is the Phi-1 regime.
4. **Use a larger model** if you need format at <500 pairs. 150M model (local140a50) has 3x the capacity of 50M (local30a12) and may learn the format at the same data scale.
5. **Distill from a teacher.** Per the Phase 7 skill §3, a verified short trace from a teacher (Qwen3.5-4B local) teaches the format faster than human-written gold docs. The teacher can produce 1K+ traces per hour with the verifier gate.

## The cross-references

- E:\pip_temp\opencode\pilots\sft_chunk_001_b1_gc.log (the failing 28-step run)
- E:\pip_temp\opencode\gate1.log (the 7-prompt generation test showing im_start+credo without im_end)
- C:\Users\Grey_\.agents\skills\pipeline-phase-7-post-train-data (the Phase 7 spec)
- C:\Users\Grey_\.agents\skills\pipeline-phase-8-post-train-runs (the SFT recipe)
- AGENTS.md R8 (Fail Once → Stop → Research → Skill → Act → Verify)
- Project: FSI FELON cipher pretraining (50-150M, GTX 1060, textbook + code)
