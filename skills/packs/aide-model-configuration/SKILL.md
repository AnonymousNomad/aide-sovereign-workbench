# Skill: aide-model-configuration

# Model Configuration — Runtime Tuning and Management

Managing model startup, runtime parameters, sampling profiles, and performance
monitoring for the local llama.cpp serving stack.

## Architecture

```
models/manifest.json → model-manager.mjs → llama.cpp server → /v1/chat/completions
                                              ↓
                                        port 8081-8087
```

## Key Files

- `models/manifest.json` — model registry with paths, context sizes, presets
- `daemon/server.mjs` — /api/model/start, /api/model/stop, /api/model/chat
- `daemon/model-manager.mjs` — spawn/kill llama-server processes

## Model Startup Flow

1. User selects engine in MODELS panel
2. Frontend calls `/api/model/start` with model ID
3. Daemon reads manifest, finds GGUF path
4. Spawns `llama-server` with correct flags:
   ```
   llama-server -m <path.gguf> --ctx-size <N> --port <port> --host 127.0.0.1
   ```
5. Waits for health endpoint to return 200
6. Frontend updates engine chip to green

## Sampling Profiles

| Profile | temp | top_k | top_p | min_p | repeat_penalty | mirostat |
|---------|------|-------|-------|-------|----------------|----------|
| PRECISE | 0.3 | 40 | 0.9 | 0.05 | 1.1 | 0 |
| BALANCED | 0.7 | 40 | 0.9 | 0.05 | 1.1 | 0 |
| CREATIVE | 1.0 | 100 | 0.95 | 0.05 | 1.1 | 0 |
| MIROSTAT | 0.7 | 0 | 0 | 0 | 1.1 | 2 (tau=5, eta=0.1) |

## Runtime Parameters

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| ctx-size | 4096 | 512-32768 | Context window size |
| threads | auto | 1-12 | CPU threads for inference |
| ngl | 0 | 0-35 | GPU layers offloaded |
| batch-size | 512 | 1-2048 | Prompt processing batch |
| ubatch-size | 512 | 1-512 | Micro-batch for generation |

## Port Doctrine

| Port | Purpose |
|------|---------|
| 8081 | Primary model |
| 8082-8087 | Additional models (multi-model) |
| 4777 | Facade daemon |
| 4778 | TypeScript daemon |
| 4779 | Legacy daemon |
| 4173 | Frontend static |

## Performance Monitoring

- Tokens/second displayed in engine chip
- TTFT (time to first token) tracked
- RAM usage monitored via process.memoryUsage()
- VRAM tracked via nvidia-smi (if available)

## Common Issues

### Model won't start
1. Check GGUF file exists at manifest path
2. Check port isn't in use: `netstat -ano | findstr :8081`
3. Check RAM: need ~2x model size in RAM
4. Check llama-server binary exists

### Slow generation
1. Check threads: too many causes contention
2. Check context size: larger = slower
3. Check batch size: too small = slow prompt processing
4. Check GPU offload: ngl > 0 needs CUDA/Vulkan build

### Port conflict
1. Kill old process: `taskkill /PID <pid> /F`
2. Or use next port (8082, 8083, etc.)
3. Check for zombie processes

## Verification

Battery: Run existing batteries that test model start/stop/chat.
After any change to model-manager, run the full harness test suite.
