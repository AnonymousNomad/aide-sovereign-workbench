---
name: aide-fine-tune-lane-wire-in
description: Wire the AIDE fine-tune lane end-to-end so the closed-loop's verifier-stamped failure signals become a trained, gated, served LoRA adapter. Covers the verified machine reality (GTX 1060 6GB Pascal FP32-only, no CUDA torch on the box, broken venv trap, no convert_lora_to_gguf.py on disk, GGUF-only base), the signal->pairs->train->adapter->gate chain, the exact venv rebuild, the QLoRA-on-e-4b recipe with Pascal-correct compute dtype, the battery gate (composite >= +0.02, no category regress > 0.1), and the promote/archive/rollback decision rules. Corrects the two STALE claims from older skills: the base is Qwen3 4B "Mini Coder 4b" at base.q8_0.gguf (NOT Qwen2.5-Coder-4B), and convert_lora_to_gguf.py exists ONLY in the llama.cpp source repo, not on disk. Use whenever training the v2 adapter, unblocking the venv, converting LoRA->GGUF, evaluating the battery, or promoting/archiving the frontier adapter.
---

# AIDE Fine-Tune Lane — Verified Wire-In SOP

## Status: RESEARCHED, BLOCKED ON INFRASTRUCTURE (2026-09-08)

The closed loop now captures signals; the fine-tune lane that CONSUMES them is the missing half.
- Signal contract EXISTS and WORKS: `scripts/selfimprove.mjs` emits verifier-stamped rows to `.aide/training/signal-YYYY-MM-DD.jsonl` (`{ts, category, source, verifier, verifier_result:'fail', prompt, stage_hint}`, no passing_completion).
- SFT corpus EXISTS: `E:\felon_workspace\cipher_v2\sft_train.jsonl` (4741 rows).
- Capability battery EXISTS: `E:\pip_temp\opencode\capability_audit_cipher_4b.mjs` (23 tasks, baseline composite **0.683**, PASS=11/PARTIAL=11/FAIL=1).
- Hard blocker: **NO CUDA torch anywhere on this box** (all venvs are cpu-only or broken).
- Hard blocker: **NO HF-format base on disk** (PEFT needs safetensors; `base.q8_0.gguf` is GGUF-only).
- Hard blocker: **convert_lora_to_gguf.py absent on disk** (claimed by two skills, FALSE on this machine — must fetch from llama.cpp source).

## Verified machine reality (2026-09-08, evidence-first)

| Item | Value | Evidence |
|---|---|---|
| GPU | NVIDIA GTX 1060, 6144 MiB, **5439 MiB free**, driver 582.28 | nvidia-smi |
| GPU arch | Pascal CC 6.1, **FP32 native only** (QoL: 4-bit NF4 qLoRA works; bf16 compute does NOT — see below) | HF bitsandbytes docs: NF4/FP4 min = Pascal+; 8-bit optimizers = Pascal+ |
| Base model identity | **`base.q8_0.gguf` = architecture `qwen3`, name "Mini Coder 4b", base `Qwen3 4B Instruct 2507`** | GGUF header metadata read from file bytes |
| Production adapter | `models/aide-house/frontier-lora.gguf` (126 MB, v1, operator-trained) | on disk |
| SFT corpus | `E:\felon_workspace\cipher_v2\sft_train.jsonl`, 4741 rows | on disk |
| Battery | `E:\pip_temp\opencode\capability_audit_cipher_4b.mjs` — 23 tasks/8 cats, 0.683 | on disk + evidence doc |
| Pythons | `E:\Python310\python.exe` (installs exist), `E:\Python311\python.exe` (**3.11.9, HAS pip** — PRIME choice) | verified |
| Broken venvs | `venv_cipher_v2` = the `home=E:\Python310` trap, NO pip; `venv` = torch 2.9.0+cpu only; `training-venv` = torch 2.11.0+cpu + broken numpy | all verified |
| llama.cpp | `E:\llama-cpp\` = **binaries ONLY** (llama-server.exe, llama-quantize.exe, etc.) — NO *.py scripts | directory listing |
| Disk | E: 151.7 GB free (GOOD), C: 2.7 GB free (CRITICAL — never install to C:) | Get-PSDrive |
| Manifest fact | `aide-cipher-v1` (the 4B) is currently DEPRECATED; house = north-mini-code-1.0 (30B MoE Q2). The 30B **cannot QLoRA on 6GB** (~15GB just base) — the trainable lane IS the 4B. | models/manifest.json |

## The two STALE claims that cost cycles (FIXED here)

1. **Base identity**: `cipher-qlora-finetune` + `aid-cipher-4b-fine-tune-pipeline` call the base "Qwen2.5-Coder-4B". TRUE GGUF header says `qwen3`/"Mini Coder 4b"/`Qwen3 4B Instruct 2507`. The 0.683 battery was measured on THIS file. Target the actual on-disk base.
2. **`convert_lora_to_gguf.py`**: both skills claim it lives at `E:\llama-cpp\`. It does NOT. It ships in the **llama.cpp GitHub source repo** (`convert_lora_to_gguf.py` at repo root) and must be fetched + given the `gguf` pip package. The binary-only dir provides llama-server/llama-quantize only.

## Lane contract (what the closed loop hands the lane)

`selfimprove.mjs` EMIT writes to `.aide/training/signal-YYYY-MM-DD.jsonl`:
```json
{"ts":"...","category":"rejection|gate|format|error|desktop-refusal","source":"<module>",
 "verifier":"selfimprove-script-v1","verifier_result":"fail","original_event":{...},
 "prompt":"<failed prompt or task>","stage_hint":"sft|distill|preference"}
```
- NO `passing_completion` — the lane must generate the corrected completion (per post-training-closed-loop: format fail -> SFT, reasoning fail w/ clean pass trace -> distill).
- The lane OWNS the weight update; the harness OWNS detect+emit+verify.
- VERIFY step is operator-triggered (`scripts/run-harness-battery.mjs` + gate) per the closed-loop skill.

## Wire-in sequence (follow in order; each stage VERIFIES before next)

### Stage 0 — Dependency gate (R8: verify every claim on disk, never trust listed paths)

```powershell
# 1. GPU
nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version --format=csv   # expect 1060 6GB free>1GB
# 2. Pick venv python (MUST be E:\Python311 - has pip)
& E:\Python311\python.exe -c "import sys; print(sys.version)"                        # 3.11.9
# 3. Existing ML venvs (any of these working = skip rebuild)
& E:\felon_workspace\venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"        # expect cpu-only today
& E:\models\house-model\training-venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"   # expect cpu-only today
# 4. Base GGUF + adapter present
Test-Path E:\aide-sovereign-workbench\models\aide-house\base.q8_0.gguf   # True
Test-Path E:\aide-sovereign-workbench\models\aide-house\frontier-lora.gguf  # True
# 5. Converter FALSE-CHECK: MUST be fetched (never assume it exists)
Test-Path E:\llama-cpp\convert_lora_to_gguf.py    # expect False -> fetch (Stage 6)
```

### Stage 1 — Clean Python 3.11 venv with CUDA torch (E: drive only, never C:)

```powershell
$env:PIP_CACHE_DIR = "E:\pip_temp\pip-cache"            # C: is at 2.7GB free
$env:PYTHONPATH = ""                                     # failure-pythonpath-hijack: NEVER inherit old broken path
& E:\Python311\python.exe -m venv E:\felon_workspace\venv_finetune
# Verify CLEAN home (must point at a Python install dir, not a venv):
Get-Content E:\felon_workspace\venv_finetune\pyvenv.cfg   # expect home = E:\Python311
& E:\felon_workspace\venv_finetune\Scripts\python.exe -m pip install --upgrade pip
# Torch CUDA build. For Pascal (CC 6.1) ON WINDOWS use the cu121/cu118 wheel line:
& E:\felon_workspace\venv_finetune\Scripts\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
# ML stack
& E:\felon_workspace\venv_finetune\Scripts\python.exe -m pip install transformers peft bitsandbytes accelerate datasets trl numpy
# GATE: CUDA must be True
& E:\felon_workspace\venv_finetune\Scripts\python.exe -c "import torch, transformers, peft, bitsandbytes, numpy; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NA'); print('tf', transformers.__version__, 'peft', peft.__version__)"
# If install fails on network/C-drive: pip cache went to E: (set above); free C: if 2.7GB blocks the wheel cache (registry-level %LOCALAPPDATA%\pip also worth redirecting).
```

Pascal note for qLoRA: `bnb_4bit_compute_dtype` — do NOT use `torch.bfloat16` here (bf16 GEMM is emulated on Pascal and can be wrong/slow). Use `torch.float16` (native half on Pascal) or leave fp32. This diverges from the Qwen/Ampere example in older skills — that example targets newer cards.

### Stage 2 — HF-format base (PEFT needs safetensors, NOT gguf)

The on-disk base is GGUF. Two options, FIRST-verify-identity-then-choose:

```powershell
# Read the GGUF header identity BEFORE any conversion (target = this model):
# (llama-tokenize or the gguf python pkg can print general.name / general.architecture)
& E:\felon_workspace\venv_finetune\Scripts\python.exe -c "from gguf import GGUFReader; r=GGUFReader(r'E:\aide-sovereign-workbench\models\aide-house\base.q8_0.gguf'); print([(k, r.fields[k].parts[0].tolist()) for k in ('general.name','general.architecture') if k in r.fields])"
```

- Path A (preferred): plane-download the HF safetensors of the SAME model (`Qwen3-4B-Instruct`, or the "Mini Coder 4b" repo if it publishes safetensors) with `huggingface-cli download` / `snapshot_download` into `E:\models\house-model\base-hf\`. Verify `config.json` architecture=`qwen3` and the lm_head/embedding shapes match the GGUF.
- Path B: if only GGUF exists and no matching safetensors repo is reachable, build an HF dir from the GGUF via llama.cpp's `convert_hf_to_gguf.py` can NOT go reverse — so instead load with the `gguf` python pkg into tensors and write safetensors manually (heavy; only if Path A is unavailable).

Gate: `AutoModelForCausalLM.from_pretrained(base_hf_dir)` loads without error and `model.config.model_type == 'qwen3'`; embedding dim == GGUF's.

### Stage 3 — Signal -> SFT pair generator (Node.js, no Python)

Pattern per `aid-cipher-4b-fine-tune-pipeline` (no Python needed for generation):

1. Read `.aide/training/signal-*.jsonl`.
2. For each row: `prompt` = the failed request. Generate the CORRECTED completion:
   - Try the served engine (`/v1/chat/completions`, temp 0.0-0.2) 1-2x.
   - Keep the completion ONLY if it passes a deterministic must-contain (format/grammar) check for that `stage_hint`.
   - If the engine can't pass, write the correct answer by hand (never feed the model its own failure).
3. Append `{"messages":[{system},{user: prompt},{assistant: corrected}]}` to `E:\felon_workspace\cipher_v2\sft_train\signals-<date>.jsonl`.
4. Merge (dedup by normalized prompt) into the master `sft_train.jsonl`. Target: keep corpus clean (see zero-dup-high-quality skill).

### Stage 4 — QLoRA training (the actual wire-in script)

Location: `E:\felon_workspace\train_cipher_v2.py`. Template (Pascal-corrected):

```python
import torch
from datasets import load_dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, TrainingArguments
from trl import SFTTrainer

bnb = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.float16,   # PASCAL: fp16 native, NOT bf16
    bnb_4bit_use_double_quant=True,
)
base_hf = "E:/models/house-model/base-hf"          # Stage 2
base = AutoModelForCausalLM.from_pretrained(base_hf, quantization_config=bnb, device_map="auto", torch_dtype=torch.float16)
base = prepare_model_for_kbit_training(base, use_gradient_checkpointing=True)
lora = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05,
                  target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
                  bias="none", task_type="CAUSAL_LM")
model = get_peft_model(base, lora)
tok = AutoTokenizer.from_pretrained(base_hf)
tok.pad_token = tok.eos_token
data = load_dataset("json", data_files="E:/felon_workspace/cipher_v2/sft_train.jsonl", split="train")
args = TrainingArguments(
    output_dir="E:/felon_workspace/cipher_v2_adapter", num_train_epochs=1,
    per_device_train_batch_size=1, gradient_accumulation_steps=16,
    learning_rate=2e-4, warmup_steps=100, lr_scheduler_type="cosine",
    weight_decay=0.1, max_grad_norm=1.0, logging_steps=10, save_steps=500,
    fp16=True,                    # Pascal: fp16 training path; bf16 disabled
)
SFTTrainer(model=model, args=args, train_dataset=data, tokenizer=tok).train()
model.save_pretrained("E:/felon_workspace/cipher_v2_adapter")
```

Notes: effective batch 16; ONE epoch (training-sop); AIDE engine OFF during training (GPU contention); monitor per-category regress not just composite.

### Stage 5 — Evaluate gate BEFORE any promotion (mandatory, non-negotiable)

1. Backup current production adapter: `Copy-Item models\aide-house\frontier-lora.gguf models\aide-house\frontier-lora.v1.gguf`.
2. Convert + swap, or point llama-server `--lora` at the new file.
3. Restart the engine (`llama-server.exe -m base.q8_0.gguf --lora cipher_v2_lora.gguf ...`) on the SAME port the battery expects (8091 / configured).
4. `node E:\pip_temp\opencode\capability_audit_cipher_4b.mjs && node scripts\run-harness-battery.mjs`.
5. Decision rule:
   - composite delta >= **+0.02** AND no category regressed > **0.1** -> PROMOTE (replace frontier-lora.gguf, keep v1 backup)
   - delta in [-0.02, +0.02] -> ARCHIVE (save as cipher_v2_lora.archived.gguf)
   - delta < -0.02 -> ROLLBACK (delete v2, v1 stays)
6. Write verdict + raw per-task numbers to `docs/evidence/cipher-v2-eval.md`. Honest numbers only.

### Stage 6 — LoRA -> GGUF adapter conversion (converter must be FETCHED)

```powershell
# Converter is NOT on disk. Fetch from llama.cpp source (pin a tag, e.g. b4xxx or a release):
git clone --depth 1 --branch <pin> https://github.com/ggml-org/llama.cpp E:\pip_temp\llama-cpp-src
# or curl the two files raw into the venv tools dir:
#   https://raw.githubusercontent.com/ggml-org/llama.cpp/<pin>/convert_lora_to_gguf.py
& E:\felon_workspace\venv_finetune\Scripts\python.exe -m pip install gguf   # runtime dep of the converter
& E:\felon_workspace\venv_finetune\Scripts\python.exe E:\pip_temp\llama-cpp-src\convert_lora_to_gguf.py `
   --base E:\aide-sovereign-workbench\models\aide-house\base.q8_0.gguf `
   --outfile E:\aide-sovereign-workbench\models\aide-house\cipher_v2_lora.gguf `
   E:\felon_workspace\cipher_v2_adapter
# SMOKE: file non-empty; llama-server loads it
E:\llama-cpp\llama-server.exe -m E:\aide-sovereign-workbench\models\aide-house\base.q8_0.gguf --lora E:\aide-sovereign-workbench\models\aide-house\cipher_v2_lora.gguf --host 127.0.0.1 --port 8085 --ctx-size 2048 --threads 4 --no-warmup --jinja
# GET http://127.0.0.1:8085/v1/models -> 200
```

### Stage 7 — Promotion is a MANIFEST + serve change, gated

- Do NOT touch `models/manifest.json` until the battery gate passes (premature promotion ships the wrong adapter to the UI).
- After gate passes: swap `frontier-lora.gguf` -> v2 (keep .v1 backup); leave aide-cipher-v1 deprecation note alone UNLESS the 4B is re-promoted as the fine-tune lane model.
- Journal in AGENT_NOTES.md (verdict, delta, per-category, files). Update README scorecard row ONLY with battery-verified numbers.

## What NOT to do (each is a REAL discovered trap)

- Do NOT install anything on the C: drive (2.7 GB free — wheel/venv on C: will wedge the OS disk).
- Do NOT trust that `convert_lora_to_gguf.py` or any *.py exists under `E:\llama-cpp\` — that dir is binaries-only (verified listing). Fetch it.
- Do NOT train on the Qwen2.5 story — the base IS Qwen3 4B "Mini Coder 4b" (`base.q8_0.gguf`). Any HF base you train must match the GGUF's architecture/shapes or the adapter WILL NOT apply.
- Do NOT use `bnb_4bit_compute_dtype=torch.bfloat16` on Pascal — use fp16 or fp32.
- Do NOT run training with the AIDE engine serving the same GPU.
- Do NOT promote without the full battery + per-category regression check. Composite-only is insufficient.

## Threat matrix

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| venv rebuild fails (network/pip) | Med | High | E:\Python311 (has pip); PIP_CACHE_DIR=E:; PYTHONPATH="" (failure-pythonpath-hijack) |
| torch CUDA wheel for Pascal on Windows unavailable | Med | High | Use cu121/cu118 index line; verify cuda=True; fall back to fp32-only LoRA on CPU is NOT acceptable (hours) — instead fix torch line |
| base HF safetensors mismatch (wrong arch/shape) | Med | High | GGUF header identity check FIRST; shape match config vs GGUF |
| qLoRA on 4B OOMs the 6GB | Med | High | micro-batch 1, grad accum 16, grad checkpointing, fp16; drop to r=8 if needed |
| adapter overfits pairs / regresses strong cats | Med | High | ONE epoch + replay 30% + per-category gate + rollback kept |
| converter fetch pin wrong / breaks | Low | Med | Pin a known tag; test load before battery |
| engine can't load adapter (format mismatch) | Low | Med | Convert via the official script; smoke-load before battery |
| 30B "house" model confusion | High | Med | The trainable lane is the 4B only; keep north-30B as served house, never attempt QLoRA on 30B (15GB base > 6GB) |
| manifest promoted before gate | Low | High | Manifest untouched until battery passes (R4) |

## Dependencies

- `E:\Python311\python.exe` (verifiable, pip-capable)
- torch CUDA build (cu121/cu118 wheel), transformers, peft, bitsandbytes, accelerate, trl, datasets, numpy, gguf (for converter)
- HF-format base matching `base.q8_0.gguf` identity (qwen3, Mini Coder 4b)
- `convert_lora_to_gguf.py` fetched from llama.cpp source (NOT on disk)
- `E:\llama-cpp\llama-server.exe` (works, verified --help shows __lora flag)
- Battery `E:\pip_temp\opencode\capability_audit_cipher_4b.mjs` (exists, 0.683 baseline)
- SFT corpus `E:\felon_workspace\cipher_v2\sft_train.jsonl` (exists, 4741 rows)
- R9 law: everything local on E:; zero external at runtime

## Verification (the gate battery for the lane itself)

1. Stage 1 gate: `torch.cuda.is_available() == True`, device name GTX 1060.
2. Stage 2 gate: HF base loads, arch qwen3, shapes match GGUF.
3. Stage 3 gate: signal->pair script ran, dedup clean, appended rows parse.
4. Stage 4 gate: training completes without OOM; adapter dir non-empty.
5. Stage 6 gate: `convert_lora_to_gguf.py` produced non-empty GGUF; server 200s with `--lora`.
6. Stage 5 gate: battery emits composite + per-category; verdict PROMOTE/ARCHIVE/ROLLBACK applied; evidence doc written with raw numbers.

## Sources (verified 2026-09-08)

- HF `docs/transformers` quantization/bitsandbytes: NF4/FP4 min hardware = **NVIDIA Pascal+**; 8-bit optimizers = Pascal+; bf16 compute dtype recommended ONLY for Ampere+ (hence fp16 on Pascal).
- CLaaS (arXiv 2606.05559, 2026-06): continual learning as a service — experience replay, async LoRA training, hot-reload to inference server, chat-API abstraction. LR + replay age most sensitive.
- Auto-Dreamer (arXiv 2605.20616, 2026-05): offline memory consolidation; GRPO-trains the consolidator; memory-utility problem framing.
- GGUF header of `base.q8_0.gguf` read directly (qwen3 / Mini Coder 4b / Qwen3 4B Instruct 2507).
- `E:\llama-cpp\` directory listing (binaries only).
- nvidia-smi (GTX 1060, 5439 MiB free), Get-PSDrive (E: 151.7 GB vs C: 2.7 GB).
- Prior skills rectified: `aid-cipher-4b-fine-tune-pipeline`, `cipher-qlora-finetune`, `device-training-1060`, `failure-pythonpath-hijack`, `model-scaling`, `training-sop`.