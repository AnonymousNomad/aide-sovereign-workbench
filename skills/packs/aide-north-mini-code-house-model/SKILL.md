# Skill: aide-north-mini-code-house-model

# North-Mini-Code-1.0 — AIDE's House Model (Complete Playbook)

## The Decision

North-Mini-Code-1.0 is AIDE's permanent house model. Apache 2.0, 30B total / 3B active MoE, 128 experts (8 per token), 256K context, interleaved thinking, native tool calling, RLVR-trained for agentic coding. This skill encodes EVERYTHING needed to serve, adapt, fine-tune, and continuously improve it.

## Architecture Facts (verified)

- **Model**: CohereLabs/North-Mini-Code-1.0 (30B-A3B, cohere2moe arch)
- **License**: Apache 2.0 — full fine-tuning rights
- **Attention**: Interleaved SWA (4096 window, RoPE) + global (no PE) in 3:1 ratio
- **FFN**: MoE block — 128 routed experts, 8 active per token, SwiGLU activation, sigmoid gating
- **Dense lead**: 1 dense FFN layer before sparse layers
- **Post-training**: Two-stage cascaded SFT + RLVR on agentic coding
- **Tokenizer**: tiny_aya (Cohere's tokenizer type)
- **Architecture ID in llama.cpp**: `cohere2moe` (PR #24260, merged 2026-06-13, release b9626+)
- **Chat template**: Cohere2-MoE.jinja (MUST use --jinja; some GGUFs embed wrong template)

## Part 1: SERVING ON GTX 1060 6GB + 16GB RAM

### The Key Insight (MoE CPU Offload)

MoE models activate only 3B of 30B parameters per token. The routed expert FFN weights (95% of total parameters) can live in CPU RAM while attention + embeddings stay on GPU. This is the `--n-cpu-moe` trick.

**Proven baseline**: Qwen3.6 35B-A3B on GTX 1060 6GB at 17 tok/s (SozAI 2026-07-28, verified).
Same architecture class as North-Mini-Code.

### VRAM Budget (Q2_K_XL, 9.76GB file)

| Component | Placement | Size |
|-----------|-----------|------|
| Attention weights (Q/K/V/O) | GPU | ~800MB |
| Embeddings + output head | GPU | ~600MB |
| Router (gate_inp) | GPU | ~1MB per layer |
| Shared expert FFN (shexp) | GPU | ~100MB |
| KV cache (4096 ctx) | GPU | ~200MB |
| **GPU total** | | **~1.7GB** |
| Routed expert FFN (exps) | CPU | ~8GB |
| **CPU total** | | **~8GB** |
| **System + OS overhead** | | **~6GB** |
| **Total RAM needed** | | **~14GB** |

### Launch Command (VERIFIED FLAGS)

```bash
llama-server.exe \
  -m E:\models\north-mini-code\North-Mini-Code-1.0-UD-Q2_K_XL.gguf \
  --host 127.0.0.1 --port 8084 \
  -ngl 99 \
  --n-cpu-moe 999 \
  --ctx-size 4096 \
  --jinja \
  --mlock \
  --threads 6 \
  --threads-batch 6 \
  --prio -1
```

**Flag explanations**:
- `-ngl 99`: Offload ALL layers to GPU (attention stays, experts get routed to CPU by n-cpu-moe)
- `--n-cpu-moe 999`: Offload routed expert FFN from first 999 layers to CPU (= all layers)
- `--ctx-size 4096`: Reduced context (256K doesn't fit on 6GB VRAM)
- `--jinja`: Enable Cohere2MoE chat template (REQUIRED for thinking + tool calling)
- `--mlock`: Pin expert weights in RAM, prevent kernel paging
- `--threads 6`: Use all 6 cores of i7-8750H for CPU expert compute
- `--prio -1`: Yield priority to operator's other jobs

### Tuning Procedure (from Aliteq research)

1. Start with `--n-cpu-moe 999` (all experts on CPU)
2. Check if it loads without OOM
3. If yes, try reducing: `--n-cpu-moe 30` to move some experts back to GPU
4. The "knee" = smallest N where model fits without overcommitting
5. Stop at the knee — every step past costs throughput

### Alternative: --override-tensor (surgical control)

```bash
# Put ALL routed experts on CPU, keep everything else on GPU:
-ot "exps=CPU"

# Or put experts from layers 20+ on CPU, keep layers 0-19 on GPU:
-ot "blk\.(20|[2-9][0-9])\.ffn_(up|gate|down)_exps\.weight=CPU"
```

### Known Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Wrong chat template | Model doesn't think, broken tool calls | Use `--jinja` + verify Cohere2-MoE.jinja |
| KV cache OOM | "Failed to allocate pinned memory" | Reduce -c (4096 or lower) |
| Expert paging thrash | ~3 tok/s instead of ~17 | Use --n-cpu-moe to take control from Windows driver |
| Missing --mlock | First token after idle takes 4s | Add --mlock to pin expert pages |
| Wrong template embedded | "unknown pre-tokenizer type" | Some GGUFs have wrong template; use --chat-template-file |
| --no-mmap deprecation | Warning on newer builds | Still works; use if model > RAM |

### Quantization Options (from bartowski + unsloth)

| Quant | File Size | Quality | Fits 6GB VRAM? |
|-------|-----------|---------|-----------------|
| IQ2_XXS | 8.51GB | Very low | Best fit |
| IQ2_XS | 9.42GB | Low | Yes |
| IQ2_S | 9.61GB | Low | Yes |
| **Q2_K_XL** | **9.76GB** | **Very low, usable** | **Yes (current)** |
| IQ2_M | 10.55GB | Relatively low | Yes (tight) |
| Q2_K | 11.09GB | Very low, usable | Yes (very tight) |

**Recommendation**: Start with IQ2_XXS (8.51GB) for fastest loading; upgrade to Q2_K_XL if quality insufficient.

## Part 2: TOOL CALLING & THINKING FORMAT

### Chat Template Structure

North-Mini-Code uses special tokens:
```
<|START_OF_TURN_TOKEN|><|SYSTEM_TOKEN|>...<|END_OF_TURN_TOKEN|>
<|START_OF_TURN_TOKEN|><|CHATBOT_TOKEN|>...<|END_OF_TURN_TOKEN|>
<|START_OF_TURN_TOKEN|><|USER_TOKEN|>...<|END_OF_TURN_TOKEN|>
```

Thinking blocks:
```
<|START_THINKING|>reasoning here<|END_THINKING|>
```

Tool calls:
```
<|START_ACTION|>[
  {"tool_call_id": "0", "tool_name": "bash", "parameters": {"command": "ls"}}
]<|END_ACTION|>
```

Tool results:
```
<|START_TOOL_RESULT|>[
  {"tool_call_id": "0", "results": {"stdout": "file.txt"}, "is_error": null}
]<|END_TOOL_RESULT|>
```

### Tool Use via llama.cpp

Define tools as JSON schema in the OpenAI-compatible request:
```json
{
  "messages": [{"role": "user", "content": "list files"}],
  "tools": [{
    "type": "function",
    "function": {
      "name": "bash",
      "description": "Execute a bash command",
      "parameters": {
        "type": "object",
        "properties": {
          "command": {"type": "string", "description": "The command to execute"}
        },
        "required": ["command"]
      }
    }
  }]
}
```

**IMPORTANT**: The `--jinja` flag is REQUIRED for tool calling to work. Without it, the model won't parse tool schemas.

### Interleaved Thinking

North-Mini-Code "works best when turned on." Pass thinking content to future turns for best performance. The model generates BOTH thinking AND tool calls in a single response.

## Part 3: FINE-TUNING REALITY

### The Hard Truth (verified 2026-08-26)

**You CANNOT fine-tune North-Mini-Code on GTX 1060 6GB + 16GB RAM.**

Evidence:
1. Unsloth docs: "Training MoE models in 4-bit QLoRA isn't recommended because BitsAndBytes doesn't support it"
2. MoE bf16 LoRA requires loading the full base model (61GB) — exceeds 16GB RAM total
3. Even with CPU offloading, bf16 LoRA training needs ~61GB base + optimizer states + gradients
4. The MoE Split LoRA optimization (Unsloth) helps with speed/VRAM but still needs the base loaded

### The Working Path (Two-Tier System)

**Tier 1: North-Mini-Code as the BRAIN (served, NOT fine-tuned)**
- Serves via llama-server with MoE CPU offload
- Already RLVR-trained for agentic coding — strong out of the box
- Adapted via: prompt engineering + grammar constraints + few-shot examples
- Zero weight changes needed initially

**Tier 2: Dense 4B models as the TRAINABLE BODY**
- qwen3-4b, mini-coder-4b, qwen3.5-4b — all QLoRA-feasible on 6GB
- Trained on trajectories distilled FROM North-Mini-Code
- This is the model that improves over time via the Cipher living system

### Distillation Pipeline (North-Mini-Code → Dense 4B)

```
North-Mini-Code generates responses on AIDE tasks
    ↓
Trajectories captured to .aide/trajectories/*.traj.json
    ↓
Filter: gate-passed + operator-approved only
    ↓
Format as SFT pairs: {prompt, verified_response}
    ↓
QLoRA fine-tune dense 4B model (standard recipe)
    ↓
Merge LoRA → convert to GGUF → serve as alternative
    ↓
Battery: compare dense-4B vs North-Mini-Code on same tasks
    ↓
If dense-4B catches up → it becomes the fast-path model
    (North-Mini-Code remains the fallback/teacher)
```

### LoRA Conversion (when training dense models)

```bash
# Convert PEFT adapter to GGUF
python convert_lora_to_gguf.py \
  --base /path/to/base/model/dir \
  ./adapter-output-dir \
  --outfile adapter-lora.gguf \
  --outtype f16

# Serve with hot-swap
llama-server -m base.gguf --lora adapter-lora.gguf ...

# Hot-swap at runtime (no restart)
POST /lora-adapters
[{"id": 0, "scale": 0.8}]
```

### Supported LoRA Target Modules (llama.cpp)

k_proj, q_proj, v_proj, gate_proj, up_proj, down_proj, lm_head, router, w1/w2/w3 (MoE)

## Part 4: TELEGRAM ACCESS

### Fast Path (Standalone Bot)

Use aneeshjoy/llama-telegram-bot pointed at :8084:
```bash
export BOT_TOKEN=<from BotFather>
export MODEL_URL=http://127.0.0.1:8084
python bot.py
```

Features: streaming responses, group chat, whitelist, voice chat, typing indicator.

### Integrated Path (T1 Daemon Proxy)

T1 workbench daemon proxies Telegram messages to :8084 chat endpoint:
- POST /api/chat with modelId="north-mini-code"
- SSE streaming back to Telegram
- Same auth as existing Telegram transport

### Recommended: Fast path first, integrate later

## Part 5: HARNESS SCAFFOLDING

### Layer Budget (from aide-harness-prompt-scaffolding)

| Layer | Content | Lines | Priority |
|-------|---------|-------|----------|
| L0 CORE | Code + Influence-Literacy Lens (from aide-credo-guardrail) | ~28 | Always |
| L1 FORMAT | SEARCH/REPLACE blocks, envelope discipline | ~10 | Always |
| L2 SOP | Task-family checklists (coding/planning/utility) | ~25 | Per-role |
| L3 WORKSPACE | Branch, test command, dir layout | ≤10 | Dynamic |
| **TOTAL** | | **~73 lines** | Under 80-line budget |

### North-Mini-Code Specific

- Model handles ~150-200 instruction-lines reliably (IFScale research)
- System prompt consumes ~50 slots
- Our 73-line scaffold is well within budget
- Re-inject L0+L1 as mid-conversation reminder when transcript exceeds threshold

## Part 6: CLOSED-LOOP (CIPHER LIVING SYSTEM)

### State Bus (.aide/cipher-state.jsonl)

Every interaction appends one JSON line:
```json
{"type": "approval", "tool": "bash", "decision": "approved", "confidence": 0.95}
{"type": "rejection", "tool": "edit", "reason": "wrong file"}
{"type": "gate", "gate": "format", "passed": true, "duration_ms": 120}
```

### Trajectory Capture

```python
# Each interaction logged
{
    "timestamp": "...",
    "prompt": "user request",
    "north_response": "model output with thinking + tool calls",
    "tool_results": [...],
    "outcome": "success/failure",
    "gates_passed": ["format", "reasoning", "safety"],
    "operator_approved": true
}
```

### Sleep-Time Training

1. Load trajectories from today
2. Filter: only VERIFIED outcomes (gates passed + operator approved)
3. Build SFT dataset: {prompt, verified_response} pairs
4. Mix 30% general instruction data (anti-forgetting)
5. QLoRA fine-tune dense 4B model: rank-32, alpha-64, lr=5e-4
6. Evaluate: battery comparison base vs updated
7. Gate: delta >= 0 required
8. Convert adapter → GGUF via convert_lora_to_gguf.py
9. Hot-swap via /lora-adapters endpoint

### Learned Injection

buildScaffold() reads last N approved patterns from cipher-state.jsonl:
```
[learned] Operator prefers async/await over promise chains
[learned] Auth module uses JWT tokens — follow existing pattern
```
Cap at 10 lines, only entries seen >= 3 times.

## Part 7: DESKTOP CONTROL ADAPTATION

### Existing Work (verified)

- **uia-agent** (SuperMarioYL/uia-agent): MIT, 700 lines, UIA tree → LLM → action → UIA pattern
- **Kodo** (harshpatel0/Kodo): Planner + Actor architecture, gemma4:e4b primary model
- **agent-ctrl** (Vercel): Rust CLI, UIA/AX/AT-SPI, daemon architecture
- Our executor follows the SAME pattern: UIA tree → model → DSL action → UIA dispatch

### North-Mini-Code for Desktop Control

The model is ALREADY trained for agentic coding. Desktop control is a specialization of agentic coding. Adapt via:

1. **Tool definitions**: Define our DSL verbs (click, set_text, key, etc.) as JSON tools
2. **System prompt**: Include UIA tree format + action DSL v1.1 grammar
3. **Few-shot examples**: From our 1,098-row SFT corpus
4. **Grammar constraint**: action_dsl.gbnf enforces valid output format

### Tool Definition for Desktop Control

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "click",
        "description": "Click a UI element by its numeric target ID from the UIA tree snapshot",
        "parameters": {
          "type": "object",
          "properties": {
            "target": {"type": "integer", "description": "Element ID from UIA tree"}
          },
          "required": ["target"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "set_text",
        "description": "Set text value of a UI element",
        "parameters": {
          "type": "object",
          "properties": {
            "target": {"type": "integer"},
            "value": {"type": "string"}
          },
          "required": ["target", "value"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "key",
        "description": "Press a keyboard key combination",
        "parameters": {
          "type": "object",
          "properties": {
            "keys": {"type": "string", "description": "Key combo like 'ctrl+s', 'enter', 'tab'"}
          },
          "required": ["keys"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "read_window",
        "description": "Get UIA tree snapshot of the active window",
        "parameters": {"type": "object", "properties": {}}
      }
    },
    {
      "type": "function",
      "function": {
        "name": "finished",
        "description": "Task is complete",
        "parameters": {
          "type": "object",
          "properties": {
            "summary": {"type": "string"}
          },
          "required": ["summary"]
        }
      }
    }
  ]
}
```

## Part 8: SWE / CODING / PLANNING

### North-Mini-Code's Native Capabilities

Already trained for:
- Repo-level code changes (SWE-Agent, OpenCode)
- Terminal-based agents (shell tools, multi-turn)
- Code generation (scientific coding, algorithmic reasoning)
- Understanding and orchestrating sub-agents
- Mapping systems architecture
- Running code reviews

### AIDE Integration Points

1. **Plan phase**: Model generates SEARCH/REPLACE blocks for code changes
2. **Act phase**: Model applies edits via tool calls
3. **Debug phase**: Model reads error output, generates fixes
4. **Test phase**: Model runs tests, interprets results
5. **Review phase**: Model reviews its own changes (self-critique)

## Part 9: KNOWN ISSUES & SOLUTIONS

| Issue | Cause | Solution | Skill Reference |
|-------|-------|----------|-----------------|
| "unknown model architecture: cohere2-moe" | Old llama.cpp | Use b9626+ | this skill |
| "unknown pre-tokenizer type: cohere2moe" | Missing vocab support | Use b10636+ | this skill |
| Broken tool calling | Wrong/outdated template | Use --jinja + Cohere2-MoE.jinja | this skill |
| First-chat race (warmup) | Server binds before context loads | Warmup gate (1-token gen, 3×10s) | aide-arch-model-runtime |
| Thinking blocks ignored | reasoning-format not set | --reasoning-format auto | this skill |
| Vulkan OOM at load | VRAM overcommit | --n-cpu-moe 999 + -c 4096 | this skill |
| Slow first token after idle | Kernel paging expert weights | --mlock | this skill |
| Port squatting | Foreign process on :8084 | Check identity, else next port | aide-arch-model-runtime |
| RAM contention | Training + serving together | One-job-at-a-time law | process-hygiene-sop |

## Part 10: VERIFICATION BATTERY

### Before claiming "house model ready":

1. **Serve**: North-Mini-Code loads on :8084 with MoE CPU offload, health=ok
2. **Coherence**: Basic chat produces coherent English responses
3. **Code gen**: Python/JS code generation is correct
4. **Tool calling**: JSON tool calls parse correctly via --jinja
5. **Thinking**: Interleaved thinking blocks appear and are coherent
6. **Grammar test**: action_dsl.gbnf produces valid DSL output
7. **Speed**: >5 tok/s on GTX 1060 (target: ~15 tok/s)
8. **Telegram**: Bot can reach :8084 and get responses
9. **State**: cipher-state.jsonl captures interactions
10. **No strays**: process-hygiene-sop P2-P3 passes

## Dependencies

- llama.cpp b10636+ (cohere2moe arch + Cohere2MoE chat parser)
- North-Mini-Code-1.0-UD-Q2_K_XL.gguf (9.76GB, downloaded)
- Python 3.10 + huggingface_hub (for future GGUF downloads)
- BotFather Telegram token (for Telegram integration)

## Files

- `E:\models\north-mini-code\North-Mini-Code-1.0-UD-Q2_K_XL.gguf` — the model
- `E:\llama-cpp-b10636\llama-server.exe` — the server
- `E:\FSI-FELON\models\desktop_agent\grammars\action_dsl.gbnf` — desktop control grammar
- `E:\FSI-FELON\models\desktop_agent\desktop_executor.py` — executor
- `E:\FSI-FELON\models\desktop_agent\agent_loop.py` — agent harness
