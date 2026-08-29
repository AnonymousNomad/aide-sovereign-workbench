# aide-aide-stack-launch-and-recover

What to do when the AIDE stack is dead, half-alive, or the bot is
connected but `running: false`.

## When to load this skill

Load when ANY of these are true:
- `curl /api/health` on 4777, 4778, or 4779 times out or returns 5xx
- `tasklist` shows fewer than 3 `node.exe` AIDE processes (cline + arch + legacy + facade)
- `/api/telegram/status` returns `connected: true, running: false` (the bot config is on disk but the polling loop never started)
- `arch-err.log` shows `EADDRINUSE: 127.0.0.1:4778` (stale process holds the port)
- The `taskkill /F /PID N` command reports `SUCCESS` but `netstat` still shows PID N listening

## The three services and their ports (do not forget any of them)

| Service | Port | Command | Env |
| --- | --- | --- | --- |
| Arch (TypeScript) | 4778 | `node --experimental-strip-types node/src/server.ts` | `AIDE_ARCH_PORT=4778` |
| Legacy (daemon) | 4779 | `node daemon/server.mjs` | `AIDE_DAEMON_PORT=4779, AIDE_LEGACY_PORT=4779` |
| Facade (proxy) | 4777 | `node scripts/facade.mjs` | `AIDE_FACADE_PORT=4777` |
| Cipher (llama-server) | 8091 | `E:\llama-cpp-vulkan\llama-server.exe -m E:\aide-sovereign-workbench\models\aide-house\base.q8_0.gguf --host 127.0.0.1 --port 8091 -ngl 999 --device Vulkan0` | none |

All three AIDE processes share `AIDE_WORKSPACE=E:\aide-sovereign-workbench`.

## The launch script (use this, not raw spawn)

`E:\aide-sovereign-workbench\logs\launch-aide.mjs` is the canonical
launcher. It spawns arch/legacy/facade as detached children, each with
explicit env, each with stdout/stderr redirected to `logs/<label>-out.log`
and `logs/<label>-err.log`.

```powershell
cd E:\aide-sovereign-workbench
& 'E:\nodejs\node-v26.4.0-win-x64\node.exe' 'E:\aide-sovereign-workbench\logs\launch-aide.mjs'
```

After launch: `ping -n 8 127.0.0.1 >nul` then `netstat -ano | findstr LISTENING | findstr 477`.
Expect three rows: 4777, 4778, 4779.


## Threat matrix

| Symptom | Root cause | What to do | What NOT to do |
| --- | --- | --- | --- |
| `connected: true, running: false` in /api/telegram/status | Arch was restarted AFTER the bot was connected. The connect() call's `ensurePolling()` ran on the old arch's in-memory `running` flag, not the new arch's. The DPAPI-protected token in `.aide/telegram/config.json` is correct, but no polling loop is alive to use it. | `curl -X POST http://127.0.0.1:4778/api/telegram/start` to call the new `startPolling()` route. The route is at `node/src/routes/telegram.ts:88-96` and it just calls `service.startPolling()` which guards on `if (running) return`. | Re-call `/api/telegram/connect`. That creates a new bot identity and may fail on Telegram's rate limit. `connect` is for first-time setup only. |
| `EADDRINUSE 127.0.0.1:4778` on arch start | A previous arch is still holding the port. The previous PID is the only thing on that port (check `netstat -ano \| findstr 4778`). | `taskkill /F /PID <pid>` then `ping -n 5 127.0.0.1 >nul` to let the TIME_WAIT clear, then re-launch. | `taskkill /IM node.exe`. This kills Cline's runtime, the harness, and every other Node process. Only kill the SPECIFIC PID. |
| `taskkill /F /PID N` reports `SUCCESS` but `netstat` shows N still listening | Windows console privilege mismatch: `taskkill` from a non-elevated shell can mark a process for kill but the kernel can refuse silently. Or the process is in a different session. | Use `taskkill /F /PID N /T` (include children) and retry. If still stuck, use PowerShell: `Stop-Process -Id N -Force` from an elevated prompt. | Do not loop taskkill blindly. The wait + retry is important. The kernel takes a few seconds to release the port. |
| Arch responds to /api/health but /api/telegram/status times out | The telegram poll loop is starving the request handler. `telegram.mjs` uses a 25s `timeout` parameter on `getUpdates` so each poll cycle holds the bot's AbortController for up to 35s. The fetch() and JSON parse run on the same event loop. | This is the design, not a bug. The long-poll is intentional. If status times out, the bot IS polling. The fix is in the caller's `curl -m`. Use `curl -m 40` to wait through one full poll cycle. | Don't add a separate process for the poll loop. That would be a v2 architecture change. The `ensurePolling()` correctly runs in the same Node process but uses fetch with AbortController so it yields. |
| `Cannot set property message of which has only a getter` in arch-err.log | Node 22+ forbids assigning to `Error.message` when it is a getter-only property (DOMException, some built-in errors). The telegram bridge used to do `error.message = stripToken(error.message)` in the catch block. | Already fixed in `node/src/services/telegram.mjs:55-65`. The catch now wraps the original error in a new sanitized Error instead of mutating. If you see this error, your arch is running an OLD version of telegram.mjs. Restart the arch to pick up the fix. | Don't add a try/catch around the wrapping. The original error's `stack` is preserved via `wrapped.originalStack`. |
| `telegram getUpdates failed: 400` in arch-err.log | The Telegram API rejected the long-poll. Common causes: bad token (DPAPI failed to unwrap), malformed JSON, rate limit. The bridge marks the error and backs off. | `curl http://127.0.0.1:4778/api/telegram/status` to see the current `last_poll_at` and `poll_cycles`. If `last_poll_at` is recent, the next poll will recover. | Don't reconnect. The token in config is correct. The 400 is from the Telegram side, not ours. |

## Pitfalls (each cost real time during past incidents)

1. **Never `taskkill /IM node.exe /F`**. That kills Cline's runtime, the
   agent, the harness, and every other Node process. Always use
   `taskkill /F /PID <specific>` and verify with `tasklist | findstr <pid>`.
2. **`arch-err.log` and `arch-out.log` are appended, not truncated**.
   When the arch restarts, the new error log is appended to the OLD log.
   If you `del` them, the running arch keeps its file handle and may
   not reopen it. To get a clean read, instead pipe new output:
   `tail -n 50` or `Get-Content -Tail 30`.
3. **`running: false` in /api/telegram/status does NOT mean
   disconnected**. It means the in-memory `running` flag is false.
   The token is still on disk. Call `/api/telegram/start` to flip
   the flag and start the poll loop.
4. **`launch-aide.mjs` uses `child.unref()`**. The detached children
   survive the parent exiting. If you re-run the launcher while a
   previous stack is alive, you'll get EADDRINUSE on every port.
   Always `taskkill` the old PIDs first.
5. **The arch listens on 4778 for HTTP AND WebSocket** (`Server.emit`
   is called for both). Don't try to "split" them. The WebSocketServer
   shares the same port via the upgrade mechanism.
6. **PowerShell `Start-Process -RedirectStandardError` with an
   existing path OVERWRITES the file**. The old arch's error log is
   lost on the first error of the new arch. Use `Get-Content -Tail`
   to see the OLD log; the new arch writes from byte 0 of the new
   path.
7. **`curl -m 5` is too short for `/api/telegram/status` when the
   poll loop is mid-cycle**. The 25s long-poll can hold the response
   handler. Use `curl -m 40` to wait through one full cycle.

## Diagnostic drill (run in this order)

```powershell
# 1. Is anything listening?
netstat -ano | findstr LISTENING | findstr 477

# 2. Which PIDs are AIDE?
tasklist | findstr node.exe

# 3. Is the telegram bot connected on disk?
Get-Content E:\aide-sovereign-workbench\.aide\telegram\config.json

# 4. Is the new arch running the FIXED telegram.mjs?
Get-Content E:\aide-sovereign-workbench\logs\arch-err.log -Tail 20

# 5. Is polling active?
curl -m 40 http://127.0.0.1:4778/api/telegram/status

# 6. If status says running: false, flip it on:
curl -X POST http://127.0.0.1:4778/api/telegram/start

# 7. If a port is held by a stale process:
netstat -ano | findstr LISTENING | findstr 4778
taskkill /F /PID <pid> /T
ping -n 5 127.0.0.1 >nul
& 'E:\nodejs\node-v26.4.0-win-x64\node.exe' 'E:\aide-sovereign-workbench\logs\launch-aide.mjs'
```

## What changed in this skill

- **2026-08-29**: Initial write. Captures: (a) the 3-service + 1-engine
  architecture, (b) the `connected: true, running: false` failure mode
  from the new arch being restarted with a saved config, (c) the
  `Cannot set property message` Node 22+ regression and its fix in
  `telegram.mjs`, (d) the 7-row threat matrix above, (e) the 7 pitfalls.

## Related skills

- `aide-engine-lifecycle-doctrine` — covers model spawn/respawn on
  ports 8081, 8090, 8091, including the 2.5 GB free RAM floor and the
  cipher-only allowlist.
- `aide-telegram-bridge-pattern` — the OpenClaw-derived doctrine:
  isolated ingress worker, durable spool, liveness from getUpdates
  cycles only, token never logged.
- `aide-inhouse-only-policy-hook` — the cipher-only gate for
  model-driven desktop proposals. The telegram bot is the operator's
  remote control surface, but the agent still routes through the
  policy hook before any desktop.act() call.

| Cipher 8091 not listening | No engine is running. The arch can still serve chat, but `/api/chat` will return 409 NOT_READY. | Spawn cipher: `& 'E:\llama-cpp-vulkan\llama-server.exe' -m 'E:\aide-sovereign-workbench\models\aide-house\base.q8_0.gguf' --host 127.0.0.1 --port 8091 -ngl 999 --device Vulkan0`. Wait ~5-10s for the model to load. | Don't try to start cipher from inside the arch. It's a separate process with a different binary and a 4GB model load. |
