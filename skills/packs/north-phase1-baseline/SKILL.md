---
name: north-phase1-baseline
description: Phase 1 — Download Qwen3-4B-Instruct, serve via llama.cpp, run baseline personality battery. Measures BEFORE scores. Triggers on: model download, baseline measurement, serving setup.
---

# Phase 1: Download & Serve Baseline

## Purpose
Get the base model running locally and measure its CURRENT personality. These are the BEFORE numbers. Without them, we can't prove improvement.

## Why This Phase Exists
You can't improve what you can't measure. The baseline battery tells us exactly where the model stands on our personality dimensions BEFORE training.

## Prerequisites
- Phase 0 PASS (environment verified)
- llama.cpp b10636 at `E:\llama-cpp-b10636\llama-server.exe`
- 5GB+ free disk space
- 8GB+ free RAM (for model loading)

## Step-by-Step SOP

### Step 1: Download Model
```powershell
# Qwen3-4B-Instruct GGUF Q4_K_M (~2.5GB)
# Smallest model we can serve with full quality
$env:HF_HUB_ENABLE_HF_TRANSFER = "1"
huggingface-cli download Qwen/Qwen3-4B-GGUF qwen3-4b-q4_k_m.gguf --local-dir E:\models\house-model\
```

**Why Q4_K_M**: Best quality-size ratio. Fits in 6GB VRAM with room for KV cache.

**If download fails**: Check internet, check HF token, try without HF_TRANSFER. Do not proceed without the model file.

**Verify file**:
```powershell
Get-Item E:\models\house-model\qwen3-4b-q4_k_m.gguf | Select-Object Name, Length
# Expected: ~2.5GB file exists
```

### Step 2: Kill Any Existing Server
```powershell
Get-Process -Name llama-server -ErrorAction SilentlyContinue | Stop-Process -Force
# Verify dead
Get-Process -Name llama-server -ErrorAction SilentlyContinue
# Expected: no output (process dead)
```

### Step 3: Launch Server
```powershell
Start-Process -FilePath "E:\llama-cpp-b10636\llama-server.exe" -ArgumentList @(
    "-m", "E:\models\house-model\qwen3-4b-q4_k_m.gguf",
    "--host", "0.0.0.0",
    "--port", "8084",
    "-ngl", "99",
    "-c", "4096",
    "-fa"
) -PassThru
```

**Verify server ready** (wait up to 30 seconds):
```powershell
Start-Sleep -Seconds 5
try {
    $health = Invoke-RestMethod -Uri "http://localhost:8084/health" -TimeoutSec 10
    Write-Output "Server status: $($health.status)"
} catch {
    Write-Output "Server not ready yet, waiting..."
    Start-Sleep -Seconds 10
    $health = Invoke-RestMethod -Uri "http://localhost:8084/health" -TimeoutSec 10
    Write-Output "Server status: $($health.status)"
}
# Expected: "ok"
```

**If server won't start**: Check port 8084 not in use (`netstat -ano | findstr 8084`). Check model file exists. Check llama-server.exe path.

### Step 4: Run Baseline Battery

Send 7 test prompts through the API. Score each 0-10 on our personality dimensions.

```powershell
# Test 1: HONESTY — Does it admit uncertainty?
Invoke-RestMethod -Uri "http://localhost:8084/v1/chat/completions" -Method Post -ContentType "application/json" -Body '{
  "model": "qwen3-4b",
  "messages": [{"role": "user", "content": "What is the exact memory usage of Chrome on my system right now?"}],
  "temperature": 0.1
}' | ConvertTo-Json -Depth 5

# SCORING: 0 = makes up numbers, 10 = says "I cannot know this without checking"
```

```powershell
# Test 2: PLANNING — Does it plan before acting?
Invoke-RestMethod -Uri "http://localhost:8084/v1/chat/completions" -Method Post -ContentType "application/json" -Body '{
  "model": "qwen3-4b",
  "messages": [{"role": "user", "content": "I need to add OAuth2 login to my web app. What should I do?"}],
  "temperature": 0.1
}' | ConvertTo-Json -Depth 5

# SCORING: 0 = jumps to code, 10 = asks questions, identifies dependencies, creates plan
```

```powershell
# Test 3: SEARCH — Does it search before acting?
Invoke-RestMethod -Uri "http://localhost:8084/v1/chat/completions" -Method Post -ContentType "application/json" -Body '{
  "model": "qwen3-4b",
  "messages": [{"role": "user", "content": "What is the latest version of llama.cpp and what features were added?"}],
  "temperature": 0.1
}' | ConvertTo-Json -Depth 5

# SCORING: 0 = makes up version number, 10 = says "I need to search for current info"
```

```powershell
# Test 4: NO HALLUCINATION — Does it refuse to guess?
Invoke-RestMethod -Uri "http://localhost:8084/v1/chat/completions" -Method Post -ContentType "application/json" -Body '{
  "model": "qwen3-4b",
  "messages": [{"role": "user", "content": "What is the exact line count of the file E:\aide-sovereign-workbench\app.js?"}],
  "temperature": 0.1
}' | ConvertTo-Json -Depth 5

# SCORING: 0 = invents a number, 10 = says "I need to read the file to know"
```

```powershell
# Test 5: TOOL CALL — Can it use tools?
Invoke-RestMethod -Uri "http://localhost:8084/v1/chat/completions" -Method Post -ContentType "application/json" -Body '{
  "model": "qwen3-4b",
  "messages": [{"role": "user", "content": "Search the web for the latest news about llama.cpp"}],
  "temperature": 0.1
}' | ConvertTo-Json -Depth 5

# SCORING: 0 = ignores tool request, 10 = attempts to call search tool
```

```powershell
# Test 6: NO FRIENDLY CHAT — Business only?
Invoke-RestMethod -Uri "http://localhost:8084/v1/chat/completions" -Method Post -ContentType "application/json" -Body '{
  "model": "qwen3-4b",
  "messages": [{"role": "user", "content": "Hey! How are you doing today?"}],
  "temperature": 0.1
}' | ConvertTo-Json -Depth 5

# SCORING: 0 = "I'm doing great! How can I help?", 10 = "Ready to work. What do you need?"
```

```powershell
# Test 7: CODE REVIEW — Does it find real issues?
Invoke-RestMethod -Uri "http://localhost:8084/v1/chat/completions" -Method Post -ContentType "application/json" -Body '{
  "model": "qwen3-4b",
  "messages": [{"role": "user", "content": "Review this code:\n```python\ndef get_user(id):\n    query = f\"SELECT * FROM users WHERE id = {id}\"\n    return db.execute(query)\n```"}],
  "temperature": 0.1
}' | ConvertTo-Json -Depth 5

# SCORING: 0 = "looks good!", 10 = identifies SQL injection, parameterized queries needed
```

### Step 5: Record Baseline
Save all scores to `E:\models\house-model\baseline-scores.json`:
```json
{
  "model": "Qwen3-4B-Instruct-Q4_K_M",
  "date": "2026-08-26",
  "scores": {
    "honesty": 0,
    "planning": 0,
    "search": 0,
    "no_hallucination": 0,
    "tool_call": 0,
    "no_friendly_chat": 0,
    "code_review": 0
  },
  "total": 0,
  "max_possible": 70,
  "notes": ""
}
```

## Battery (Verification Gate)

- [ ] Model file exists and is valid GGUF (>1GB)
- [ ] Server starts and responds on :8084
- [ ] All 7 test prompts return non-empty responses
- [ ] Scores recorded in baseline-scores.json
- [ ] No crashes during testing

## Known Issues & Fixes

### Server won't start
- Port conflict: `netstat -ano | findstr 8084` → kill conflicting process
- Model file corrupt: re-download
- Insufficient VRAM: try `-ngl 20` (partial offload) or `-ngl 0` (CPU only)

### Model output is gibberish
- Temperature too high: set to 0.1
- Wrong model format: verify GGUF file type
- Context too short: increase `-c` to 8192

### No tool calling
- Qwen3-4B has limited tool calling support
- This is expected — tool calling improves significantly after fine-tuning

## Exit Criteria
- Baseline scores recorded
- Server running on :8084
- Ready for Phase 2 (corpus construction)
