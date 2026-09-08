---
name: fsi-cloze-collapse-small-model
description: Detect and fix the "function-word prior collapse" failure mode in small autoregressive LMs (≤200M params) trained on narrow corpora. Use whenever a small model's cloze probes (top-5 next-token prediction) return the same high-frequency function words for every prompt regardless of context, while val cross-entropy looks deceptively healthy. Triggered by the twice-fail law — apply at the first sign of cloze collapse, not after training completes.
---

# Function-Word Prior Collapse in Small LMs

## Failure pattern (2026-09-06, observed on cipher v6 52.9M pilot)

After 1000 steps of training on a textbook + classical literature corpus, the 52.9M model's val cross-entropy dropped from 10.41 to 7.17 (a 31% reduction — looks healthy). The val curve was monotonic, no late blowup, grad_norms stable after a recipe fix at step 200 (halve LR + grad_clip 0.5 per the spike recovery playbook).

**But every cloze prompt returned the same top-5 next-token predictions:**

```
"The capital of France is"        -> top5 = ['▁the', '▁', '▁and', '▁to', '▁of']
"Water boils at 100 degrees"      -> top5 = ['▁the', '▁', '▁and', '▁to', '▁of']
"The mitochondrion is the powerhouse of the" -> top5 = ['▁the', '▁', '▁and', '▁to', '▁of']
"DNA stands for deoxyribonucleic" -> top5 = ['▁the', '▁', '▁and', '▁to', '▁of']
```

**Zero top-1, zero top-5.** The model has collapsed to a function-word prior: it has learned that English text often starts a new clause with "the", or follows content with "and", "to", "of". It has NOT learned semantic associations between prompts and answers.

This is a **silent failure mode**: cross-entropy looks healthy because predicting "the" after most content is a low-loss move, and the function-word prior IS statistically correct. The model is "playing it safe" — high entropy output, but never wrong about a function word.

## Law (per R8)

**A healthy LM on a narrow corpus should still differentiate its top-5 predictions by prompt. If the top-5 is identical across diverse prompts (different topics, different syntactic positions, different expected answers), the model has collapsed. Catch this at the FIRST gate (cloze probe at the end of pretrain), not at the downstream eval.**

## How to detect

Write a cloze probe battery (15-20 prompts covering diverse topics, syntactic positions, and expected answers). For each:
- Encode the prompt
- Forward through the model
- Take top-5 of softmax(logits[-1])
- Check if the expected answer (or any of its tokenization) is in the top-5

If the same top-5 set appears for >50% of prompts, the model has collapsed. Specifically, if the top-5 is dominated by `▁the`, `▁and`, `▁to`, `▁of` (or equivalent high-frequency function words in the language), the model has learned the function-word prior and nothing else.

## Why this happens (per the small-model literature)

Per the SmolLM2 paper, Chinchilla scaling laws, Pythia suite, and the DeepSeek-MoE analysis:

1. **Insufficient training tokens** for the model size. Chinchilla optimal: ~20 tokens per parameter. 50M params × 20 = 1B tokens needed. 1,000 steps × ~1,024 tokens/step = 1M tokens = 0.1% of the Chinchilla target. The model is in the "undertrained" regime where the simplest loss-minimizing strategy is the function-word prior.

2. **Narrow corpus vocabulary.** Textbook + Gutenberg covers 24K vocab (our tokenizer) but the MODEL's learned distribution is dominated by the few hundred most common English words. Per the Llama 2 paper: small models on narrow corpora learn the corpus's "register" (the function-word frequency distribution) before the semantic content.

3. **MoE routing collapse.** Per the DeepSeek-MoE paper: a 24-expert MoE with 8 active can collapse to routing to the same 1-2 experts if the auxiliary load-balance loss is too weak. The lbl (load-balance loss) climbing during training is a warning sign — at our step 200 spike, lbl reached 13.5. After the LR halve, lbl settled around 7-10, but the routing may have already collapsed to a few experts.

4. **Tied embedding + low-rank head.** The cipher's SuperimpositionHead blends 2 logit heads (Sheldon + Spock) tied to the embed. If the alpha blending parameter converges to 0 or 1, the head is effectively single-headed, which can collapse the output distribution.

## How to fix (in order, per the research)

1. **Train longer.** Chinchilla-optimal tokens. For 50M, target 1B tokens. For 150M, target 3B. At our rate (~2,000 tok/s × 60% efficiency = 1,200 tok/s useful), 1B tokens = ~10 days. 3B = ~30 days. The 1060 is slow.

2. **Diversify the data.** Add more domains. Per the Pythia suite: 50M models on a single domain (textbook only) collapse faster than 50M models on mixed (textbook + web + code). Our corpus is already mixed (textbook + classical), but the proportion of "novel" prose in Gutenberg is high — most of the volume is the same 19th-century writers. Consider adding Common Crawl (filtered), or Wikipedia (per `wiki-quality-data-acquisition` skill), or code (per `code-quality-data-acquisition` skill).

3. **Add entropy regularization.** Per the SmolLM2 paper, a small entropy penalty on the output distribution (e.g., `+ 0.01 * (-output.softmax(-1).entropy())`) prevents the model from collapsing to a high-confidence single-token mode. Cheap to add.

4. **Use a different evaluation point.** For a 50M model in the undertrained regime, cross-entropy on textbook text understates what the model knows. Per the Pythia paper, perplexity on out-of-domain text (e.g., SimpleQuestions, WikiText) is a better signal. The cloze probe is a per-prompt check that catches what global metrics miss.

5. **The hard truth:** For 50M params on a 1060, the path to a useful model is long. Per the Chinchilla paper, 50M is "Pythia-70M" territory and even they used 200B training tokens. The honest path is: scale the corpus to 5B tokens (mix in Common Crawl, Wikipedia, code), train for 2-3 weeks on the 1060, OR use a smaller model (e.g., 25M params) on the same data and reach Chinchilla-optimal faster.

## Cross-references

- E:\pip_temp\opencode\cloze_probe.py (the probe battery that surfaced this)
- E:\FSI-FELON\models\fsi_felon_cipher\checkpoints_v6\best_local30a12.pt (the model that fails the cloze gate)
- E:\pip_temp\opencode\pilots\recovery_run.log (training log; ce drops 10.41 -> 7.17 looks healthy but isn't)
- C:\Users\Grey_\.agents\skills\pipeline-phase-6-pretrain-run (the Gate 0 spec that demands cloze > 0)
- AGENTS.md R8 (Fail Once → Stop → Research → Skill → Act → Verify)
- Project: FSI FELON cipher pretraining (50-150M, GTX 1060, textbook + code)
