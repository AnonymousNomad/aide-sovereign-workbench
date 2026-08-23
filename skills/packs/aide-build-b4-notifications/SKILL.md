# B4 — Notification Harness (OS toasts + in-app center + task hooks)

Phase skill for AIDE BUILD-series B4. Master router: aide-master-roadmap. Research base: VS Code notification API patterns, ntfy.sh semantics, OSC 9 / 777 / 99 terminal sequences, Claude Code hook model (PreToolUse/PostToolUse/Notification/Stop events with configurable commands).

## What & Why

Long tasks (builds, training jobs, agent runs) need to tell the human "done/failed" WITHOUT the user staring at the terminal. Users will compare against VS Code/Cline where task completion is visible. B4 = one harness, three sinks:

1. **In-app center**: stacked toasts (bottom-right), severity levels, actions ("Show output", "Reveal problem"), persistent list.
2. **OS native toast**: Windows toast via PowerShell `New-BurntToastNotification`-free approach — use `Windows.UI.Notifications` through a tiny bundled helper OR fallback `[System.Windows.Forms]` balloon; MUST work offline, no deps. Gate behind user setting `notifications.os.enabled` (default ON for long tasks only).
3. **Terminal OSC**: when a task runs in the integrated terminal, emit `\x1b]9;<msg>\x07` (and 777 for notify-send ecosystems) so tmux/terminal notifiers pick it up.

## Hook Model (Claude-Code-inspired, local-only)

Workspace file `.aide/hooks.json`:
```json
{ "hooks": { "task.completed": [{ "command": "git rev-parse --short HEAD", "show": true }],
             "task.failed":   [{ "command": "npm run log-error" }] } }
```
- Events v1: task.started, task.completed, task.failed, diagnostics.new (B2 feed).
- Hooks run through the EXISTING process manager (spawn/execFile, tree kill on Windows, timeout). Never shell:true. Output captured, truncated at 4KB, shown as collapsible detail in the toast.
- Hooks are LOCAL commands only — if a command contains http(s):// or curl/wget/Invoke-WebRequest tokens, require explicit one-time consent per pattern (No-Phone-Home Law; V1 audits this).

## Contract

```ts
Notification: { id, severity:'info'|'warn'|'error'|'success', source:'task'|'hook'|'daemon'|'user', title, body?, jobId?, createdAt, read:boolean }
HookEvent = 'task.started'|'task.completed'|'task.failed'|'diagnostics.new'
HookConfig: { event, command:string[], show?:boolean, timeoutMs?:number(default 10_000) }
```

## Routes

- `GET /api/notifications?unread=true` -> list
- `POST /api/notifications/{id}/read`, `POST /api/notifications/read-all`
- `GET /api/hooks`, `PUT /api/hooks` (validate against contract; reject unknown events)
- WS channel `notifications` pushes new notifications live.

## Tests FIRST

1. Task completes via B1 run() -> notification emitted on WS with jobId linkage.
2. Hook fires on task.failed with correct exit-code context; output captured+truncated.
3. Hook timeout -> killed (process tree gone — assert no orphan node child), notification shows 'hook timed out'.
4. Network-suspicious hook requires consent -> without consent it's rejected with envelope error.
5. OS toast helper: unit test only asserts the generated PS script text contains expected literal + setting gate respected (don't actually pop toasts in CI).
6. Arch tests: routes validate strict bodies (unknown field -> 400), error envelope shape.

## Pitfalls

- Windows toast APIs differ across builds: wrap in try/catch, degrade silently to in-app only. Never crash the daemon over a toast.
- Do NOT reuse the B1 cmd bridge blindly here: hooks are argv arrays (execFile-style), which is SAFER than string commands — keep them arrays end-to-end from JSON to spawn.
- Don't spam: coalesce identical notifications within 2s window.

## Gate

Unit+arch green, openapi zero-diff after regen, e2e: run failing task -> toast appears + hook wrote marker file, all offline. Journal.
