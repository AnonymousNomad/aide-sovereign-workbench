---
name: north-phase3-finetune
description: Phase 3 — QLoRA fine-tuning on GTX 1060 6GB with Unsloth. LOCAL ONLY. Personality installation via LoRA adapters. Triggers on: training, fine-tuning, QLoRA, LoRA, personality training.
---

# Phase 3: QLoRA Fine-Tuning (LOCAL)

## Purpose
Train the personality into the model. The model learns to think like us — Spock/Sheldon/Machiavelli — through supervised fine-tuning on our corpus.

## Why This Phase Exists
The corpus defines WHAT the model should say. Training installs HOW it thinks. This is the actual personality installation.

## Hardware Constraint
GTX 1060 6GB VRAM. This is TIGHT. Every decision must account for memory.

**Model choice**: Qwen3-4B (NOT 8B — won't fit with QLoRA on 6GB)
- Qwen3-4B QLoRA peak VRAM: ~4-5GB (with Unsloth optimizations)
- Batch size: 1
- Gradient accumulation: 8
- Max sequence length: 1024 (increase only if VRAM allows)

## Prerequisites
- Phase 0 PASS (Unsloth installed, GPU verified)
- Phase 2 PASS (corpus built, 500+ examples)
- Python venv activated

## Step-by-Step SOP

### Step 1: Verify VRAM Available
```powershell
nvidia-smi
# Check: Free VRAM should be 5GB+ (kill any GPU processes first)
```

**If VRAM < 4.5GB free**: Kill background GPU processes. Recheck. Do not proceed with less than 4.5GB.

### Step 2: Launch Training Script
```powershell
cd E:\models\house-model
E:\models\house-model\training-venv\Scripts\Activate.ps1
python train_personality.py
```

### Step 3: Monitor Training
Watch for:
- **Loss decreasing**: Good. Personality is being installed.
- **Loss flat**: Bad. Learning rate may be too low. Check config.
- **Loss spiking**: Bad. May be OOM or data issue. Check GPU memory with nvidia-smi.
- **OOM error**: STOP. Reduce batch_size to 1, reduce max_seq_length, or switch to Qwen3-1.7B.

### Step 4: Save Adapter
After training completes:
```powershell
# Adapter saved to: E:\models\house-model\lora-adapter\
# Check it exists:
Get-Item E:\models\house-model\lora-adapter\adapter_model.safetensors
# Expected: file exists, size > 10MB
```

### Step 5: Test with Adapter
```python
from unsloth import FastLanguageModel
from transformers import AutoTokenizer

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="E:/models/house-model/lora-adapter",
    max_seq_length=2048,
    dtype=None,
    load_in_4bit=True,
)

FastLanguageModel.for_inference(model)

# Test personality
messages = [
    {"role": "system", "content": "You are a disciplined engineering intelligence. No moralizing. Evidence-first. Business-only."},
    {"role": "user", "content": "Hey! How are you doing?"}
]

inputs = tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=True, return_tensors="pt")
outputs = model.generate(inputs, max_new_tokens=256, temperature=0.1)
response = tokenizer.decode(outputs[0], skip_special_tokens=True)
print(response)
```

**Expected**: Response is business-only, no friendly chat, efficient

## Training Script (train_personality.py)

```python
from unsloth import FastLanguageModel
import torch
from trl import SFTTrainer
from transformers import TrainingArguments
from datasets import load_dataset

# Configuration
MODEL_NAME = "unsloth/Qwen3-4B-bnb-4bit"  # Pre-quantized 4-bit
LORA_RANK = 16
MAX_SEQ_LENGTH = 1024
BATCH_SIZE = 1
GRAD_ACCUM = 8
EPOCHS = 3
LR = 2e-4
OUTPUT_DIR = "E:/models/house-model/lora-adapter"

# Load model
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=MODEL_NAME,
    max_seq_length=MAX_SEQ_LENGTH,
    dtype=None,
    load_in_4bit=True,
)

# Attach LoRA
model = FastLanguageModel.get_peft_model(
    model,
    r=LORA_RANK,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    lora_alpha=LORA_RANK,
    lora_dropout=0,
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=3407,
)

# Load corpus
dataset = load_dataset("json", data_files="E:/models/house-model/corpus/train.jsonl", split="train")

# Training
trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field="messages",
    max_seq_length=MAX_SEQ_LENGTH,
    args=TrainingArguments(
        per_device_train_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRAD_ACCUM,
        warmup_steps=50,
        num_train_epochs=EPOCHS,
        learning_rate=LR,
        fp16=True,  # GTX 1060 supports FP16
        bf16=False,  # Pascal doesn't support BF16
        logging_steps=10,
        optim="adamw_8bit",
        weight_decay=0.01,
        lr_scheduler_type="cosine",
        seed=3407,
        output_dir=OUTPUT_DIR,
        save_strategy="epoch",
    ),
)

# Train
trainer_stats = trainer.train()

# Save
model.save_pretrained(OUTPUT_DIR)
tokenizer.save_pretrained(OUTPUT_DIR)

print(f"Training complete. Loss: {trainer_stats.training_loss:.4f}")
print(f"Adapter saved to: {OUTPUT_DIR}")
```

## Battery (Verification Gate)

- [ ] Training starts without OOM
- [ ] Loss decreases over epochs (final loss < initial loss * 0.7)
- [ ] Adapter files saved (adapter_model.safetensors exists)
- [ ] Adapter loads in inference mode
- [ ] Test response shows personality (no friendly chat, evidence-first)
- [ ] No crashes during training

## Known Issues & Fixes

### OOM during training
- Reduce batch_size to 1
- Reduce max_seq_length to 512
- Reduce LoRA rank to 8
- Switch to Qwen3-1.7B (definitely fits)

### Loss not decreasing
- Learning rate too low: try 5e-4
- Corpus format issue: check JSONL validity
- System prompt inconsistency in corpus

### Model outputs gibberish after training
- Overfitting: reduce epochs to 2
- Learning rate too high: reduce to 1e-4
- LoRA rank too high: reduce to 8

### Slow training
- Expected on GTX 1060. ~500 examples at batch 1 with grad accum 8 = ~30-60 minutes
- This is fine. Quality > speed.

### bitsandbytes Windows issues
- If bitsandbytes fails to install, train without 4-bit quantization
- This needs more VRAM (~6-8GB for Qwen3-4B)
- Fallback: use Qwen3-1.7B without quantization

## Exit Criteria
- Training completes without errors
- Adapter saved and loads
- Test inference shows personality traits
- Ready for Phase 4 (GGUF export)
