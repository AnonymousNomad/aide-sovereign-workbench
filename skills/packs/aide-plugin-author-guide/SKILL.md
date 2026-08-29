---
name: aide-plugin-author-guide
description: How to build an AIDE plugin — manifest contract, capability model, spawn-protocol rules, the Windows-stdin gotcha that bit the skills-inspector prototype, and the path-resolution patterns that survive both the manager's --permission spawn and direct CLI runs. Use when authoring any new plugin under plugins/, when debugging a plugin that exits 0 with no output, or when porting an existing CLI tool into the plugin system.
---

# AIDE Plugin Author Guide

Born 2026-08-28 from a real attempt to ship `plugins/skills-inspector`
(an inspector over `skills/registry.json` that suggested skills based
on a workspace's file extensions). The plugin ran in the manager's
`spawn()` but exited 0 with empty stdout and empty stderr — the
lessons below are the unwasted bit.

## What the plugin system actually does today

- `plugins/manager.mjs` exports `PluginManager` with `load()`,
  `scaffold(id)`, `setTrust(id, true)`, `execute(id, payload)`.
- Manifest validation is strict: `id` must match its folder, `api_version`
  must be `'1'`, capabilities must be in the allowlist
  (`workspace.read`, `workspace.write`, `terminal.run`, `ui.view`,
  `command.register`, `network.localhost`), entry path is jail-validated.
- `execute()` spawns a child with `--permission --allow-fs-read=<pluginDir>`
  plus per-capability grants. stdout + stderr are captured; the child
  gets `JSON.stringify(payload) + '\n'` on stdin and the pipe is closed.
- The plugin must write a single JSON object to stdout and exit 0.
  Non-zero or invalid JSON → the manager rejects with the captured stderr.


## Manifest contract (verified 2026-08-28)

```json
{
  "id": "my-plugin",                  // MUST equal the folder name
  "name": "My Plugin",
  "version": "0.1.0",
  "api_version": "1",                  // only '1' is accepted
  "description": "One line, used for command palette + preset catalog",
  "capabilities": ["workspace.read"], // see allowlist above
  "entry": "index.mjs",                // optional; null = template (no execute)
  "activation_events": [],             // reserved
  "contributes": {                     // optional, for UI
    "commands": [{"id": "my-plugin.run", "title": "Run My Plugin"}],
    "views": []
  }
}
```


## The Windows-stdin gotcha (this is the big one)

On Windows, **the manager's `child.stdin.end(payload + '\n')` does NOT
emit a `'data'` event on a closed pipe in the child.** The child's
`process.stdin` looks like it's there, but Node treats the closed
pipe as already-EOF and may never deliver the buffered bytes. Symptoms
in the child process:

- Top-level code runs (you see `MODULE_LOADED` in stderr)
- Imports succeed (you see `IMPORTS_DONE`)
- The script's `main()` is never called
- Process exits 0 with empty stdout and empty stderr

Workarounds, in order of preference:

### 1. `process.stdin.on('data', () => {})` at module top-level (keep-alive)
Registering ANY data listener keeps Node's readable stream "open" and
ensures the event loop stays alive long enough to receive the payload.
This is the **most robust** approach. Add it before the imports so
the keep-alive is in place before any module evaluation work.

```javascript
import process from 'node:process';
process.stdin.on('data', () => {});  // <-- keep-alive
import { readFileSync } from 'node:fs';
// ... rest of imports
```

### 2. `process.stdin.resume()` inside readStdin
Forces the stream into flowing mode. Combined with `setEncoding('utf8')`
and listeners for `data` / `end` / `close`, this works on most
platforms. Still flaky on Windows for short payloads — the `end` event
can fire before listeners attach if the writer closed the pipe
synchronously. Always combine with the module-level keep-alive
above for belt-and-suspenders.

### 3. Hard timeout fallback

## Path resolution (survives both spawn and direct CLI)

The manager spawns the entry as `process.execPath <args> <entry>`, so
`process.argv[1]` is the entry path. But for direct-CLI debugging
(`node plugins/<id>/index.mjs`) `argv[1]` is still the entry — so
both paths can use:

```javascript
import { join, dirname } from 'node:path';
const SCRIPT_PATH = process.argv[1] || join(process.cwd(), 'index.mjs');
const PLUGIN_DIR = dirname(SCRIPT_PATH);
const REPO_ROOT = dirname(dirname(PLUGIN_DIR));
```

`import.meta.url` works too in ESM (.mjs) but `process.argv[1]` is
more portable when the plugin might be transpiled or moved.

## --permission flag (CRITICAL on Node 26)

## Testing the plugin (the right way)

Use the existing `plugins/test-manager.mjs` pattern, but write a
companion test that does NOT go through the manager for the first
pass (it eats stdout so you can't see what's wrong). Instead, use
`child_process.spawnSync` with `input: <payload>`, `encoding: 'utf8'`,
`timeout: 5000`. Verify the child writes a single JSON line on stdout
and exits 0. THEN add the manager-level test as a smoke test.

```javascript
const r = spawnSync(process.execPath, [entry], { input: payload, encoding: 'utf8', timeout: 5000 });
assert.equal(r.status, 0);
const out = JSON.parse(r.stdout);
assert.equal(out.ok, true);
```

## Pitfalls (each cost real time on 2026-08-28)

- Do NOT add a `process.exit(0)` at the end of the script. The
  manager's execute() uses a `close` event to resolve; an explicit
  exit is fine but unneeded. If you exit too early, any pending
  stdout writes can be lost — the manager reads from the closed
  stream and may see empty output.
- Do NOT call `process.stdin.setEncoding('utf8')` BEFORE registering
  the keep-alive data listener. The encoding change can race the
  listener attachment.
- Do NOT write to stderr in production. Stderr is for the manager's
  error log; a chatty plugin that logs to stderr will fill the
  manager's log on every call. Reserve stderr for genuine errors.
- Do NOT trust a "successful" exit alone. Always assert the JSON
  shape on stdout. A plugin that exits 0 with a syntax error in
  its output (e.g. undefined) will silently break the manager.
- Do NOT skip the manifest's `api_version: '1'`. The validator
  rejects anything else, and the error message is not always surfaced
  to the user — they see "plugin is unavailable" instead.

## Where to ship the next plugin

High-value, low-risk plugins that fit the existing capability model:
- `plugins/notes-search` (`workspace.read`): index `.aide/notes/`
  and return snippets; pairs with `aide-local-notes` skill.
- `plugins/model-status` (`workspace.read`): read `models/manifest.json`
  + `.aide/index/manifest.json` and return engine health. Pairs with
  `aide-backend-autoselect` and `aide-engine-lifecycle-doctrine`.
- `plugins/skill-search` (`workspace.read`): the working version of
  what `skills-inspector` was supposed to be. Index SKILL.md files,
  keyword-match on file extensions in the workspace, return
  ranked suggestions. The lessons above are the recipe.


The manager's spawn uses `args.push('--no-addons', entry)`. The
`--no-addons` flag is unrelated; what matters is that **the child
process runs with `--permission`**. This means:
- `--allow-fs-read=<pluginDir>` is set (so the entry file can be
  read), but reading OUTSIDE the plugin directory requires
  additional `--allow-fs-read=<other-dir>` flags. Pass paths inside
  the plugin dir only, OR have the user grant extra read rights via
  the trust flow.
- `process.permission.has('net')` is `false` unless the manifest
  declares `network.localhost` AND the runtime is Node 26+. The
  test plugin manager validates this and throws at execute() time.

Wrap your readStdin in a `setTimeout(finish, 2000)` safety net so the
plugin never hangs. The manager has a 10 s outer timeout, but a
plugin-level 2 s cap keeps tests fast.

### 4. Synchronous `fs.readSync(0, buf, 0, buf.length, null)`
Works in some setups, but is brittle — `readSync` on a non-blocking
fd can return `-1` with no data even when data is buffered, and the
loop will exit with empty data. Combine with the keep-alive to be safe.

Trust is stored in `<workspace>/.aide/plugins.json` as `{ "<id>": true }`.
Without trust, `execute()` throws "plugin trust is required".
