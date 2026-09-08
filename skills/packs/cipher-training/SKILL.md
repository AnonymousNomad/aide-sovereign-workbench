---
name: cipher-training
description: Execute the FSI Felon Cipher training run on cloud GPUs. Use when launching, monitoring, or debugging the training process. Phase 4 of cipher-cloud-training.
---

# Phase 4: Training Execution

## Purpose
Run the BF16 MoE training on cloud GPU (A100/H100) for 5-7 hours. This is the main event.

## Training Config (H100 preset)
```yaml
# configs/h100.yaml
model:
  vocab: 32768
  d_model: 512
  n_layers: 12
  n_heads: 8
  n_kv_heads: 2
  head_dim: 64
  n_routed: 32
  n_shared: 2
  top_k: 4
  expert_d_ff: 128

training:
  seq_len: 2048
  batch_size: 4
  grad_accum: 12
  lr: 3e-4
  min_lr: 3e-5
  warmup_steps: 200
  max_steps: 10000
  weight_decay: 0.1
  grad_clip: 1.0
  precision: bf16
  checkpoint_every: 500
  eval_every: 500
  log_every: 10
```

## Main Training Loop
```python
import torch
import torch.nn as nn
from torch.cuda.amp import autocast
import yaml, json, time, signal, sys

def train(config_path):
    cfg = yaml.safe_load(open(config_path))

    # Load model
    from cipher_arch import CipherModel
    model = CipherModel(cfg["model"]).cuda()

    # Optimizer
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=cfg["training"]["lr"],
        weight_decay=cfg["training"]["weight_decay"],
        betas=(0.9, 0.95), eps=1e-5
    )

    # LR schedule: warmup + cosine decay
    def lr_lambda(step):
        if step < cfg["training"]["warmup_steps"]:
            return step / cfg["training"]["warmup_steps"]
        progress = (step - cfg["training"]["warmup_steps"]) / (cfg["training"]["max_steps"] - cfg["training"]["warmup_steps"])
        return cfg["training"]["min_lr"]/cfg["training"]["lr"] + 0.5*(1 - cfg["training"]["min_lr"]/cfg["training"]["lr"]) * (1 + torch.cos(torch.tensor(progress * 3.14159)).item())
    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

    # Load data
    from data import ShardDataset
    train_data = ShardDataset("data/shards_train")
    train_loader = torch.utils.data.DataLoader(train_data, batch_size=cfg["training"]["batch_size"], shuffle=True)

    # SIGTERM handler (spot instances)
    def handle_sigterm(signum, frame):
        print("SIGTERM received. Saving emergency checkpoint...")
        save_checkpoint(model, optimizer, scheduler, global_step, "emergency.pt")
        sys.exit(0)
    signal.signal(signal.SIGTERM, handle_sigterm)

    # Training
    model.train()
    global_step = 0
    scaler = torch.amp.GradScaler("cuda")

    while global_step < cfg["training"]["max_steps"]:
        for batch in train_loader:
            x = batch.cuda()

            with torch.amp.autocast("cuda", dtype=torch.bfloat16):
                loss = model(x, labels=x).loss
                loss = loss / cfg["training"]["grad_accum"]

            scaler.scale(loss).backward()

            if (global_step + 1) % cfg["training"]["grad_accum"] == 0:
                scaler.unscale_(optimizer)
                nn.utils.clip_grad_norm_(model.parameters(), cfg["training"]["grad_clip"])
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad()
                scheduler.step()

            global_step += 1

            if global_step % cfg["training"]["log_every"] == 0:
                lr = scheduler.get_last_lr()[0]
                print(f"step={global_step} loss={loss.item()*cfg['training']['grad_accum']:.4f} lr={lr:.2e}")

            if global_step % cfg["training"]["checkpoint_every"] == 0:
                save_checkpoint(model, optimizer, scheduler, global_step, f"step_{global_step}.pt")
                print(f"✓ Checkpoint saved at step {global_step}")

            if global_step >= cfg["training"]["max_steps"]:
                break

    # Final checkpoint
    save_checkpoint(model, optimizer, scheduler, global_step, "final.pt")
    print(f"✓ Training complete: {global_step} steps")
```

## MoE Losses (CRITICAL)
```python
def moe_loss(model, total_loss, aux_alpha=0.001, z_alpha=0.001, ortho_beta=0.01):
    """Add MoE-specific losses to the main LM loss."""
    losses = {"lm": total_loss}

    # Router z-loss (prevents logit explosion)
    z_loss = model.router_z_loss()
    losses["z_loss"] = z_alpha * z_loss

    # Load balance (use loss-free balancing bias instead if available)
    aux_loss = model.auxiliary_loss()
    losses["aux_loss"] = aux_alpha * aux_loss

    # Cross-population orthogonality (Sheldon vs Spock)
    ortho_loss = model.orthogonality_loss()
    losses["ortho_loss"] = ortho_beta * ortho_loss

    total = sum(losses.values())
    losses["total"] = total
    return total, losses
```

## Monitoring Metrics
```python
def log_metrics(model, step, loss_dict):
    """Log everything to W&B or file."""
    metrics = {
        "step": step,
        "loss/lm": loss_dict["lm"],
        "loss/total": loss_dict["total"],
        "loss/z": loss_dict.get("z_loss", 0),
        "loss/aux": loss_dict.get("aux_loss", 0),
        "loss/ortho": loss_dict.get("ortho_loss", 0),
        "lr": scheduler.get_last_lr()[0],
        "gpu_mem_gb": torch.cuda.max_memory_allocated()/1e9,
    }

    # Expert utilization (per layer)
    for i, layer in enumerate(model.layers):
        if hasattr(layer, 'router'):
            util = layer.router.expert_counts.float() / layer.router.expert_counts.sum()
            metrics[f"router/layer{i}_max_util"] = util.max().item()
            metrics[f"router/layer{i}_entropy"] = -(util * (util+1e-8).log()).sum().item()

    # Cross-population overlap
    if hasattr(model, 'sheldon_experts') and hasattr(model, 'spock_experts'):
        overlap = compute_overlap(model.sheldon_experts, model.spock_experts)
        metrics["router/cross_pop_overlap"] = overlap

    wandb.log(metrics, step=step)
```

## Verification Gate
```
PASS if:
  - Loss decreases from initial (first 100 steps)
  - No NaN/inf in loss at any point
  - GPU utilization > 70%
  - Expert utilization: max < 2× average per layer
  - Router entropy decreasing (router learning)
  - Cross-population overlap < 0.3
  - No gradient explosion (grad_norm < 10)
```

## What NOT To Do
1. DO NOT use FP32 — wastes 90% of tensor cores
2. DO NOT skip gradient clipping — MoE routing is unstable without it
3. DO NOT ignore z-loss — logit explosion kills training silently
4. DO NOT checkpoint only to local disk — use persistent volume
5. DO NOT train without monitoring — watch for NaN, collapse, overfitting
6. DO NOT change LR mid-training — use the schedule
7. DO NOT skip warmup — MoE routers need warmup more than dense models
8. DO NOT use high LR — 3e-4 is max for BF16 MoE, lower is safer

## Threat Matrix
| Threat | Symptom | Fix |
|--------|---------|-----|
| Expert collapse | 1 expert gets >50% tokens | Increase aux loss, check router init |
| NaN loss | Training dead | Reduce LR, increase z-loss, check data |
| Gradient explosion | Loss spikes | Clip gradients, reduce LR |
| GPU memory overflow | OOM crash | Reduce batch_size, add gradient checkpointing |
| Slow training | <50% GPU util | Increase batch_size, check data loading speed |
| Overfitting | Val loss rising, train loss falling | Add dropout, early stopping |
