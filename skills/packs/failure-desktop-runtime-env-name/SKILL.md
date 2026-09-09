---
name: failure-desktop-runtime-env-name
description: Diagnose desktop staging failures caused by confusing the engine-source variable with model-runtime variables, or by assuming an AIDE_LLAMA_SERVER_BINARY override exists. Use whenever desktop/prepare.mjs skips engine staging, when a staged stack reports a missing llama-server runtime, or when a skill claims AIDE_REQUIRE_MODEL_RUNTIME or AIDE_LLAMA_SERVER_BINARY drive staging.
---

# Desktop Runtime Environment Names (verified against desktop/prepare.mjs, 2026-09-10)

## Contract (READ desktop/prepare.mjs FIRST — do not trust skill memory)

- `AIDE_ENGINE_SOURCE` (default `E:\llama-cpp`) is the ONLY engine input to
  `desktop/prepare.mjs` (line 31). Engine files are staged via an explicit
  allowlist (line 39): `llama-server.exe` + `llama-server-impl.dll`, `llama.dll`,
  `llama-common.dll`, `ggml-base.dll`, `ggml.dll`, `ggml-rpc.dll`,
  `ggml-rpc-server.exe`, `libomp140.x86_64.dll`, `mtmd.dll`, plus `ggml-cpu-*.dll`.
- `AIDE_LLAMA_SERVER_BINARY` and `AIDE_REQUIRE_MODEL_RUNTIME` DO NOT EXIST in
  desktop/prepare.mjs. Historical skills that name them are stale — correct the
  skill, do not search for the variable.
- `AIDE_LLAMA_SERVER` is a serving/runtime setting, unrelated to staging.
- The `E:\llama-cpp\llama-server.exe` is a 9216-byte THIN LAUNCHER; the payload
  lives in the sibling DLLs. Staging only the exe silently breaks model spawns.

## Procedure

1. Stop at "engine source absent - skipping engine staging": the env var is
   `AIDE_ENGINE_SOURCE=<llama.cpp build dir>`. Verify the dir exists and
   contains `llama-server.exe` AND its DLLs.
2. After prepare, verify the staged copy: `desktop/resources/runtime/` must
   contain `llama-server.exe` plus the allowlisted DLLs and `node.exe`.
3. Run `desktop/verify-prepare.mjs` and `scripts/desktop-battery.mjs` (expect
   12/12) to prove a model-capable staged stack.
4. Do not weaken strict mode, do not substitute the serving variable, and do
   not copy `AIDE_LLAMA_SERVER_BINARY` into new scripts.
