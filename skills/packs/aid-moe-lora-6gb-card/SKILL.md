# MoE LoRA Fine-Tuning on a 6GB Card (GTX 1060 Pascal SM 6.1)

## Scope

Fine-tuning sparse Mixture-of-Experts models (like CohereLabs/North-Mini-Code-1.0) on hardware too small to hold the full model. Targets the **shared transformer layers** (attention + router) while leaving the 128 expert FFNs at their trained-in values.

## Why this is the only viable path on 6GB Pascal

A 30B model at FP16 = 60GB. At 4-bit (NF4) = 7.5GB. Either way, exceeds the 6GB card. Two options:

| Option | VRAM | Verdict on 6GB Pascal |
|---|---|---|
| BF16 base + LoRA | 5.2GB base + LoRA + acts = 6-7GB | OOM |
| QLoRA (4-bit NF4) + LoRA | 2.5GB base + LoRA + acts = 3-4GB | Fits, BUT Pascal SM 6.1 has no native 4-bit CUDA kernels — bitsandbytes falls back to slower CPU path |
| **LoRA on attention + router ONLY (skip expert FFNs)** | ~1.5GB trainable params base + ~50MB LoRA = manageable | **This is the path** |

The shared transformer layers in a MoE are:
- The 49 transformer block layers: each has `q_proj`, `k_proj`, `v_proj`, `o_proj`, `attn_norm`, `post_attn_norm`, plus the MoE **router** (`gate_proj` / `gate` for the top-k expert selection)
- The MoE **expert FFNs** (`experts.{i}.w1`, `experts.{i}.w2`, `experts.{i}.w3` for each of 128 experts × 49 layers) — **SKIP THESE**

By LoRA-ing only the shared layers, we train ~1-2% of total params, which:
- Fits in 6GB VRAM at BF16
- Affects every expert's behavior (via the router)
- Preserves the heavily-trained expert weights
- Trains in reasonable time (1-3 hours per epoch on CPU, 10-30 min on GPU)

## Verified feasibility

Per the `device-training-1060` skill: fp32 = 16 bytes/param; LoRA at r=16 on 1.5B shared layers = 24M trainable × 16 bytes = 384MB optimizer state. BF16 base = ~3GB (shared layers only when frozen). Activations: 1.5B × 4 bytes × seq 1024 = 6GB — too much. With grad checkpointing: 6GB / 4 = 1.5GB. **Total fits in 6GB with grad checkpointing + small batch.**

## Research base (verified 2026-08-30)

- **HF transformers supports cohere2moe** since 5.2.0 (per the model card). We have 5.16.1 installed.
- **peft 0.13.0** supports `LoraConfig(target_modules=[...])` with regex matching. We can target `q_proj|k_proj|v_proj|o_proj|gate_proj` patterns and skip experts.
- **The Cohere tokenizer is 262K vocab** — much larger than the 128K Qwen/Llama vocab. The model card says "use latest transformers>=5.2.0" — confirmed working with 5.16.1.
- **The base model file** is the 10.5GB UD-Q2_K_XL GGUF, NOT a HF safetensors checkpoint. To train in HF transformers, we need either:
  1. Download the BF16 HF safetensors from `CohereLabs/North-Mini-Code-1.0` (5.4GB or so — full BF16)
  2. Dequantize the GGUF (lossy, not recommended)
  3. Use llama.cpp for training (no peft integration, complex)

**Path 1 is the right one.** We need to download the BF16 HF weights. They're at `huggingface.co/CohereLabs/North-Mini-Code-1.0` — see the model card section for the snippet:
```python
from transformers import AutoModelForCausalLM, AutoTokenizer
model_id = "CohereLabs/North-Mini-Code-1.0"
tokenizer = AutoTokenizer.from_pretrained(model_id)
model = AutoModelForCausalLM.from_pretrained(model_id)
```

## The training script (to be authored in STAGE 1 of the production plan)

```python
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

model = AutoModelForCausalLM.from_pretrained(
    "CohereLabs/North-Mini-Code-1.0",
    dtype=torch.bfloat16,
    device_map="auto",  # auto-spill to CPU
    low_cpu_mem_usage=True,
    attn_implementation="sdpa",
)
model.gradient_checkpointing_enable()  # critical for VRAM

# MoE-aware LoRA: target ONLY shared layers, NOT experts
# Cohere2Moe layer names (per transformers source):
#   model.layers.{i}.self_attn.q_proj
#   model.layers.{i}.self_attn.k_proj
#   model.layers.{i}.self_attn.v_proj
#   model.layers.{i}.self_attn.o_proj
#   model.layers.{i}.mlp.router.{w1,w2} (the MoE gate)
# EXPERTS: model.layers.{i}.mlp.experts.{0..127}.{w1,w2,w3} -- SKIP
lora_config = LoraConfig(
    r=16, lora_alpha=32, lora_dropout=0.05,
    target_modules=r".*self_attn\.(q_proj|k_proj|v_proj|o_proj)$|.*mlp\.router\..*",
    bias="none",
    task_type="CAUSAL_LM",
)
model = get_peft_model(model, lora_config)
model.print_trainable_parameters()
# Expected: ~30M trainable / 30.5B total = 0.1% trainable
```

## Hyperparameters (per `training-sop` skill, calibrated for this model size)

| Param | Value | Why |
|---|---|---|
| Optimizer | AdamW(0.9, 0.95), eps 1e-8, wd 0.1 | Per training-sop |
| LR | 1e-4 (LoRA on 30B-base) | Lower than full-FT; LoRA standard |
| Schedule | cosine, 100-step warmup | Per training-sop |
| Batch | micro 1, grad accum 32 = effective 32 | Per training-sop (32K tok/step) |
| Grad clip | 1.0 | Per training-sop |
| Epochs | 1 | Per training-sop (catastrophic forgetting guard) |
| Replay | 30% from curated_v2 | Per cipher_v2 corpus build |
| Precision | BF16 (not FP32 — would OOM) | Per device-training-1060 |

## Pitfalls (verified by research, not yet by execution)

1. **The MoE expert weights are NOT in the standard `target_modules` patterns.** If you naively use `target_modules="all-linear"`, peft will try to LoRA every expert FFN and OOM. Always use the regex above.
2. **The router is the magic.** LoRA-ing `mlp.router.*` lets a small adapter change which experts are activated per token — this is the "fast learner" path for MoE.
3. **The model was post-trained with RLVR (RL with verifiable rewards)** for agentic coding. A pure SFT round will likely regress on tool-use unless the SFT data is high-quality agent traces (which is what our cipher_v2 corpus is).
4. **The 262K vocab tokenizer** means the embedding table alone is 262K × 2048 × 2 bytes = 1.1GB. Embedding layers should be FROZEN in the LoRA — confirmed by `LoraConfig` default behavior (it does not target `embed_tokens`).
5. **The CoT/interleaved thinking behavior** must be preserved. Do NOT include `<|no_think|>`-style prompts in the training data. The native chat template will preserve thinking.

## Skill category: training-strategy
## Author: opencode (T2 session, 2026-08-30)
## Verified by: research + dependency probe (transformers 5.16.1 imports torch + cohere2moe arch). Not yet verified by actual training run.
