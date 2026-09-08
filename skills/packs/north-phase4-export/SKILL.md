---
name: north-phase4-export
description: Phase 4 — Merge LoRA into base, convert to GGUF, quantize, deploy on :8084, run post-training battery. Compare BEFORE vs AFTER. LOCAL ONLY. Triggers on: GGUF export, model merge, deployment, post-training eval.
---

# Phase 4: GGUF Export & Deploy

## Purpose
Take the personality-trained LoRA adapter, merge it into the base model, export to GGUF, and serve it. Then measure BEFORE vs AFTER to prove improvement.

## Why This Phase Exists
LoRA adapters are for training. GGUF is for serving. We need the model in a format llama.cpp can run, and we need proof that training actually improved the personality.

## Prerequisites
- Phase 3 PASS (adapter trained and saved)
- llama.cpp at `E:\llama-cpp-b10636\`
- Phase 1 baseline scores recorded

## Step-by-Step SOP

### Step 1: Merge LoRA into Base Model
```python
# merge_adapter.py
from unsloth import FastLanguageModel
import torch

# Load base model (full precision for merge)
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen3-4B-bnb-4bit",
    max_seq_length=2048,
    dtype=torch.float16,
    load_in_4bit=False,  # Full precision for merge
)

# Load LoRA adapter
from peft import PeftModel
model = PeftModel.from_pretrained(model, "E:/models/house-model/lora-adapter")

# Merge
model = model.merge_and_unload()

# Save merged model
model.save_pretrained("E:/models/house-model/merged-model")
tokenizer.save_pretrained("E:/models/house-model/merged-model")

print("Merge complete. Model saved to: E:/models/house-model/merged-model")
```

```powershell
cd E:\models\house-model
E:\models\house-model\training-venv\Scripts\Activate.ps1
python merge_adapter.py
```

**Verify**:
```powershell
Get-Item E:\models\house-model\merged-model\config.json
# Expected: file exists
Get-ChildItem E:\models\house-model\merged-model\*.safetensors
# Expected: model weight files exist
```

### Step 2: Convert to GGUF
```powershell
cd E:\llama-cpp-b10636
python convert-hf-to-gguf.py E:\models\house-model\merged-model --outfile E:\models\house-model\personality-qwen3-4b-f16.gguf --outtype f16
```

**If convert-hf-to-gguf.py not found**: Check llama.cpp directory. May need to install requirements:
```powershell
pip install -r E:\llama-cpp-b10636\requirements.txt
```

**Verify**:
```powershell
Get-Item E:\models\house-model\personality-qwen3-4b-f16.gguf
# Expected: file exists, size ~8GB (FP16 of 4B model)
```

### Step 3: Quantize to Q4_K_M
```powershell
E:\llama-cpp-b10636\llama-quantize.exe E:\models\house-model\personality-qwen3-4b-f16.gguf E:\models\house-model\personality-qwen3-4b-Q4_K_M.gguf Q4_K_M
```

**Why Q4_K_M**: Best quality-size ratio. ~2.5GB. Fits in 6GB VRAM with room for KV cache.

**Verify**:
```powershell
Get-Item E:\models\house-model\personality-qwen3-4b-Q4_K_M.gguf
# Expected: file exists, size ~2.5GB
```

### Step 4: Deploy on :8084
```powershell
# Kill old server
Get-Process -Name llama-server -ErrorAction SilentlyContinue | Stop-Process -Force

# Launch new server with personality model
Start-Process -FilePath "E:\llama-cpp-b10636\llama-server.exe" -ArgumentList @(
    "-m", "E:\models\house-model\personality-qwen3-4b-Q4_K_M.gguf",
    "--host", "0.0.0.0",
    "--port", "8084",
    "-ngl", "99",
    "-c", "4096",
    "-fa"
) -PassThru

# Wait for ready
Start-Sleep -Seconds 10
Invoke-RestMethod -Uri "http://localhost:8084/health" -TimeoutSec 30
```

### Step 5: Run Post-Training Battery
Run the SAME 7 tests from Phase 1. Score each 0-10.

```powershell
# Same test prompts as Phase 1
# Record scores to: E:\models\house-model\post-training-scores.json
```

### Step 6: Compare BEFORE vs AFTER
```python
# compare_scores.py
import json

with open("E:/models/house-model/baseline-scores.json") as f:
    before = json.load(f)
with open("E:/models/house-model/post-training-scores.json") as f:
    after = json.load(f)

print("=== PERSONALITY TRAINING RESULTS ===")
print(f"{'Category':<20} {'Before':>8} {'After':>8} {'Change':>8}")
print("-" * 50)

total_before = 0
total_after = 0
for cat in before["scores"]:
    b = before["scores"][cat]
    a = after["scores"][cat]
    change = a - b
    total_before += b
    total_after += a
    arrow = "+" if change > 0 else "" if change == 0 else ""
    print(f"{cat:<20} {b:>8} {a:>8} {arrow}{change:>7}")

print("-" * 50)
print(f"{'TOTAL':<20} {total_before:>8} {total_after:>8} {'+' if total_after > total_before else ''}{total_after - total_before:>7}")
print(f"{'MAX':<20} {'70':>8}")
print(f"{'IMPROVEMENT':<20} {'':>8} {'':>8} {total_after - total_before:>7} pts")

if total_after > total_before:
    print("\nPERSONALITY TRAINING SUCCESSFUL")
elif total_after == total_before:
    print("\nNO CHANGE — corpus may need more diversity")
else:
    print("\nREGRESSION — investigate immediately")
```

## Battery (Verification Gate)

- [ ] Merged model exists (config.json + weight files)
- [ ] GGUF file created (>1GB)
- [ ] Quantized GGUF created (~2.5GB)
- [ ] Server starts with new model on :8084
- [ ] All 7 post-training tests return non-empty responses
- [ ] Post-training scores recorded
- [ ] Comparison shows improvement (or at minimum, no regression)

## Known Issues & Fixes

### Merge fails
- OOM during merge: try with `load_in_4bit=True` in merge script (slower but uses less RAM)
- Wrong base model: ensure `unsloth/Qwen3-4b-bnb-4bit` matches what was used in training

### GGUF conversion fails
- Missing dependencies: `pip install gguf`
- Model format not recognized: ensure merged model has proper config.json

### Quantization quality loss
- Expected minor quality loss from Q4_K_M
- If too severe, try Q5_K_M or Q6_K_M (larger files but better quality)

### Personality lost after export
- Merge didn't include adapter weights: re-run merge with debug output
- Quantization too aggressive: try higher quantization level
- Chat template mismatch: ensure GGUF has correct chat template

## Exit Criteria
- Post-training scores > baseline scores (or at minimum, no regression)
- Model serving on :8084
- Ready for Phase 5 (workflow enforcement)
