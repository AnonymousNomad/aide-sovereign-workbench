---
name: aide-pre-push-gate
description: The versioned root-level git pre-push gate that enforces AIDE's full verification battery before a feature push. Because `git config core.hooksPath` = repo root, a tracked `pre-push` file at the root is picked up automatically by every clone and push. Set AIDE_FULL_BATTERY=1 to run all arch tests before push (Windows-safe: no --test-force-exit locally, since that flag native-asserts on win32; CI/ubuntu uses scripts/run-arch.mjs). Without the env var the gate stays lightweight (staged .mjs syntax + secret scan parity with pre-commit). Use whenever anyone adds a gate rule, moves the hook, pushes a feature/main slice that must be battery-verified, or CI/push behavior around verification changes.
---

# AIDE Versioned Pre-Push Gate — Verified Recipe

## Status: VERIFIED (2026-09-08)

- Root-level `pre-push` file at the repo root, versioned in git, auto-picked-up by git because `core.hooksPath` = repo root.
- Verified in REAL execution: `git push <bare> main` ran the hook (packed multi-line echo observable), passed, and pushed. Blocking branch proven: a nonzero arch-battery exit -> `error: failed to push some refs`, exit 1.
- Full arch battery: **346/346 pass, exit 0** (Windows-safe invocation of the same command the gate runs).

## Why a versioned hook (not .git/hooks)

`git config core.hooksPath` is `E:\aide-sovern-workbench` (the repo root) on this machine — so git looks for hooks AT THE ROOT FIRST, falling back to `.git/hooks` when a root-level file is absent. Putting `pre-push` under the root means:

- It is tracked -> every clone/push, every developer, enforces the same gate.
- It is not lost when `.git` is recreated.
- The existing `.git/hooks/pre-commit` and commit-msg are untracked local hooks — do NOT copy them to root; keep them local.

## Behavior matrix

| AIDE_FULL_BATTERY | What the gate does |
|---|---|
| `1` | Full arch battery (all `tests/arch/*.test.ts`). Windows: runs without `--test-force-exit` (native abort trap). Non-Windows: `node scripts/run-arch.mjs`. Fails -> push blocked (exit 1). |
| unset / anything else | Lightweight: `node --check` on staged `.mjs` (same syntax check as pre-commit). Always runs, independent of the battery branch. |

## Gate file layout (keep in sync)

```sh
#!/bin/sh
GIT_ROOT=$(git rev-parse --show-toplevel)
# 1. lightweight check: node --check on staged .mjs (always)
# 2. if AIDE_FULL_BATTERY = 1:
#      cd "$GIT_ROOT"
#      case "$(uname -s)" in
#        MINGW*|MSYS*|CYGWIN*)  # Windows -> battery WITHOUT --test-force-exit
#          node --experimental-strip-types --no-warnings \
#            --import ./scripts/http-close-shim.mjs \
#            --test --test-concurrency=1 --test-timeout=240000 \
#            $(find tests/arch -name '*.test.ts' | tr '\n' ' ')
#          ;;
#        *) node scripts/run-arch.mjs ;;
#      esac
#      FAILED -> echo + EXIT=1
# 3. EXIT nonzero -> "checks failed. Fix errors above and try again." + exit 1
```

Rules:
- Always `cd "$GIT_ROOT"` before the battery (relative `find`/node args need the repo as cwd).
- The `.mjs` lightweight pass runs regardless of battery branch — orthogonal gates.
- Keep the echo contract stable (CI/log greps may rely on `pre-push:` prefixes).
- On Windows the hook's `grep/tr/find` resolve because git puts Git for Windows `usr/bin` on PATH when it spawns hooks. Testing the hook directly from PowerShell requires prepending `C:\Program Files\Git\usr\bin` to PATH before running `sh ./pre-push`.

## Verification procedure (reproduce both branches)

1. Lightweight + pickup (fast):
   ```pwsh
   git init --bare E:\pip_temp\opencode\pushgate-test.git
   git push E:\pip_temp\opencode\pushgate-test.git main   # observe "pre-push: checks passed"
   git --git-dir=E:\pip_temp\opencode\pushgate-test.git rev-parse --verify main  # == local HEAD
   ```
2. Blocking branch (battery forced to fail) — mutate ONLY the Windows branch's first node line to `node -e "process.exit(9)" ...`, push, expect exit 1 + "failed to push some refs", then restore. Never run the real 346/346 battery to prove blocking.
3. Full battery (the gate's actual command) — see aide-closed-loop-wiring.

Cleanup after verification: delete the bare repo + any out.log/backup. Set `AIDE_FULL_BATTERY=''` (not just removed) in the test shell or stale env leaks into later pushes.

## Design intent

Ordinary pushes stay fast (no battery). Feature/UI pushes opt into full verification via `AIDE_FULL_BATTERY=1`. The gate never silently weakens CI — it defaults to no-op heavy work and enforces hard when asked. The battery's canonical gate remains CI (run-arch.mjs uses `--test-force-exit`, which is correct on ubuntu and native-crashes on win32 — do NOT modify run-arch.mjs for Windows).