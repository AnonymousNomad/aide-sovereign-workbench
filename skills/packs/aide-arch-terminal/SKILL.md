---
name: aide-arch-terminal
description: Phase 8 SOP for the AIDE offline-first IDE rebuild — the integrated terminal + task runner: xterm.js frontend over a daemon-hosted PTY (node-pty with ConPTY on Windows), typed task contract (npm scripts etc. run with streaming output + clean stop), process tree management, and the ANSI/unicode/quoting pitfalls. Use whenever wiring terminal UI, spawning shell sessions, running tasks with live output, or debugging "terminal shows nothing", "control chars garbage", or "task won't stop". Research-grounded (VS Code terminal engineering docs, node-pty docs, xterm.js docs, nodejs.org child_process).
---

# AIDE Architecture — Phase 8: Terminal + Tasks

## Doctrine

- **The daemon owns the PTY.** The browser renders xterm.js; every keystroke/resize round-trips to the daemon (WS event channel, Phase 4). The renderer NEVER spawns processes (renderer rule).
- **ConPTY on Windows.** node-pty with `useConPTY: true` (Windows 10+ native pseudoconsole) — the modern, correct terminal backend; winpty is the legacy fallback only.
- **One shell, many sessions**: a terminal panel with tabs; each session = one PTY (default shell: `pwsh` on this machine — PowerShell 7 is the user's shell; keep it configurable).
- **Tasks are typed contracts, not terminal typing.** Running `npm run check` from a button = spawn the command with streaming output into a terminal view + a stop button that tree-kills. No keyboard-macro hacks.
- Offline-first: the shell is local; no remote shells.
- Verify before claiming: real interactive shell (ls/echo/arrow keys), a long-running task (e.g. `npm run check`) with streaming + stop verified in the browser.

## What

Phase 8 delivers:

- **PTY service** (`node/src/services/pty.ts`): session registry (id, shell, cwd, status), spawn via node-pty (ConPTY), data pump (pty → WS event `term:data`, WS input → pty.write), resize handling, exit detection (session closed event), tree kill on stop/daemon shutdown (Phase 1 rule).
- **Terminal UI** (browser): xterm.js view with tab bar (new/close), fit addon (resize on container change), theme matching the IDE dark theme, copy/paste (browser clipboard — secure context required; note the http://127.0.0.1 caveat: clipboard API needs secure context, localhost counts as secure), Ctrl+C handling (pty handles it natively — do NOT intercept except for the explicit "stop task" button).
- **Task runner** (`node/src/services/tasks.ts`): `runTask { name, command, args, cwd }` → spawn WITHOUT pty (stdio pipes; streaming via WS `task:output`) OR with pty for interactive tasks; status events (`task:status` running/succeeded/failed/stopped, exit code); stop = graceful SIGTERM → 3s → tree kill (taskkill /T /F on Windows); output capped per event (Phase 4 rule: 256KB truncation with flag).
- **Contracts** (`common/contracts/terminal.ts` + `tasks.ts`): open/close/write/resize terminal; run/stop/status task. WS channels: `term:<id>:data`, `task:<id>:output`, `task:<id>:status`.
- **Integration**: the RUN view's model/training buttons and the Phase 10 training arena use the task runner; the terminal is the visible window into long jobs.

## How

### 1. node-pty on Windows (verified practice)

- Install node-pty; it ships prebuilt binaries for common Node versions (check `node-pty` release assets; if prebuild missing for the installed Node, it needs a native toolchain — avoid by pinning Node to a version with prebuilds).
- Spawn: `pty.spawn('pwsh', ['-NoLogo'], { name: 'xterm-256color', cols, rows, cwd, useConPTY: true, env: {...} })`. The `-NoLogo` avoids banner noise; `name: 'xterm-256color'` makes color apps work.
- ConPTY requires a console-aware host; node-pty handles it. If `useConPTY:true` throws (old Windows), fall back to `false` with a logged warning (winpty path) — Windows 10 22H2+ has ConPTY; this machine is modern.
- Data flow: `pty.onData(chunk => ws.send({ channel: 'term:<id>:data', data: chunk }))`; `pty.write(input)` from WS messages. NEVER buffer: xterm.js expects real-time bytes; backpressure = `ws.bufferedAmount` check + throttle.
- Resize: `pty.resize(cols, rows)` on `ResizeObserver`/fit addon events — debounced (e.g. 100ms), resize storms hang ConPTY.

### 2. PTY lifecycle + hygiene

- Session registry with IDs; close = user closes tab → daemon sends graceful shutdown to the shell (write `exit\r` or kill) → wait → tree kill → remove from registry.
- Daemon shutdown: tree-kill every PTY child (spawned shell has grandchildren — node-pty's kill kills the shell but NOT its children on Windows; the Phase 1 taskkill /T rule applies).
- CWD: default workspace root; a task can set cwd (containment-checked, Phase 1).
- Env: inherit daemon env + `TERM=xterm-256color`, `COLORTERM=truecolor`; never pass secrets.
- Exit detection: `pty.onExit` → session closed event → UI shows exit code + allows restart (keep the last 5000 lines of scrollback in the daemon so a closed session can be re-inspected; session restore keeps the tab with a "process exited" state).

### 3. Task runner (no PTY for non-interactive)

- `spawn(command, args, { shell:false, cwd, env })`, stdio pipes.
- Output: line-buffered chunks → WS `task:output` (with ANSI passthrough — tasks may colorize; xterm parses ANSI).
- Status: exit code 0 → succeeded; nonzero → failed (code in the event); killed by stop → stopped.
- Stop: SIGTERM → 3s grace → `taskkill /PID <pid> /T /F` (Windows tree kill). NEVER leave orphans.
- Concurrency: one task per id; start returns CONFLICT if the id exists (Phase 1 idempotence rule).
- Restart: re-run with the same command (new id).

### 4. Terminal UI (xterm.js)

- `new Terminal({ fontFamily: <bundled mono>, fontSize, theme: dark, scrollback: 5000 })` + FitAddon; open in the terminal container; `term.loadAddon(fit)` and `fit()` on container resize + on tab switch (Monaco view state restore rule from Phase 3 applies to terminal too: remount + refit + restore scrollback from the daemon session buffer on restore).
- Input: `term.onData(d => ws.send({ channel: 'term:<id>:input', data: d }))`; paste = browser clipboard read (async, permission) → send as input data.
- Alt-buffer apps (vim, htop) work via ConPTY automatically — do not fight it.
- Selection: xterm handles text selection natively; only add copy button if needed.

### 5. Tasks in the UI

- RUN view: "Run task" inputs (name, command) + a saved-task list (persisted in config, typed schema) — the verified training-arena pattern (job config JSON) generalizes here.
- Terminal tabs show task output inline (task started from a button opens/attaches a terminal tab showing that task's stream).

## Why (research grounding)

- VS Code terminal docs: terminal = xterm.js renderer + node-pty/ConPTY backend with a data pump; the renderer never touches the PTY. This is the proven architecture for browser-rendered terminals.
- node-pty docs: ConPTY is the Windows 10+ backend; useConPTY:true is the documented correct mode; winpty is legacy.
- nodejs.org: spawn with shell:false for tasks; tree kill required on Windows (taskkill /T) — Phase 1 doctrine applies.
- Verified project lessons: the training arena already streams logs + stops cleanly (graceful-then-kill-tree, checkpoint-first); the task runner generalizes that verified pattern.

## Dependencies

node-pty (native, prebuilt for the pinned Node), xterm.js + @xterm/addon-fit (local npm, no CDN — xterm CSS must be bundled), Phase 1 process manager, Phase 2 api client, Phase 4 WS channels, Phase 6 (model start/stop share the task/PTY infrastructure for llama servers? NO — model servers keep spawn, not PTY: no terminal semantics needed. Keep them separate.)

## Known issues / bugs (watch these)

- **ConPTY resize storms**: resize floods hang the shell — debounce + only send when cols/rows actually changed.
- **ANSI garbage**: apps emitting old-school control sequences — xterm's parser handles most; if text looks broken, check `name: 'xterm-256color'` was set (TERM=dumb breaks colors).
- **Backpressure**: fast output (training logs!) into a slow UI — WS buffer bloat; cap per-event (256KB truncate flag, Phase 4) + allow the UI to pause/resume the stream.
- **Clipboard permission**: navigator.clipboard on http://127.0.0.1 — localhost IS a secure context, works; on a packaged WebView (Phase 11) confirm the scheme is treated secure (custom:// may not be — plan for a fallback execCommand path).
- **node-pty prebuilds**: Node upgrade without matching prebuild = native compile failure (needs VS Build Tools). Pin Node; upgrade deliberately.
- **Ctrl+C vs stop button**: Ctrl+C goes to the PTY (correct for interactive). The STOP TASK button sends SIGTERM+taskkill — distinct from Ctrl+C; label it clearly or users will wonder why Ctrl+C didn't kill a task.
- **Shell quoting in tasks**: commands are arrays, never strings (spaces in paths); `npm run check` = `['npm', 'run', 'check']` — on Windows npm is npm.cmd, spawn with shell:false needs the .cmd resolved: use `execFile` with `{ shell: true }` ONLY for npm/npx (documented npm-on-Windows quirk: .cmd requires a shell or the full path to npm.cmd) — resolve via `where npm` or spawn 'cmd.exe /c npm.cmd ...' — decide once, document in the code, test it.
- **Scrollback loss**: browser refresh loses terminal state unless the daemon buffers — daemon keeps per-session scrollback (cap 5000 lines) for restore.
- **Encoding**: default UTF-8; chcp issues on Windows console apps — set `cwd` + env `CHCP` isn't a thing; prefer PowerShell (pwsh is UTF-8 by default; cmd.exe legacy codepages garble — default shell is pwsh for this reason).

## Phase 8 audit checklist (applied to the existing terminal work)

1. PTY service with ConPTY, session registry, data pump, resize, exit handling, tree-kill on close AND daemon shutdown.
2. xterm.js UI: tabs, fit, dark theme, scrollback restore; interactive shell verified (typing, arrow keys, Ctrl+C, a vim/htop alt-buffer app).
3. Task runner: run/stream/stop/restart with exit codes; npm task verified on Windows (the .cmd quirk handled and tested); stop leaves no orphan processes (PID scan).
4. Contracts terminal.ts/tasks.ts + WS channels in common/; fixtures both sides.
5. Offline audit: no CDN, no remote shells; xterm css bundled.
6. `npm run check` green.