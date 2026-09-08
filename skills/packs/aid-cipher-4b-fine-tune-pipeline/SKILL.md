---
name: aid-cipher-4b-fine-tune-pipeline
description: End-to-end recipe for fine-tuning the AIDE in-house cipher-4b model: fix the broken venv, install the ML stack, generate SFT pairs (Node.js, no Python), run QLoRA training, convert LoRA to GGUF adapter, evaluate against the capability battery, promote/archive/rollback. Per the cipher-qlora-finetune skill, the AIDE baseline is 0.683 composite across 23 AIDE-world tasks; the v2 adapter must hit >= 0.02 delta with no category regression > 0.1 to promote. Use whenever the user wants to improve the in-house model, when the SFT corpus needs refreshing, or when a new v2 adapter is needed.
---

# AIDE cipher-4b Fine-Tune Pipeline — End-to-End Wire-In

## Status: BLOCKED (2026-09-03)

- SFT corpus: **EXISTS** at `E:\felon_workspace\cipher_v2\sft_train.jsonl` (4741 rows from prior session).
- Capability battery: **EXISTS** at `E:\pip_temp\opencode\capability_audit_cipher_4b.mjs` (23 tasks, baseline 0.683).
- LoRA → GGUF converter: **EXISTS** at `E:\llama-cpp\convert_lora_to_gguf.py` (or similar).
- Engine: **EXISTS** at `E:\llama-cpp\llama-server.exe` (CPU build, loads LoRA via `--lora`).
- **BLOCKER**: Python venv is broken. `E:\felon_workspace\venv_cipher\pyvenv.cfg` has `home = E:\Python310` which is itself a Python install — the venv can't initialize. System Python `E:\Python310\python.exe` does NOT have torch/transformers/peft installed.

This skill encodes the **exact venv-install path** so the next agent can unblock the lane and run the full pipeline.

## The exact venv-install sequence (the blocker)

The `aid-venv-care` + `failure-pythonpath-hijack` skills document the failure mode. The fix:

```powershell
# 1. Create a fresh venv with E:\Python311 (NOT E:\Python310, which is itself a Python install)
& E:\Python311\python.exe -m venv E:\felon_workspace\venv_cipher_v2

# 2. Verify the venv has a clean home
Get-Content E:\felon_workspace\venv_cipher_v2\pyvenv.cfg
# Expected: home = E:\Python311  (NOT E:\Python310)

# 3. Activate and install
& E:\felon_workspace\venv_cipher_v2\Scripts\Activate.ps1
pip install --upgrade pip
pip install torch==2.7.1+cu118 --index-url https://download.pytorch.org/whl/cu118
pip install transformers==5.16.1 peft==0.13.0 trl==0.11.4 bitsandbytes==0.45.0 accelerate datasets

# 4. Verify
& E:\felon_workspace\venv_cipher_v2\Scripts\python.exe -c "import torch, transformers, peft, trl, bitsandbytes; print('all OK')"
```

If `E:\Python311` doesn't exist, use `E:\Python310\python.exe -m venv --system-site-packages E:\felon_workspace\venv_cipher_v2` (allows access to system packages, avoids the home trap). Per `aid-venv-care`, the `--system-site-packages` flag bypasses the venv isolation but also bypasses the `home = E:\Python310` trap.

## The full pipeline (once venv is unblocked)

### Step 1: Verify SFT corpus

```bash
Test-Path E:\felon_workspace\cipher_v2\sft_train.jsonl
# Expected: True
wc -l E:\felon_workspace\cipher_v2\sft_train.jsonl
# Expected: 4741 (or more)
```

### Step 2: Verify capability battery

```bash
Test-Path E:\pip_temp\opencode\capability_audit_cipher_4b.mjs
# Expected: True
```

### Step 3: Write the training script

`E:\felon_workspace\train_cipher_v2.py` (QLoRA on the 4B, BF16 base):

```python
import torch
from datasets import load_dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, TrainingArguments
from trl import SFTTrainer

# 4-bit base (QLoRA on Pascal)
bnb = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,
)

# Load base from HF (NOT from GGUF — need safetensors)
# If only GGUF available, convert first:
#   python E:/llama-cpp/convert_hf_to_gguf.py --outdir E:/felon_workspace/cipher_hf --outfile base.safetensors E:/aide-sovereign-workbench/models/aide-house/base.q8_0.gguf
base = AutoModelForCausalLM.from_pretrained(
    "E:/felon_workspace/cipher_hf",
    quantization_config=bnb,
    device_map="auto",
    torch_dtype=torch.bfloat16,
)
base = prepare_model_for_kbit_training(base, use_gradient_checkpointing=True)

lora = LoraConfig(
    r=16,
    lora_alpha=32,
    lora_dropout=0.05,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    bias="none",
    task_type="CAUSAL_LM",
)
model = get_peft_model(base, lora)

# Tokenizer
tokenizer = AutoTokenizer.from_pretrained("E:/felon_workspace/cipher_hf")
tokenizer.pad_token = tokenizer.eos_token

# Load SFT corpus
dataset = load_dataset("json", data_files="E:/felon_workspace/cipher_v2/sft_train.jsonl", split="train")

# Training
args = TrainingArguments(
    output_dir="E:/felon_workspace/cipher_v2_adapter",
    num_train_epochs=1,
    per_device_train_batch_size=1,
    gradient_accumulation_steps=16,  # effective batch 16
    learning_rate=2e-4,
    warmup_steps=100,
    lr_scheduler_type="cosine",
    weight_decay=0.1,
    adam_beta1=0.9,
    adam_beta2=0.95,
    max_grad_norm=1.0,
    logging_steps=10,
    save_steps=500,
    bf16=True,
)

trainer = SFTTrainer(model=model, args=args, train_dataset=dataset, tokenizer=tokenizer)
trainer.train()
trainer.save_model("E:/felon_workspace/cipher_v2_adapter")
```

### Step 4: Convert LoRA → GGUF adapter

```bash
python E:/llama-cpp/convert_lora_to_gguf.py \
  --base E:/aide-sovereign-workbench/models/aide-house/base.q8_0.gguf \
  --outfile E:/aide-sovereign-workbench/models/aide-house/cipher_v2_lora.gguf \
  E:/felon_workspace/cipher_v2_adapter
```

### Step 5: Smoke-test the new adapter

```bash
E:\llama-cpp\llama-server.exe -m E:\aide-sovereign-workbench\models\aide-house\base.q8_0.gguf \
  --lora E:\aide-sovereign-workbench\models\aide-house\cipher_v2_lora.gguf \
  --host 127.0.0.1 --port 8085 --ctx-size 2048 --threads 4 --no-warmup --jinja
# GET http://127.0.0.1:8085/v1/models should return 200
```

### Step 6: Run the capability battery

```bash
node E:\pip_temp\opencode\capability_audit_cipher_4b.mjs
# Outputs composite score + per-task scores
# Baseline: 0.683
```

### Step 7: Apply the gate

| Composite delta | Action |
|---|---|
| ≥ +0.02 AND no category regressed > 0.1 | **PROMOTE**: rename `frontier-lora.gguf` → `frontier-lora.v1.gguf` (backup), rename `cipher_v2_lora.gguf` → `frontier-lora.gguf` |
| ∈ [-0.02, +0.02] | **ARCHIVE**: keep v1 as production, save v2 as `cipher_v2_lora.archived.gguf` |
| < -0.02 | **ROLLBACK**: delete v2, v1 stays |

### Step 8: Journal

Append to `AGENT_NOTES.md`:
```
- [YYYY-MM-DD HH:MM] T1: cipher-4b v2 fine-tune round N
  - Verdict: PROMOTE | ARCHIVE | ROLLBACK
  - Composite: X.XXX (baseline 0.683, delta +/-X.XXX)
  - Per-category: [list]
  - Files: [list with paths]
  - Next: [next step]
```

## Dependencies

- **Working venv** with torch 2.7.1+cu118, transformers 5.16.1, peft 0.13.0, trl 0.11.4, bitsandbytes 0.45.0
- **HF-format base model** at `E:/felon_workspace/cipher_hf/` (convert from GGUF if needed)
- **llama.cpp convert_lora_to_gguf.py** at `E:/llama-cpp/`
- **llama-server.exe** at `E:/llama-cpp/`
- **SFT corpus** at `E:/felon_workspace/cipher_v2/sft_train.jsonl` (exists)
- **Capability battery** at `E:/pip_temp/opencode/capability_audit_cipher_4b.mjs` (exists)
- **6+ GB free VRAM** (GTX 1060 6GB is at the spill threshold per model-scaling)

## Research base (verified 2026-09-03)

- `cipher-qlora-finetune` skill: the master fine-tune SOP, 5-step procedure, gate, threat matrix.
- `aid-venv-care` skill: the venv trap on this machine (`home = E:\Python310` is itself a Python install).
- `failure-pythonpath-hijack` skill: documents the same failure mode.
- `device-training-1060` skill: hard rule #1 = FP32 only on Pascal. QLoRA (4-bit) is the only viable in-card option.
- `model-scaling` skill: 5GB VRAM spill threshold, GQA divisibility.
- `training-sop` skill: AdamW(0.9, 0.95), wd 0.1, cosine, ONE epoch, replay 30%.
- `aide-cipher-house-model` skill: the in-house model lifecycle.
- Baseline: 0.683 composite, 11 PASS / 11 PARTIAL / 1 FAIL across 23 tasks (2026-08-28 audit).

## Pitfalls (each cost a cycle in prior sessions)

1. **Broken venv** — the `home = E:\Python310` trap. Use `--system-site-packages` or `E:\Python311`.
2. **Loading from GGUF directly** — peft needs HF safetensors. Convert first.
3. **OOM on 6GB** — QLoRA is the only option. If it OOMs, shrink batch to 1, enable gradient checkpointing.
4. **Overfitting the SFT pairs** — ONE epoch, replay buffer 30%, monitor per-category not just composite.
5. **Promoting without evaluation** — NEVER. The gate exists for a reason.
6. **Touching the manifest before the battery passes** — UI reads the manifest, premature promotion confuses users.
7. **Public-facing copy violation** — don't claim "v2 is better" in README until the battery gate passes.
8. **Forgetting the engine restart** — the new adapter doesn't load until llama-server restarts.

## What NOT to do

- **Do NOT run the training in a venv with `home = E:\Python310`** — it will crash with `init_fs_encoding` error.
- **Do NOT touch the manifest (`models/manifest.json`) until the battery gate passes** — UI shows the wrong adapter.
- **Do NOT promote v2 without running the full capability battery** — composite alone is not enough; per-category must not regress.
- **Do NOT skip the backup step** — `frontier-lora.v1.gguf` must exist before promotion.
- **Do NOT claim "SOTA" or "beats Cursor" in public copy** — this is a sovereign open-source project, not a commercial product.
- **Do NOT run the training with the AIDE engine serving** — GPU contention. AIDE off during training.

## Verification (the gate)

The fine-tune stage is complete when:
1. The venv is fixed and `python -c "import torch, transformers, peft, trl, bitsandbytes; print('OK')"` exits 0.
2. The SFT corpus has ≥ 1000 high-quality pairs (currently 4741).
3. The training script runs to completion without OOM.
4. The LoRA → GGUF conversion succeeds and the new adapter file is non-empty.
5. The capability battery runs and produces a composite score.
6. The gate is applied: PROMOTE / ARCHIVE / ROLLBACK.
7. The journal entry names the verdict, the delta, and the files changed.

## Verification record (per agent-notes)

After the fine-tune, append to `AGENT_NOTES.md`:
```
- [YYYY-MM-DD HH:MM] T1: cipher-4b v2 fine-tune complete (stage 9)
  - Venv: E:\felon_workspace\venv_cipher_v2\ (fixed, --system-site-packages)
  - Training: X epochs, Y steps, Z seconds on GTX 1060
  - Adapter: E:\aide-sovereign-workbench\models\aide-house\cipher_v2_lora.gguf (XX MB)
  - Battery: composite X.XXX (baseline 0.683, delta +/-X.XXX)
  - Verdict: PROMOTE | ARCHIVE | ROLLBACK
  - Files: [list]
  - Next: stage 10 - Tauri packaging
```
