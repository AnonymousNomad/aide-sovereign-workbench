---
name: cipher-cloud-setup
description: Set up cloud GPU training environment for FSI Felon Cipher. Use when packaging the project, building Docker, and deploying to cloud GPUs. Phase 3 of cipher-cloud-training.
---

# Phase 3: Cloud Environment Setup

## Purpose
Package cipher training into a reproducible Docker container and deploy to cloud GPUs.

## GPU Access Paths (ranked by practicality for solo dev)

| Path | GPU | Cost/hr | Setup complexity |
|------|-----|---------|-----------------|
| **RunPod** | A100 80GB / H100 80GB | $1.19-$2.89 | Low (web UI + Docker) |
| **Vast.ai** | A100 80GB / H100 | $0.39-$1.60 | Low (marketplace) |
| **Google Colab Pro** | A100 40GB | $0.10/min | Lowest (notebook) |
| **Lambda Labs** | A100 80GB | $1.29-$2.79 | Medium |
| **NVIDIA DGX Cloud** | 8× H100 | $37K/mo | High (Inception required) |

## Project Structure
```
cipher-cloud/
├── Dockerfile
├── requirements.txt
├── train.py
├── configs/
│   ├── h100.yaml
│   └── a100.yaml
├── src/
│   ├── cipher_arch.py
│   ├── data.py
│   ├── losses.py
│   └── utils.py
└── data/        (tokenized shards uploaded here)
```

## Dockerfile
```dockerfile
FROM pytorch/pytorch:2.4.0-cuda12.4-cudnn9-runtime
RUN apt-get update && apt-get install -y git wget && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
WORKDIR /workspace
COPY . .
RUN python -c "import torch; assert torch.cuda.is_available()"
ENTRYPOINT ["torchrun", "--nproc_per_node=1"]
CMD ["train.py", "--config", "configs/h100.yaml"]
```

## requirements.txt
```
torch>=2.4.0
tokenizers>=0.19.0
numpy>=1.24.0
tqdm>=4.66.0
pyyaml>=6.0
wandb>=0.16.0
```

## Build & Test Locally
```bash
docker build -t cipher-train:latest -f Dockerfile .
docker run --gpus all cipher-train:latest python -c "import torch; print(torch.cuda.get_device_name(0))"
docker run --gpus all cipher-train:latest torchrun --nproc_per_node=1 train.py --config configs/smoke_test.yaml
```

## Upload to RunPod
```bash
docker tag cipher-train:latest runpod/cipher-train:latest
docker push runpod/cipher-train:latest
rsync -avz E:\cipher_training_data\ user@runpod:/workspace/data/
```

## Verify Cloud Environment
```python
import torch
print(f"CUDA: {torch.cuda.is_available()}")
print(f"GPU: {torch.cuda.get_device_name(0)}")
print(f"VRAM: {torch.cuda.get_device_properties(0).total_mem/1e9:.1f} GB")
print(f"BF16: {torch.cuda.is_bf16_supported()}")
```

## Verification Gate
```
PASS: Docker builds, GPU accessible, BF16 supported, data loadable, smoke test passes
```

## What NOT To Do
1. DO NOT hardcode paths — use relative paths
2. DO NOT use latest PyTorch — pin to 2.4.x
3. DO NOT upload raw text — upload tokenized shards
4. DO NOT forget SIGTERM handler for spot instances
5. DO NOT store checkpoints on ephemeral disk

## Threat Matrix
| Threat | Mitigation |
|--------|------------|
| GPU not assigned | Verify nvidia-smi at startup |
| CUDA mismatch | Match Docker CUDA to host driver |
| Instance killed (spot) | Checkpoint to persistent volume |
| Disk full | Monitor disk, limit checkpoint count |
