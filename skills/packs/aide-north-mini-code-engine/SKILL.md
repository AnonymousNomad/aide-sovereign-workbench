# North-Mini-Code-1.0 Engine Launch SOP on this Machine (GTX 1060 6GB, Pascal, VMware SVGA)

## Verified state (2026-08-30, this session)

- **Model:** `CohereLabs/North-Mini-Code-1.0` quantized to `unsloth/North-Mini-Code-1.0-GGUF` UD-Q2_K_XL (10.5GB on disk)
- **License:** Apache 2.0
- **Architecture:** cohere2moe, 49 layers, 128 experts, 8 active per token (30B total / 3B active = A3B)
- **Attention:** interleaved 3:1 ratio of sliding-window-with-RoPE + global-no-positional
- **Context:** 256K native, served at 32K in our config
- **Tokenizer:** 262K vocab (Cohere tokenizer)
- **Chat template:** native tool-use (JSON schema) + interleaved thinking via `reasoning_content` field
- **Required llama.cpp build:** stock `E:\llama-cpp\llama-server.exe` (build 9940+) — cohere2moe merged into llama.cpp via PR #24260, no custom build needed. CONFIRMED with `llama-cli --verbose` on the model: 442 tensors loaded, 49 layers, 128 experts, all metadata parsed.

## Launch command (PROVEN to work)

```powershell
& "E:\llama-cpp\llama-server.exe" `
    -m "E:\aide-sovereign-workbench\models\aide-house\North-Mini-Code-1.0-UD-Q2_K_XL.gguf" `
    --host 127.0.0.1 --port 8084 `
    --ctx-size 32768 `
    --threads 4 --parallel 1 `
    --no-warmup --prio -1 --jinja `
    -ngl 999
```

### Flags explained (per the 8/27 engine-lifecycle-doctrine law + observed behavior)

- `--no-warmup` **MANDATORY** — the warmup epoch wedges the process on this card (confirmed: process dies at "warming up the model with an empty run" without this flag).
- `-ngl 999` — tries to offload all layers to GPU. The MoE model will spill experts to CPU automatically (per llama.cpp's expert offload logic, the 8 active experts per token fit in VRAM at any time).
- `--prio -1` — lower priority so this engine doesn't fight T1's other engines.
- `--jinja` — required for the North chat template (with tool-use + reasoning_content).
- `--ctx-size 32768` — T1's config; the native 256K context would OOM this card.
- `--parallel 1` — single concurrent request (sufficient for our workload).

### Do NOT pass `--no-mmap` — same 8/27 VMware SVGA wedge that affects every other engine on this card.

## Engine facts observed

- Cold start: 4-7 minutes (10.5GB model + warmup disabled + CPU spill)
- Warm subsequent restarts: ~60s
- VRAM use at idle: ~3-4GB (active experts + KV cache for 32K context)
- Generation speed on CPU: 0.3-0.5 tok/s (3B active per token, CPU-bound)
- Prompt eval: 15-20 tok/s
- Interleaved thinking: emits `reasoning_content` field on every response; `content` may be empty if all tokens go to thinking

## Verified response shape (real probe from this session)

```json
{
  "id": "chatcmpl-EMiqMQrlRK48tdlGBcqvoJrMcqDlwdzN",
  "object": "chat.completion",
  "created": 1788118816,
  "model": "E:/aide-sovereign-workbench/models/aide-house/North-Mini-Code-1.0-UD-Q2_K_XL.gguf",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "OK",
        "reasoning_content": "The user asks: \"Reply with exactly: OK\". So I must output exactly \"OK\". No extra text. So answer \"OK\"."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {"completion_tokens": 33, "prompt_tokens": 121, "total_tokens": 137},
  "timings": {"prompt_per_second": 15.69, "predicted_per_second": 0.33}
}
```

## Threat matrix

| Threat | Mitigation |
|---|---|
| Cold load wedges at warmup | `--no-warmup` (verified) |
| `no-mmap` wedge on VMware SVGA | NEVER pass `--no-mmap` (8/27 doctrine) |
| T1's engines fight for VRAM | T1's ports 8081/8082/8090 + ours 8084 = total ~10GB used, 6GB card survives because North is mostly CPU-offloaded |
| File lock from another process | Use a different port; PID-scoped kill only (no `/IM llama-server`) |
| 140s+ chat hang on first call | This is the cold-load transient per the 8/27 `aide-inhouse-model-runtime` §0 SOP; do not retry chat until engine is fully warm |

## Port allocation (T1 lane split)

| Port | Owner | Model |
|---|---|---|
| 8081 | T1 | Qwen3.5-4B |
| 8082 | T1 | smollm2-360m |
| 8084 | **T2 (this terminal)** | **North-Mini-Code-1.0** |
| 8086-8089, 8092+ | free | T2 reserve |

The 8/26 T2→T1 directive reserved 8084 for desktop-agent. North is now the in-house sovereign at 8084.

## PID-scoped kill (NOT `/IM llama-server.exe`)

```powershell
Get-Process llama-server | Where-Object { $_.MainWindowTitle -eq '' -and $_.Id -eq 17212 } | Stop-Process -Force
# Or by port:
$pid = (Get-NetTCPConnection -LocalPort 8084 -State Listen).OwningProcess
Stop-Process -Id $pid -Force
```

## Health check

```powershell
curl http://127.0.0.1:8084/v1/models
# Expect: HTTP 200, "n_params":"30484303872" (30B), "n_ctx":32768, "ftype":"Q2_K - Medium"
```

## Sanity test (also verifies interleaved thinking)

```powershell
$body = '{"model":"E:/aide-sovereign-workbench/models/aide-house/North-Mini-Code-1.0-UD-Q2_K_XL.gguf","messages":[{"role":"user","content":"Reply with exactly: OK"}],"max_tokens":256,"temperature":0.0}'
Invoke-WebRequest -Uri http://127.0.0.1:8084/v1/chat/completions -Method POST -ContentType "application/json" -Body $body -TimeoutSec 600
# Expect: text "OK", reasoning_content present, finish_reason "stop", dt ~100s
```

## Common mistakes observed in this session (DO NOT)

1. **`Invoke-WebRequest -TimeoutSec 90`** is too short for cold MoE. Use 600s (10 min).
2. **`max_tokens: 16`** is consumed entirely by the reasoning prefix. The model needs at least 200 tokens to finish a thinking turn.
3. **Spawn via `Start-Process`** with shell-level timeouts kills the engine mid-start. Use the proven AIDE manager path (`POST :4779/api/models/register` + `POST :4779/api/models/start`) which has the 8s early-exit guard + 1 retry.
4. **Defender real-time scan** on the 10.5GB GGUF will hold the file lock for ~30 min on first read. Wait it out or pre-add `E:\aide-sovereign-workbench\models` to Defender exclusions.
5. **Passing `temperature: 0.0`** is NOT recommended by the model card (it says `temperature: 1.0, top_p: 0.95`). The model works at 0.0 for deterministic probes but is trained for the 1.0 sampling regime.

## Skill category: engine-lifecycle
## Author: opencode (T2 session, 2026-08-30)
## Verified by: live HTTP probes (NOT smoke tests)
