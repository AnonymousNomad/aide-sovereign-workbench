# Phase 1: SERVE — DeepSeek-R1-0528-Qwen3-8B on :8084

## STANDARD OPERATING PROCEDURE

### Hard Rules (MANDATORY)
1. Every spawned process MUST be killed + verified dead before claiming done
2. Port 8084 MUST be free before launch — check identity if occupied
3. Server MUST respond to /health before any downstream test
4. No smoke tests — every probe is a real operation with real assertions
5. If any probe fails → fix → re-run ALL probes from start (no partial passes)

### Step 1: Download Model
```bash
# Create directory
mkdir E:\models\house-model

# Download DeepSeek-R1-0528-Qwen3-8B Q4_K_M via huggingface-cli
huggingface-cli download unsloth/DeepSeek-R1-0528-Qwen3-8B-GGUF --include "DeepSeek-R1-0528-Qwen3-8B-Q4_K_M.gguf" --local-dir E:\models\house-model
```

If huggingface-cli not available, use Python:
```python
from huggingface_hub import hf_hub_download
hf_hub_download("unsloth/DeepSeek-R1-0528-Qwen3-8B-GGUF", "DeepSeek-R1-0528-Qwen3-8B-Q4_K_M.gguf", local_dir="E:/models/house-model")
```

### Step 2: Verify Download
- File exists at E:\models\house-model\DeepSeek-R1-0528-Qwen3-8B-Q4_K_M.gguf
- File size ~5GB (4.5-5.5GB range acceptable)
- No zero-byte files

### Step 3: Check Prerequisites
- Port 8084 free (netstat)
- llama-server.exe at E:\llama-cpp-b10636\llama-server.exe
- Sufficient free RAM (>6GB)

### Step 4: Launch Server
```bash
E:\llama-cpp-b10636\llama-server.exe `
  --model E:\models\house-model\DeepSeek-R1-0528-Qwen3-8B-Q4_K_M.gguf `
  --host 127.0.0.1 `
  --port 8084 `
  --n-gpu-layers 99 `
  --ctx-size 8192 `
  --flash-attn `
  --threads 6 `
  --mlock `
  --parallel 2
```

### Step 5: Warmup Gate
Wait for server to respond to /health. Timeout 120s.
```bash
# Poll until healthy
for i in {1..40}; do
  response = curl http://127.0.0.1:8084/health
  if response contains "ok": break
  sleep 3
done
```

### Step 6: Run Battery

#### Probe 1: Health Check
```
GET http://127.0.0.1:8084/health
ASSERT response.status == 200
ASSERT response.body contains "ok"
```

#### Probe 2: Model List
```
GET http://127.0.0.1:8084/v1/models
ASSERT response contains "deepseek" or "qwen3"
ASSERT model id is not empty
```

#### Probe 3: Basic Chat
```
POST http://127.0.0.1:8084/v1/chat/completions
{
  "model": "deepseek-r1-0528-qwen3-8b",
  "messages": [{"role": "user", "content": "What is 2+2? Reply with just the number."}],
  "max_tokens": 10
}
ASSERT response contains "4"
ASSERT finish_reason == "stop"
```

#### Probe 4: Thinking Mode
```
POST http://127.0.0.1:8084/v1/chat/completions
{
  "model": "deepseek-r1-0528-qwen3-8b",
  "messages": [{"role": "user", "content": "Solve: If a train travels at 60mph for 2.5 hours, how far does it go? Think step by step."}],
  "max_tokens": 200
}
ASSERT response contains "<think>" OR reasoning content appears
ASSERT response contains "150"
```

#### Probe 5: Speed Test
```
POST http://127.0.0.1:8084/v1/chat/completions
{
  "model": "deepseek-r1-0528-qwen3-8b",
  "messages": [{"role": "user", "content": "Write a Python function to check if a number is prime."}],
  "max_tokens": 200
}
MEASURE time to first token (TTFT) — must be <3 seconds
MEASURE tokens per second — must be >20
```

#### Probe 6: Code Generation
```
POST http://127.0.0.1:8084/v1/chat/completions
{
  "model": "deepseek-r1-0528-qwen3-8b",
  "messages": [{"role": "user", "content": "Write a Python function binary_search(arr, target) that returns the index of target in sorted arr, or -1 if not found. Include type hints."}],
  "max_tokens": 300
}
ASSERT response contains "def binary_search"
ASSERT response contains "-> int"
ASSERT response contains "return -1"
```

#### Probe 7: VRAM Check
```
Run: nvidia-smi --query-gpu=memory.used,memory.total --format=csv
ASSERT VRAM used < 5.5GB
ASSERT VRAM total == 6GB
```

### Step 7: Record Results
Write results to E:\models\house-model\phase1-results.json:
```json
{
  "phase": 1,
  "model": "DeepSeek-R1-0528-Qwen3-8B",
  "quant": "Q4_K_M",
  "file_size_gb": X.XX,
  "health": "pass/fail",
  "model_list": "pass/fail",
  "basic_chat": "pass/fail",
  "thinking_mode": "pass/fail",
  "speed_tok_per_s": XX,
  "ttft_seconds": X.X,
  "code_gen": "pass/fail",
  "vram_used_gb": X.X,
  "overall": "pass/fail",
  "timestamp": "ISO-8601"
}
```

### Step 8: Cleanup
- Kill any test processes
- Leave server running on :8084
- Mark phase complete only if ALL 7 probes pass
