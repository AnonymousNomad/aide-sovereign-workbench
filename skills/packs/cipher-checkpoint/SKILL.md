---
name: cipher-checkpoint
description: Save, verify, and download FSI Felon Cipher training checkpoints. Use when checkpointing during training, verifying checkpoint integrity, or downloading results from cloud. Phase 5 of cipher-cloud-training.
---

# Phase 5: Checkpoint Recovery & Download

## Purpose
Ensure training checkpoints are saved atomically, verified for integrity, and downloaded safely to local machine.

## Checkpoint Save (Atomic + Verified)
```python
import torch, os, hashlib, time

def save_checkpoint(model, optimizer, scheduler, step, path, config):
    state = {
        "step": step,
        "model": model.state_dict(),
        "optimizer": optimizer.state_dict(),
        "scheduler": scheduler.state_dict(),
        "config": config,
        "rng": {
            "torch": torch.get_rng_state(),
            "cuda": torch.cuda.get_rng_state_all(),
        },
        "timestamp": time.time(),
    }
    tmp = path + ".tmp"
    torch.save(state, tmp)
    os.replace(tmp, path)  # atomic
    size_mb = os.path.getsize(path) / 1e6
    print(f"✓ Checkpoint: {path} ({size_mb:.1f} MB)")
```

## Resume from Checkpoint
```python
def load_checkpoint(path, model, optimizer=None, scheduler=None):
    ck = torch.load(path, map_location="cuda", weights_only=False)
    model.load_state_dict(ck["model"])
    if optimizer: optimizer.load_state_dict(ck["optimizer"])
    if scheduler: scheduler.load_state_dict(ck["scheduler"])
    print(f"✓ Resumed step {ck['step']}")
    return ck["step"]
```

## SIGTERM Handler (Spot Instances)
```python
import signal, sys

def handle_sigterm(signum, frame):
    save_checkpoint(model, optimizer, scheduler, global_step, "emergency.pt", config)
    sys.exit(0)

signal.signal(signal.SIGTERM, handle_sigterm)
```

## Cloud Download Methods
```bash
# RunPod
rsync -avzP user@runpod:/workspace/checkpoints/ ./checkpoints/

# Vast.ai
scp user@vast:/workspace/checkpoints/*.pt ./checkpoints/

# Generic (resumable)
rsync -avzP --partial user@cloud:/workspace/checkpoints/ ./checkpoints/
```

## Verify After Download
```python
def verify_checkpoint(path):
    ck = torch.load(path, map_location="cpu", weights_only=False)
    assert all(k in ck for k in ["step","model","optimizer","scheduler","config"])
    from cipher_arch import CipherModel
    model = CipherModel(ck["config"])
    model.load_state_dict(ck["model"])
    # Check for NaN
    for name, p in model.named_parameters():
        assert not torch.isnan(p).any(), f"NaN in {name}"
    print(f"✓ Verified: step={ck['step']}")
```

## What NOT To Do
1. DO NOT save only model weights — lose optimizer = unstable resume
2. DO NOT write to same path without atomic rename
3. DO NOT download only "best" — download ALL checkpoints
4. DO NOT skip checksum verification
5. DO NOT forget SIGTERM handler

## Bugs
| Bug | Fix |
|-----|-----|
| Corruption on crash | Atomic write (.tmp → os.replace) |
| OOM loading large ck | Load to CPU first, then .cuda() |
| Config mismatch | Verify ck["config"] matches current |
| Wrong device | Use map_location="cpu" for cross-device |
