---
name: aide-windows-dev-reality
description: Verified Windows-specific traps for developing/testing aide-sovereign-workbench on THIS dev box (win32, node 26, cmd.exe npm) — bash-only globs in scripts, libuv UV_HANDLE_CLOSING native asserts, tree-kill law for engine processes, ephemeral ports, node --test flags that matter. Use when local runs fail but CI ubuntu passes, when tests hang or crash natively on Windows, or before writing any script/glob that must run on both platforms.
---

# Windows Dev Reality (aide-sovereign-workbench on win32)

CI runs ubuntu; the dev box is Windows. Every "works in CI, fails locally" class
lives here. Verified 2026-08-25 night shift unless noted.

## The Traps

| Trap | Symptom | Law |
|---|---|---|
| Bash-only globs in npm scripts | `check:arch` silently hangs/fails locally forever; works on CI | cmd.exe never expands `tests/arch/*.test.ts`. Expand file lists in Node (`readdirSync`) — see `scripts/run-arch.mjs` |
| node --test waits on leaked handles | All tests pass, runner never exits | Add `--test-force-exit` (node 22+). Results still print and exit code is honest |
| child.kill() cannot reap engines | llama-server survives stop(); test runner hangs on open handles | On win32: SIGTERM grace → `taskkill /PID <pid> /F /T` (tree-kill). Ported into model-runtime.ts stop(); legacy model-manager has same proven fix |
| libuv native assert under parallel tests | `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c` kills random test files nondeterministically | Node-core bug territory. Mitigate: `--test-concurrency=1` on win32 (run-arch.mjs does this); CI keeps 3 |
| Fixed test ports collide with prod stack | Suite exits 1 ONLY while schtasks stack is running | Tests bind port 0 / probe freePort() via net listen(0). editor-smoke.mjs is the reference |
| Heavy spawn tests + HDD contention | Tests pass solo, time out at 90s in full suite | Per-test ceiling 240s in run-arch.mjs; real-engine suites are inherently minutes-long on this HDD |
| Manifest ports meet operator engines | NOT_READY tests return 200 — adoption bridge adopts the foreign server (correct behavior!) | Environment-sensitive tests must probe-and-skip with honest reason (model-routes.test.ts manifestPortOccupied) |
| CRLF warnings on commit | Noise, not errors | Ignore `CRLF will be replaced by LF` warnings |

## Verified Machine Facts

- npm debug log shows the ACTUAL cwd (`verbose cwd E:\`) — read it before blaming
  config files when a tool "cannot find" something.
- `py -3.10 -E -c "import llama_cpp"` spawned from node HANGS on this machine
  (documented since W2). Binary llama-server is the only serving path.
- Operator-owned processes: kira llama-server on 8087, python training jobs.
  NEVER taskkill python.exe or foreign llama-servers (hard-rules).
- Production stack under schtasks 'aide-stack': 4173 UI, 4777 facade,
  4778 arch-ts, 4779 legacy.

## Local Verification Order

```
npm install            # after any restart; verify cwd first!
npx eslint .           # 0 errors gate
npm test               # unit+smoke+contracts chain (~5 min)
npm run check          # syntax + tsc x2 + eslint + arch suite via run-arch.mjs
npm run veritas        # full gates (compile=check, tests=npm test) — allow 25 min
```

## Integration

Feeds aide-debugging-discipline (trap table), aide-ci-diagnostics (ubuntu-side),
process-hygiene-sop (kill discipline). If a NEW Windows-only failure class
appears, reproduce solo → bisect → encode here.
