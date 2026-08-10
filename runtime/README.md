# AIDE Local Runtime

AIDE uses local OpenAI-compatible adapters so model runtimes can be replaced without changing the IDE.

## AIDE Model Pack

- **SmolLM2 360M Instruct Q8_0:** fast chat and planning, about 386 MB.
- **Qwen2.5-Coder 0.5B Instruct Q4_K_M:** fast autocomplete, about 491 MB.
- **Qwen2.5-Coder 1.5B Instruct Q4_K_M:** primary builder, about 1.12 GB.

All three official repositories declare Apache-2.0. The default installer should offer them as optional model packs so users on small devices can choose one. AIDE does not include unfinished user-trained Liquid checkpoints in this package.

Run both sequentially on constrained hardware. Do not load two large copies unless memory measurements prove it is safe.

## Qwen Coding Runtime

The official Qwen GGUF repository is Apache-2.0 and provides a Q4_K_M file of approximately 1.12 GB. Use a local llama.cpp-compatible server and bind it to loopback:

```bash
llama-server -hf Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M \
  --host 127.0.0.1 --port 8081 --ctx-size 32768
```

For a fully offline run, download the exact GGUF first, verify its SHA-256, then replace `-hf ...` with the local file path.

The current ARM smoke-tested configuration uses the local 1.5B file at `/root/models/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf`, a 4096-token context, four CPU threads, and one parallel slot. It served `/v1/models` and generated a TypeScript function successfully.

## Liquid Thinking Runtime

Liquid model integration is intentionally excluded from this public pack until the owner's checkpoint is finished and released.

Do not substitute the unfinished TinyLiquid training artifact for LFM2.5. It is not part of the production package.

## AIDE UI

Serve the AIDE root over a local static server so browser `fetch()` can load the manifest:

```bash
python -m http.server 4173 --bind 127.0.0.1 --directory /root
```

Open `http://127.0.0.1:4173/`. **TEST LOCAL RUNTIME** checks the selected adapter. **START BOUNDED REVIEW** runs Liquid research, Qwen build, and Liquid verification sequentially. It never applies a patch automatically.
