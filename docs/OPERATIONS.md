# AIDE Operations — Model Engine

Quick reference for bringing up, verifying, and tearing down the
AIDE in-house model engine (llama-server.exe) on a development
machine. For the production installer path, see
`docs/INSTALL.md` (forthcoming).

## TL;DR

```bash
# Start (defaults: :8084, North-Mini-Code, vulkan, ngl 999, 32k ctx)
node scripts/launch-model-engine.cjs

# Custom port + GGUF + GPU backend
PORT=8085 GGUF=path/to.gguf BACKEND=cuda node scripts/launch-model-engine.cjs

# Verify
curl http://127.0.0.1:8084/health
curl http://127.0.0.1:8084/v1/models
curl http://127.0.0.1:8084/props

# Send a chat request
curl -X POST http://127.0.0.1:8084/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Say OK"}],"max_tokens":10}'

# Stop
taskkill /F /PID <pid from .aide/logs/north-engine.pid>
```

## Files

- **Launcher:** `scripts/launch-model-engine.cjs`
- **Engine binary:** `E:/llama-cpp/llama-server.exe` (CPU build, b10643)
  - For GPU: extract `E:/models/llama-cpp-cuda12.zip` to `E:/llama-cpp-cuda12/`
    and edit the `LLAMA` constant in the launcher
- **Logs:** `.aide/logs/north-engine-{out,err}.log`
- **PID:** `.aide/logs/north-engine.pid`

## Environment variables

| Var       | Default       | Notes                                   |
|-----------|---------------|-----------------------------------------|
| `PORT`    | `8084`        | North-Mini-Code per the user ROADMAP    |
| `GGUF`    | in-house symlink | 10GB Q2_K_XL North-Mini-Code         |
| `BACKEND` | `vulkan`      | `vulkan`, `cuda`, or `cpu`             |
| `NGL`     | `999`         | GPU layers (999 = all)                  |
| `CTX`     | `32768`       | Context window                          |
| `LABEL`   | `north-engine` | Log file label                         |

## Troubleshooting

### Engine takes >5 min to load (CPU mode)

CPU prompt eval is slow. The 30B-A3B MoE is designed for GPU. To
speed up, extract the cuda12 build:

```bash
# This is a one-time setup (~5 min for the extract)
mkdir E:/llama-cpp-cuda12
tar -xf E:/models/llama-cpp-cuda12.zip -C E:/llama-cpp-cuda12
# Then edit LLAMA in scripts/launch-model-engine.cjs to point at
# E:/llama-cpp-cuda12/llama-server.exe
```

### "Address already in use" on :8084

Either a previous engine is still running, or something else bound
:8084. To find and stop:

```bash
netstat -ano | findstr :8084
taskkill /F /PID <pid>
```

### Model file not found

Check the symlink at `E:/aide-sovereign-workbench/models/aide-house/`
points at the right place. The default is the North-Mini-Code GGUF
at `E:/models/north-mini-code/North-Mini-Code-1.0-UD-Q2_K_XL.gguf`.

### Health endpoint returns 503 "Loading model"

The engine is mid-load. Wait ~30s (CPU) or ~10s (GPU). Poll
`/health` until it returns 200.

## Verified (2026-08-29)

- Engine launched on :8084 via `scripts/launch-model-engine.cjs`
- Model loaded (10GB Q2_K_XL, 4 slots, 32k context)
- `GET /health` returns 200 `{"status":"ok"}`
- `GET /v1/models` returns the loaded model
- `GET /props` returns model_alias matching the symlinked GGUF
- Chat requests accepted (4-slot queue); prompt-eval slow on CPU
