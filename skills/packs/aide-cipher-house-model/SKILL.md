---
name: aide-cipher-house-model
description: Project Cipher — AIDE's self-improving in-house model system. Complete lifecycle: base model selection → fine-tune → GGUF conversion → serve via llama.cpp → capture trajectories → sleep-time retrain → battery gate → promote. Research-grounded on CLaaS (continual online LoRA), MERA (execution-trace adaptation), SIA (harness+weight co-evolution), SLIFT (selective feedback learning), and the GGUF conversion pipeline. Use when implementing ANY part of the house model lifecycle.
---

# Project Cipher — AIDE's Self-Improving House Model

## The Vision

One capable coding model that IS AIDE's brain. It starts as someone else's
open-weight model, gets fine-tuned on AIDE-specific tasks, then continuously
improves by learning from every interaction inside AIDE. After months of use,
it's a fundamentally different, better model — specialized for THIS operator's
workflow. Like White Rabbit Neo became DPAT.

## Why GGUF Is Both the Constraint AND the Solution

GGUF files ARE static — frozen quantized weights. You're right about that.
But the system around them is fluid:

1. **Base model** = static foundation (swappable between major versions)
2. **LoRA adapter** = your accumulated learning (regenerated each cycle)
3. **Context** = session memory ([learned] blocks, workspace facts)
4. **Gates** = quality control (nothing bad enters the adapter)

The adapter is the fluid part. Each training cycle produces a NEW adapter
file that encodes everything learned since the last cycle. The base stays
put; the adapter evolves.

## The Complete Lifecycle

```
OPERATOR uses AIDE all day
    ↓
Every interaction logged to .aide/trajectories/*.traj.json
Every outcome scored by gates (pass/fail/penalty)
Every approval/rejection recorded
    ↓
IDLE DETECTED (no interaction for 2+ hours, or operator triggers)
    ↓
SLEEP-TIME TRAINING PIPELINE:
    1. Load trajectories from today
    2. Filter: only VERIFIED outcomes (gate passed + operator approved)
    3. Build dataset: {prompt, verified_response} pairs
       + replay buffer (30% general instruction data against forgetting)
    4. QLoRA fine-tune: rank-32, alpha-64, lr=5e-4, 2-3 epochs
       on top of EXISTING adapter (progressive, not from scratch)
    5. Evaluate: run harness battery against updated adapter
    6. GATE: delta >= 0 required; else archive candidate
    7. Convert: merge adapter into GGUF format via convert_lora_to_gguf.py
    8. STAGE: new adapter alongside current version
    ↓
NEXT MORNING:
    Operator sees changelog: "Overnight I learned X patterns from N
    interactions. Battery delta: +Y points. [APPLY] [REVIEW] [SKIP]"
    ↓
APPROVE: hot-swap via /lora-adapters endpoint (<20ms, no restart)
SKIP: keep current version, try again tomorrow with more data
```

## Base Model Selection Criteria

For laptop-class hardware (6GB VRAM GTX 1060):
- Must fit at Q4_K_M in <5GB VRAM (leave room for KV cache + adapter)
- Must be code-specialized or have strong agentic coding scores
- Must be Apache-2.0 or MIT licensed (clean fine-tuning rights)
- Must have GGUF ecosystem support
- Must be LoRA-trainable (PEFT compatible)

Current best candidates (verified Aug 2026):

| Model | Size @ Q4_K_M | License | Coding Score | Notes |
|---|---|---|---|---|
| Qwen2.5-Coder-7B | 4.8GB | Apache 2.0 | Purpose-built coder | Best quality per GB |
| Qwen3-8B | 5.0GB | Apache 2.0 | General + thinking toggle | Newer gen |
| DeepSeek-R1-Distill-7B | 4.4GB | MIT | Reasoning specialist | Always-on CoT traces |

**Decision**: Start with **mini-coder-4b** (operator's own fine-tune,
already verified). Upgrade path: evaluate Qwen2.5-Coder-7B once Loop C
captures enough trajectory data to justify the switch.

## Training Pipeline (technical spec)

### Environment
- Python 3.10+ with transformers, peft, trl, accelerate
- Training happens OUTSIDE llama.cpp using HF transformers
- Output: merged model directory → GGUF via convert_hf_to_gguf.py

### Data Format
```jsonl
{"messages": [{"role": "system", "content": "<scaffold>"}, {"role": "user", "content": "<task>"}, {"role": "assistant", "content": "<verified_output>"}]}
```
Only include outcomes where ALL gates passed AND operator approved.
Replay buffer: 30% general instruction data mixed in to prevent forgetting.

### Training Config
- Method: QLoRA (4-bit base, LoRA adapters trainable)
- Rank: 32, Alpha: 64 (Medina-validated configuration)
- Learning rate: 5e-4, warmup 5 steps
- Epochs: 2-3 (more risks overfitting on small datasets)
- Batch size: as large as VRAM allows (likely 1-2 on 6GB card)

### Conversion Pipeline (adapter → servable GGUF)

Two approaches depending on whether you want a standalone model or an adapter:

**A. Merge into base (produces standalone GGUF):**
```bash
# Step 1: Merge LoRA into base weights
python -c "
from peft import PeftModel
from transformers import AutoModelForCausalLM
base = AutoModelForCausalLM.from_pretrained('<base_path>', torch_dtype=torch.float16, device_map='cpu')
model = PeftModel.from_pretrained(base, '<adapter_path>')
model = model.merge_and_unload()
model.save_pretrained('./merged-model')
"

# Step 2: Convert merged model to GGUF
python convert_hf_to_gguf.py ./merged-model --outfile ./cipher-f16.gguf --outtype f16

# Step 3: Quantize
./llama-quantize ./cipher-f16.gguf ./cipher-q8_0.gguf Q8_0
```

**B. Adapter GGUF (for --lora flag hot-loading):**
```bash
python convert_lora_to_gguf.py \
  --base /path/to/base/model/dir \
  ./adapter-output-dir \
  --outfile cipher-lora.gguf
```
Then serve: `llama-server -m base.gguf --lora cipher-lora.gguf ...`

**AIDE uses approach B** (--lora flag) so the base stays static and only
the lightweight adapter file changes between versions. Storage: ~126MB per
adapter version vs ~4GB per merged model.

## Serving Integration (llama-server)

The model-manager already supports --lora via manifest `lora_adapter` field:

```json
{
  "id": "aide-cipher-4b",
  "lora_adapter": "models/aide-house/frontier-lora.gguf",
  ...
}
```

model-manager.mjs start() appends `--lora <resolved-path>` when this field is present.

Future: /lora-adapters endpoint enables runtime swapping without restart.
Multiple adapters can coexist (aLoRA invocation-token triggering for
phase-specific personas).

## Threats

| Threat | Control |
|---|---|
| Catastrophic forgetting | Replay buffer mixes general data; battery non-regression gate |
| Regression promoted accidentally | Battery delta >= 0 required before swap; versions immutable |
| Training starves inference RAM | Train during idle hours only (P7 one-job law) |
| Garbage-in flywheel | Only VERIFIED outcomes enter datasets (gates upstream filter) |
| Overfitting to single user | Cap adapter rank at 32; periodic base-only evaluation |
| Adapter/base mismatch | intermediate_size compatibility check before load |
| Operator loses control | Every update requires explicit approval; full changelog shown |

## Honest Limits

- Gains are incremental per cycle, not step-changes
- Quality depends on capture volume — sparse use means slow improvement
- Small models have capability ceilings that LoRA cannot break
- First visible improvements after ~50 interactions, not immediate
- Training ON the same machine that serves creates VRAM contention
