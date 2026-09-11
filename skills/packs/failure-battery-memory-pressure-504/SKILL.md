---
name: failure-battery-memory-pressure-504
description: Diagnose 504 CHILD_FAILED/TIMEOUT failures inside the arch battery (tests/arch/*) on the 16GB dev box without touching code. Use whenever a full run-arch.mjs battery reports 504s on execFile-backed routes (git checkout/push, terminal, patch) AFTER model-ingest tests, while the same tests pass in isolation under 10s. Root cause is memory-pressure process-spawn stalls, NOT timeouts or git.
---

# Battery Memory-Pressure 504 — the wedge that isn't a timeout

## Symptom

A full `node scripts/run-arch.mjs` battery on this 16GB box returns:

```
✖ checkout switches branches and refuses a dirty tree   (20149ms)  504 !== 200
✖ push uploads the current branch ...                   (42910ms)  504 !== 200
```

Durations hug the route timeouts EXACTLY (checkout 20s, push 30s [`node/src/services/git-service.mjs:205/209`]) — but the same tests run alone complete in **0.6s / 2.4s**.

## Root cause (verified 2026-09-11)

The arch battery runs test files sequentially. The **model-ingest tests load real multi-GB GGUF files** into a 16GB box. After they finish, the OS is under memory pressure / thrashing; **process creation (`execFile` spawn of git.exe) stalls for 20–40s**, blowing the GitService execFile timeouts → route maps to `TIMEOUT`/`CHILD_FAILED` → HTTP 504 (`node/src/server.ts:170-172`).

- git itself is NOT slow: per-step probe on this box = init 0.11s / commit 0.35s / checkout 0.06s / push 0.07s.
- This is the P7 memory-pressure wedge (see `process-hygiene-sop`): spawn stalls, not IPC bugs.

## Procedure (exactly, in order)

1. **STOP** — do not edit timeouts or git code on the first 504 sighting.
2. **Confirm the memory-pressure fingerprint**: the failing test's elapsed time ≈ the route timeout constant (20s checkout / 30s push), and the battery segment before it contains model-ingest tests (`ingest registers a real GGUF...`).
3. **Prove code-health in isolation** (the authoritative gate):
   ```
   node --test tests/arch/git-routes.test.ts
   ```
   Green in <10s ⇒ the code is fine; the failure was spawn-stall under pressure.
4. **Root-cause cross-check** (only if isolation is also red): time raw git in a throwaway repo:
   - measure each step (`git init`, `commit`, `checkout`, `push`) with per-step timing → expect ≤0.5s each.
   - `git --version`, `git config --global --list` to exclude credential/hook/fsmonitor hangs.
5. **Document**: journal the finding; the full-battery 2-fail result is an environment artifact unless isolation fails.

## What NOT to do (each has already cost a debug cycle)

- Do NOT raise `GitService.run()` timeouts as the first fix — git is fast; the stall is memory-pressure spawn. Raising timeouts only hides symptoms and slows real failures in production.
- Do NOT conclude "git is broken on this box" from a battery red bar.
- Do NOT re-run the full battery immediately for confirmation — it takes ~24 min and re-triggers the same wedge; re-run the isolated file instead.
- Do NOT run heavy work (battery, model tests) concurrently with a full battery — it widens the wedge.

## Prevention (before a full battery)

- Free memory first: no parallel browsers/worktrees with heavy render, no running model servers (`process-hygiene-sop` P7: ONE MODEL AT A TIME).
- Prefer `scripts/run-bounded-arch.mjs` (CI-bound suite wrapper) for quick local signal; use the full battery only when the bounded suite is green.
- If a later battery still 504s on an execFile route after ingest tests, rerun that one file isolated and attach BOTH results to the report (battery-red + isolated-green = wedge verdict).

## Verification battery

- [ ] `node --test tests/arch/git-routes.test.ts` → 11/11 pass
- [ ] Per-step git probe timings recorded (all steps ≤ 1s)
- [ ] Report states: "isolated green / battery 504 = memory-pressure wedge, not code"
- [ ] No changes made to `git-service.mjs` timeouts unless isolation was also red