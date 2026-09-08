---
name: north-phase0-environment
description: Phase 0 — Local environment setup for personality fine-tuning. Creates venv, installs Unsloth + deps, verifies GPU, checks disk/RAM. Run BEFORE anything else. Triggers on: environment setup, venv creation, GPU verification, first-time setup.
---

# Phase 0: Hard Rules & Environment Setup

## Purpose
Establish a verified local Python environment for QLoRA fine-tuning on GTX 1060 6GB. No cloud dependencies. No external services.

## Why This Phase Exists
Every later phase depends on a working training environment. If this phase is not verified, nothing downstream works. Do not skip. Do not assume.

## Prerequisites
- Windows with NVIDIA drivers installed
- Python 3.10+ (`py` launcher available)
- ~10GB free disk space (model + training output + venv)
- 8GB+ free RAM

## Step-by-Step SOP

### Step 1: Check Hardware Truth
```powershell
# Verify GPU
nvidia-smi
# Expected: GTX 1060 6GB listed, driver version, CUDA version

# Verify free RAM
systeminfo | findstr "Available Physical Memory"
# Expected: 8GB+ free

# Verify free disk
Get-PSDrive E | Select-Object Free
# Expected: 10GB+ free
```

**If GPU not detected**: STOP. Install/update NVIDIA drivers from nvidia.com. Do not proceed until nvidia-smi works.

**If RAM < 8GB**: Kill background processes. Use process-hygiene-sop skill. Recheck.

### Step 2: Create Training Venv
```powershell
py -3.10 -E -m venv E:\models\house-model\training-venv
E:\models\house-model\training-venv\Scripts\Activate.ps1
python --version
# Expected: Python 3.10.x
```

**Why Python 3.10**: Unsloth has best compatibility with 3.10. 3.11+ has known issues with some CUDA extensions.

### Step 3: Install PyTorch (CUDA 11.8)
```powershell
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```

**Why CUDA 11.8**: GTX 1060 Pascal supports up to CUDA 11.8. CUDA 12+ may not work properly.

**Verify**:
```powershell
python -c "import torch; print(f'CUDA: {torch.cuda.is_available()}, Device: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}')"
# Expected: CUDA: True, Device: GeForce GTX 1060
```

**If CUDA: False**: STOP. The PyTorch CUDA build doesn't match your driver. Check `nvidia-smi` for supported CUDA version. Install matching PyTorch cuXXX variant.

### Step 4: Install Unsloth
```powershell
pip install --upgrade --force-reinstall --no-cache-dir unsloth
pip install --upgrade --force-reinstall --no-cache-dir unsloth_zoo
```

**Verify**:
```powershell
python -c "from unsloth import FastLanguageModel; print('Unsloth OK')"
# Expected: Unsloth OK
```

**If import fails**: STOP. Read the error. Common issues:
- `triton` not found on Windows → `pip install triton` (may need specific version)
- CUDA version mismatch → recheck Step 3
- Look at Unsloth Windows troubleshooting: https://github.com/unslothai/unsloth/wiki

### Step 5: Install Training Dependencies
```powershell
pip install transformers datasets trl accelerate bitsandbytes
pip install huggingface_hub  # For model download
```

**Verify**:
```powershell
python -c "from transformers import AutoModelForCausalLM; from trl import SFTTrainer; print('Training deps OK')"
# Expected: Training deps OK
```

### Step 6: Verify HF Token (for model download)
```powershell
python -c "from huggingface_hub import HfApi; api = HfApi(); print('HF token valid' if api.token else 'NO TOKEN')"
# Expected: HF token valid
```

**If no token**: `huggingface-cli login` — paste token from `~/.cache/huggingface/token`

### Step 7: RAM Stress Test
```powershell
python -c "
import torch
# Simulate loading a 4B model in 4-bit
# This tests if we have enough RAM
import os
print(f'Available RAM check...')
# Just verify we can allocate a large tensor
t = torch.zeros(100000000, dtype=torch.float32)  # ~400MB
del t
print('RAM allocation test passed')
"
```

**If OOM here**: Close all other applications. Kill browser tabs. Free up RAM.

## Battery (Verification Gate)

Run ALL of these. Record results. If ANY fails, STOP and fix before proceeding.

```powershell
python -c "
import torch
import sys

results = {}

# Test 1: Python version
results['python'] = sys.version_info >= (3, 10)

# Test 2: CUDA available
results['cuda'] = torch.cuda.is_available()

# Test 3: GPU name correct
results['gpu'] = 'GTX 1060' in torch.cuda.get_device_name(0) if torch.cuda.is_available() else False

# Test 4: VRAM reported
results['vram'] = torch.cuda.get_device_properties(0).total_memory / (1024**3) >= 5.5 if torch.cuda.is_available() else False

# Test 5: Unsloth import
try:
    from unsloth import FastLanguageModel
    results['unsloth'] = True
except:
    results['unsloth'] = False

# Test 6: Training deps
try:
    from transformers import AutoModelForCausalLM
    from trl import SFTTrainer
    results['training_deps'] = True
except:
    results['training_deps'] = False

# Report
print('=== PHASE 0 BATTERY ===')
for k, v in results.items():
    status = 'PASS' if v else 'FAIL'
    print(f'  {k}: {status}')

all_pass = all(results.values())
print(f'OVERALL: {\"PASS\" if all_pass else \"FAIL\"} ({sum(results.values())}/{len(results)})')

if not all_pass:
    print('STOP: Fix failing tests before proceeding to Phase 1.')
    sys.exit(1)
else:
    print('Environment verified. Ready for Phase 1.')
"
```

## Known Issues & Fixes

### Unsloth on Windows
- Unsloth Windows support is experimental. If it fails, try `pip install unsloth[cuda]` or check the Unsloth wiki for Windows-specific builds.
- Alternative: Use `pip install peft transformers trl` directly without Unsloth (slower but more compatible).

### CUDA 11.8 vs 12.x
- GTX 1060 (Pascal) officially supports CUDA 11.8
- CUDA 12.x may work with some driver versions but is not guaranteed
- If CUDA 12 is required by Unsloth, try `pip install nvidia-cuda-runtime-cu118` as a workaround

### bitsandbytes on Windows
- bitsandbytes has limited Windows support
- If it fails, the training will use standard LoRA (no 4-bit quantization) which needs more VRAM
- Fallback: train without bitsandbytes, accept higher VRAM usage

## Exit Criteria
- All 6 battery tests PASS
- Python 3.10 venv created and activated
- GPU detected and usable by PyTorch
- Unsloth imports successfully
- Training dependencies installed
- HF token verified
