---
name: failure-desktop-runtime-env-name
description: Diagnose strict desktop staging failures caused by confusing the model-server runtime variable with the packaging binary variable. Use whenever desktop/prepare.mjs rejects a required llama-server runtime.
---

# Desktop Runtime Environment Names

## Contract

- `AIDE_REQUIRE_MODEL_RUNTIME=1` enables the fail-closed staging requirement.
- `AIDE_LLAMA_SERVER_BINARY` supplies the verified executable to
  `desktop/prepare.mjs`.
- `AIDE_LLAMA_SERVER` is a separate serving/runtime setting and does not supply
  the desktop staging input.

## Procedure

1. Stop at the staging failure and read `desktop/prepare.mjs` instead of
   guessing variable names.
2. Verify the binary path exists and is the intended local executable.
3. Run strict preparation with `AIDE_REQUIRE_MODEL_RUNTIME=1` and
   `AIDE_LLAMA_SERVER_BINARY=<verified-path>`.
4. Run `desktop/verify-prepare.mjs` and record whether the runtime is staged.
5. Do not weaken strict mode or silently substitute the serving variable.
