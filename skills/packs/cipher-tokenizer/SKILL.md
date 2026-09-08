---
name: cipher-tokenizer
description: Complete the FSI Felon Cipher tokenizer from 500 to 32K vocabulary. Use when building, training, or verifying the cipher tokenizer. Phase 1 of cipher-cloud-training.
---

# Phase 1: Tokenizer Completion

## Purpose
Complete the cipher tokenizer from 500 vocab entries to 32768. The tokenizer is the model's interface to language.

## Current State
- Location: `E:\FSI-FELON\models\fsi_felon_cipher\code_tokenizer.py`
- Current vocab: 500 (incomplete)
- Target: 32768

## Why 32K Vocab
- NeurIPS 2024: Nv ~ C^0.42 (vocab scales sublinearly with compute)
- NeurIPS 2025: common-word single-token saturation ~24K
- Practical: 32K sweet spot for code+text at 200M-1B scale

## Step 1: Train BPE Tokenizer
```python
from tokenizers import Tokenizer, models, trainers, pre_tokenizers, decoders
import glob

tokenizer = Tokenizer(models.BPE())
tokenizer.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
tokenizer.decoder = decoders.ByteLevel()

special_tokens = [
    "<unk>", "<s>", "</s>", "<pad>", "<mask>",
    "<task>", "<guidelines>", "<check>",
    "<mind_spock>", "<mind_sheldon>",
    "<code>", "<execute>", "<observe>", "<deliver>",
    "<fim_prefix>", "<fim_suffix>", "<fim_middle>",
    "<sep>", "<persona>"
]

trainer = trainers.BpeTrainer(
    vocab_size=32768,
    min_frequency=2,
    special_tokens=special_tokens,
    show_progress=True,
)

# Gather ALL text sources
text_files = []
for d in ["E:\\queen-bee-v5\\training_curated",
          "E:\\queen-bee-v5\\training",
          "E:\\lab_training_corpus\\ferrell_coder"]:
    text_files.extend(glob.glob(f"{d}/**/*.txt", recursive=True))

tokenizer.train(text_files, trainer)
tokenizer.save("E:\\FSI-FELON\\models\\fsi_felon_cipher\\exports\\tokenizer_v5.json")
```

## Step 2: Verify
```python
def verify_tokenizer(path):
    tok = Tokenizer.from_file(path)
    assert tok.get_vocab_size() >= 30000, f"Vocab too small: {tok.get_vocab_size()}"

    for special in ["<s>", "</s>", "<pad>", "<task>", "<mind_spock>"]:
        assert tok.token_to_id(special) is not None, f"Missing: {special}"

    test = "def fibonacci(n):\n    if n <= 1: return n\n    return fibonacci(n-1) + fibonacci(n-2)"
    encoded = tok.encode(test)
    decoded = tok.decode(encoded.ids)
    assert decoded == test, f"Roundtrip failed"

    fertility = len(encoded.ids) / len(test.split())
    assert 1.0 < fertility < 5.0, f"Bad fertility: {fertility}"
    print(f"✓ Vocab: {tok.get_vocab_size()}, Fertility: {fertility:.2f}")

verify_tokenizer("E:\\FSI-FELON\\models\\fsi_felon_cipher\\exports\\tokenizer_v5.json")
```

## Verification Gate
```
PASS if: vocab >= 30000, all specials present, roundtrip passes, fertility 1.0-5.0
```

## What NOT To Do
1. DO NOT train tokenizer on cloud (CPU-only, wastes GPU money)
2. DO NOT use vocab < 24K
3. DO NOT change special tokens after data pipeline starts
4. DO NOT forget FIM tokens for code infilling
5. DO NOT use WordPiece (BPE is proven for code)

## Bugs
| Bug | Fix |
|-----|-----|
| Python re has no \p{L} | Use regex package |
| Vocab/merges mismatch | Assert vocab_size == len(merges) + 256 + len(special) |
| ByteLevel mismatch train/serve | Same pre_tokenizer everywhere |
