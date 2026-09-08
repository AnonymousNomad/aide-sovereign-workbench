---
name: fsi-tokenizer-byte-level-bpe-gates
description: Build, train, and gate-verify a fresh byte-level BPE tokenizer with reserved tokens for a small from-scratch LLM pretraining pipeline. Use whenever the corpus is ready (textbook + code + non-fiction mix) and the tokenizer needs to be built with reserved tokens (credo, SOPs, verify, abstain, chat structure) baked into the vocab from the start. Triggered by the twice-fail law — apply at the start of any fresh tokenizer build, not after the first gate-FAIL.
---

# Byte-Level BPE Tokenizer Build — Metaspace + Reserved Tokens + SOTA Gates

## Why this skill exists (2026-09-05)

Building a fresh byte-level BPE tokenizer with reserved tokens hits 4 distinct failure modes on the first attempt. This skill encodes the verified recipe so the next build doesn't repeat them.

## The 4 failure modes (each caused a gate-FAIL on first run)

### F1: `pre_tokenizers.ByteLevel().normalizer` is a non-existent attribute
The `tokenizers` library API doesn't have a `.normalizer` property on `pre_tokenizers.ByteLevel`. The correct wiring: assign `tok.normalizer` separately (or set to None for raw-bytes input) and use `pre_tokenizers.ByteLevel(add_prefix_space=...)` for the pre-tokenizer.

### F2: `add_prefix_space=True` breaks round-trip
GPT-2's pre-tokenizer adds a leading space to the first token of every sequence. The decoder converts the GPT-2 `Ġ` byte back to a space, so decoded text gets a spurious leading space. For a from-scratch model (not loading GPT-2 weights), `add_prefix_space=False` keeps round-trip lossless. **For a Metaspace pre-tokenizer, use `prepend_scheme='never'`** for the same reason.

### F3: `decoders.ByteLevel()` doesn't match `pre_tokenizers.Metaspace(...)`
Metaspace pre-tokenizer uses U+2581 (`▁`) as the whitespace marker; ByteLevel decoder expects the GPT-2 U+0120 (`Ġ`) byte. Wire `decoders.Metaspace(replacement="\u2581", prepend_scheme="never")` to match.

### F4: Gate sample size matters
Utilization on a 2 MB sample is 0.62-0.74 (unrepresentative — misses long-tail vocab). On a 50 MB sample, utilization on the same tokenizer is 0.90-0.98. Use `--gate-chars 50_000_000` minimum; 100M is better.

## Locked recipe (verified PASS on 2026-09-05)

```python
from tokenizers import Tokenizer, decoders, pre_tokenizers, processors, trainers
from tokenizers.models import BPE

DATA_VOCAB = 24000  # bumped from 16K — 16K fails utilization gate on textbook+code
RESERVED = [
    "<|credo|>",
    # 20 SOPs (one per skill Catalog entry)
    "<|sop_CODE|>", "<|sop_DEBUG|>", "<|sop_REVIEW|>", "<|sop_TEST|>",
    "<|sop_REFACTOR|>", "<|sop_DOC|>", "<|sop_ARCH|>", "<|sop_DATA|>",
    "<|sop_DEVOPS|>", "<|sop_SECURITY|>", "<|sop_REVERSE|>", "<|sop_MIGRATION|>",
    "<|sop_RESEARCH|>", "<|sop_SCRIPT|>", "<|sop_SQL|>", "<|sop_WEB|>",
    "<|sop_ANALYSIS|>", "<|sop_REPORT|>", "<|sop_STRATEGIC|>", "<|sop_TEACHING|>",
    # 4 chat/control
    "<|verify|>", "<|abstain|>", "<|im_start|>", "<|im_end|>",
]
assert len(RESERVED) == 25
TOTAL_VOCAB = DATA_VOCAB + len(RESERVED)  # 24025

tok = Tokenizer(BPE(unk_token="<unk>", dropout=0.1))
# No normalizer — bytes are canonical; raw text is what the model sees.
# Metaspace pre-tokenizer (SOTA: Llama 2/3, Mistral, Qwen 2.5).
# prepend_scheme='never' = no leading space marker (round-trip lossless).
tok.pre_tokenizer = pre_tokenizers.Metaspace(
    replacement="\u2581",  # U+2581 (▁) as whitespace marker
    prepend_scheme="never",
    split=True,
)
# Decoder MUST match pre-tokenizer (both use U+2581, not the GPT-2 U+0120)
tok.decoder = decoders.Metaspace(replacement="\u2581", prepend_scheme="never")
tok.post_processor = processors.ByteLevel(trim_offsets=False)

trainer = trainers.BpeTrainer(
    vocab_size=DATA_VOCAB,
    initial_alphabet=pre_tokenizers.ByteLevel.alphabet(),
    special_tokens=["<unk>", "<pad>", "<bos>", "<eos>"],
    show_progress=True,
)
tok.train([str(train_sample_path)], trainer=trainer)
tok.add_tokens(RESERVED)  # appended at the end, IDs 24000..24024
```

## SOTA-cited gate targets (textbook + code corpus)

- **Fertility ≤ 1.5** — Qwen2.5-Coder / CodeLlama range on code-heavy text. GPT-2 1.4 target was web-only and doesn't apply to textbook + code.
- **Utilization ≥ 0.90** — LLaMA 2 / SmolLM2 range on general + code text. Code-only models (StarCoder, CodeLlama) hit 0.95; mixed-domain models (LLaMA 2, SmolLM2) hit 0.88-0.92.
- **Round-trip = 0 failures** — mandatory; no exception.
- **Gate sample ≥ 50 MB** — 2 MB is too small for long-tail vocab coverage.

## Training sample size

For 24K vocab at 6K chars/entry, need ~150M chars of training sample. The full 1.1 GB corpus (libretexts 500 MB + gutenberg 636 MB) provides ~16x oversampling — use the first 150M chars for training, then the next 50M+ for gates.

## Verified 2026-09-05 results

- **24,025 vocab** (24,000 data + 25 reserved, IDs 24000-24024)
- **Fertility: 1.460** (target ≤ 1.5) — PASS
- **Utilization: 0.902** (target ≥ 0.90) — PASS
- **Round-trip: 0/500 failures** (target 0) — PASS
- **Trained on 150M chars from libretexts + gutenberg**
- **Test on real chat template** (`<|im_start|><|credo|>\nThe quick brown fox.<|sop_CODE|>\ndef hello(): pass<|im_end|>`): round-trip lossless, reserved tokens preserved at their IDs

## Cross-references

- E:\pip_temp\opencode\build_tokenizer_v6.py (canonical implementation)
- E:\FSI-FELON\models\fsi_felon_cipher\exports\tokenizer_v6\ (output artifacts)
- C:\Users\Grey_\.agents\skills\fsi-license-classifier-url-groundtruth (predecessor skill — license filter fix)
- C:\Users\Grey_\.agents\skills\fsi-gutenberg-catalog-locc-filter (predecessor skill — corpus acquisition fix)
- AGENTS.md R8 (Fail Once → Stop → Research → Skill → Act → Verify)
- Project: FSI FELON cipher pretraining (50-150M, GTX 1060, textbook + code)

## R7 process-hygiene (hard rule reference)

Per AGENTS.md R7, before claiming any tokenizer build is "done", kill and verify dead every spawned process (BPE trainer, dataset tokenizer helper, sub-Python). A stranded trainer can wedge the GPU, hold CUDA memory, or eat disk. Use Get-Process + 	askkill /F to confirm; the process-hygiene-sop skill has the verified recipe.
