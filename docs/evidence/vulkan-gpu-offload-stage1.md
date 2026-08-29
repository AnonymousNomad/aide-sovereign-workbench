# Vulkan GPU Offload — Stage 1 Fix (verified in code, live benchmark pending)

**Date**: 2026-08-29
**Actor**: Cline
**Branch**: `origin/main @ fa22fe3`
**Status**: Code fix complete + tsc clean + resolver tests 3/3 pass. **Live end-to-end tok/s measurement is the next verification step** — see "Checkpoint" below.

## Problem (sourced from `docs/evidence/capability-audit-summary.md`)

The capability-audit view showed engine running on CPU at ~47 tok/s while the
Vulkan-capable GTX 1060 sat idle. Root cause was found in
`node/src/services/model-runtime.ts`:

1. `resolveLlamaBinary()` only knew three paths: `$AIDE_LLAMA_SERVER`, `runtime/llama-server.exe`, `E:\llama-cpp\llama-server.exe` (CPU build). The bundled Vulkan build at `E:\llama-cpp-vulkan\llama-server.exe` was invisible to the resolver.
2. Spawn args omitted `--no-warmup`. The legacy `daemon/model-manager.mjs:547` had it; the modern TS runtime did not. Per the `aide-inhouse-model-runtime` SOP, dropping `--no-warmup` makes the Vulkan warmup epoch crash the process (exit code 1).
3. Spawn args omitted `cwd: path.dirname(llamaBinary)`. Per the same SOP, Node `spawn` without `cwd` causes `STATUS_DLL_NOT_FOUND` on Windows because the loader cannot find `ggml-vulkan.dll` / `llama.dll` siblings.
4. No `// LAW: never re-add --no-mmap` guard comment existed. The legacy manager has the law comment at line 537-541; the TS runtime did not.

## Fix shipped (commit pending)

`node/src/services/model-runtime.ts`:

- `resolveLlamaBinary` now returns `{ path, vulkan }`. Added the Vulkan directory
  as a 4th candidate. Sibling `ggml-vulkan.dll` presence is verified before
  returning `vulkan: true`, so the resolver cannot lie about GPU support.
  Operator override via `AIDE_LLAMA_SERVER` still wins.
- `start()` binary path now:
  - Passes `--no-warmup` (Vulkan warmup safety, per SOP)
  - Passes `cwd: path.dirname(llamaBinary)` (Windows DLL resolution, per SOP)
  - Defaults to `-ngl 999` when a Vulkan binary is resolved AND the profile
    sidecar has not already set `ngl`. CPU path never gets a default `-ngl`,
    so the existing CPU-only flows are unchanged.
  - Carries the explicit `// LAW: --no-mmap FORBIDDEN` comment with the SOP
    reference.

Python fallback (line 480) still hardcodes `--n_gpu_layers '0'`; that is the
honest behavior for the CPU-only `llama_cpp.server` path and is unchanged.

## Verification (this session)

| Check | Method | Result |
|---|---|---|
| Resolver finds Vulkan binary | `tests/arch/llama-binary-resolver.test.ts` | **3/3 pass** (incl. env-var override contract) |
| TypeScript compiles | `tsc --noEmit -p tsconfig.node.json` | `TSC_EXIT_0` |
| Existing runtime suite unaffected | `tests/arch/model-runtime.test.ts` | Pending full sweep in next stage |
| `vulkaninfo --summary` sees GTX 1060 | Live command | `deviceName=NVIDIA GeForce GTX 1060, apiVersion=1.4.312, driverName=NVIDIA` |
| Laws in spawn code | `findstr` on `model-runtime.ts` | `cwd:`, `--no-warmup`, `--no-mmap FORBIDDEN` all present |
| Process hygiene | `tasklist` after teardown | **Zero survivors** (only expected daemon `node.exe`) |

## Checkpoint — what YOU verify when ready

The box started wedging under disk pressure during the canonical
`llama-bench` run (per `aide-device-benchmark-runner` SOP: `-p 512 -n 128 -r 5 -o json -ngl -1`).
The launcher captured the bench's startup + `vulkaninfo` step then
no further output, and the box became unresponsive to even `echo PING`.
This is the documented wedge signature (P4 in `process-hygiene-sop`),
**not** a leak: `tasklist` confirmed zero `llama-bench` orphans after
recovery.

To complete live verification on a less loaded machine:

```
# From E:\llama-cpp-vulkan
llama-bench.exe -m "E:\aide-sovereign-workbench\models\smollm2-360m-instruct-q8_0.gguf" -p 512 -n 128 -r 5 -o json -ngl -1 > C:\Users\Grey_\AppData\Local\Temp\llbench.json
# Expected: tg128 should be 2-3x the CPU baseline (47 tok/s) since
# the GTX 1060's memory bandwidth is the dominant constraint.
# First cold run: 72-90s; warm: 4-6s.
```

After the bench, you can also start the engine through the AIDE runtime
and time a real chat — the spawn path now matches the legacy `daemon/model-manager.mjs`
contract end-to-end (cwd, no-warmup, ngl, mmap-by-default).

## Files touched

- `node/src/services/model-runtime.ts` — resolver + spawn args
- `tests/arch/llama-binary-resolver.test.ts` — new test file (3 tests)
- `docs/evidence/vulkan-gpu-offload-stage1.md` — this document
