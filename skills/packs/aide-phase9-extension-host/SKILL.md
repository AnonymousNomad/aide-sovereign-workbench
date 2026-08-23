---
name: aide-phase9-extension-host
description: Phase 9 SOP for the AIDE offline IDE — a VS Code-class extension ecosystem: extension host (separate Node process spawned by the daemon), VS Code-compatible manifest + contribution registry, and an Open VSX-compatible offline marketplace (registry URL config, vsix cache, sha256-verified installs, deny-by-default sandbox). Use whenever wiring extension install/activate/execute/uninstall, building the marketplace UI, parsing package.json manifests, or debugging extension-host failures.
---

# Phase 9 — Extension Host + Open VSX Offline Marketplace (SOP)

Goal: AIDE must rival VS Code. The extension ecosystem is the decisive lever. Strategy = **FULL VS Code compatibility** (runtime-installable extensions, VS Code extension API shape, `package.json` manifests, `contributes` + `activationEvents`) with **Open VSX as the marketplace** and **offline-first** (registry mirror / local vsix cache). Theia-proven: this exact model is how Eclipse Theia runs VS Code extensions — dedicated extension-host process, runtime install, Open VSX default registry, `VSX_REGISTRY_URL` override.

## 1. Research base (source -> principle -> applied as)

| Source | Principle | Applied as |
|---|---|---|
| Theia docs — Extensions | VS Code extensions are runtime-installable, run in a **dedicated process per frontend connection**, against a **restricted API**; Theia extensions are compile-time with full DI | AIDE extension host = separate Node process spawned by the daemon, long-lived, per-workspace; extensions run inside it with a capped API surface, never in the daemon or frontend |
| Theia docs — Extensions | Open VSX is the default marketplace; `VSX_REGISTRY_URL` env var points to a custom registry / proxy / cache to limit external network and improve reliability | AIDE registry URL config (`AIDE_VSX_REGISTRY` env, default `https://open-vsx.org/api`); offline mirror = local vsix cache served through the same API shape |
| Theia vsx-registry README | You can host your own registry instance (eclipse/openvsx) and set `VSX_REGISTRY_URL`; multiple registries via OVSX router config | Single configurable registry for v1; optional static mirror (index.json + vsix files on disk / USB stick) |
| VS Code extension-manifest | Manifest = `package.json` at extension root; required: `name`, `version`, `publisher`, `engines.vscode`; id = `publisher.name`; `main` = entry point; `activationEvents` + `contributes` are declarative | AIDE reads the real VS Code manifest shape (`package.json`), not a custom one; id = `publisher.name`; engine range checked against `AIDE_ENGINE_VERSION` |
| VS Code contribution-points | `contributes` registers commands, languages, debuggers, keybindings, menus, views, configuration, grammars, snippets, themes, etc.; invoking a command emits `onCommand:<id>` activation | Contribution registry in the daemon: contributed commands become callable via `/api/extensions/command/<id>`; activation events drive lazy activation |
| VS Code activation-events | Lazy activation: `onLanguage:x`, `onCommand:x`, `onView:x`, `onDebug`, `onCustomEditor:x`, `*` | ActivationRegistry maps declared events to extension ids; host activates an extension only when an event fires |
| Open VSX API (verified live 2026-08-16) | `GET /api/-/search?query=&size=` returns `{extensions:[{name,namespace,version,verified,files:{download,sha256,signature,publicKey}}],totalSize}`; download = `GET /api/{ns}/{name}/{ver}/file/{ns}.{name}-{ver}.vsix`; `files.sha256` is a URL to a plain hex hash file | Marketplace client + search UI use exactly these endpoints; installer fetches the `.sha256` file and verifies the vsix before extraction |
| Open VSX API (verified live) | Extension detail `GET /api/{ns}/{name}` exposes `files.manifest` (the packaged `package.json`), `engines`, `verified`, `downloads`, `allVersions`, `bundledExtensions` | Pre-install manifest inspection (show name/engine/contributions before trust); version list for update checks |
| Current repo plugin system (plugins/manager.mjs + server.mjs) | Node Permission Model (`--permission`, `--allow-fs-read=`, `--no-addons`), capability-gated grants, deny-by-default network, atomic trust state, broken plugin never crashes load | Extension host inherits this security core unchanged; vsix adds the package-integrity gate on top |
| TheiaCon 2025 / Theia AI | AI-native IDE = MCP context injection, visual diff editors for agent changes, session management (Sessions view with Active/Restored tree), agent-to-agent delegation | Phase 9 extensions contribute MCP servers and commands the AIDE operator/agents can invoke; see master skill research base |

## 2. Architecture decision

- **Extension host = one separate Node process** (`extensions/host.mjs`), spawned by the daemon at startup (or lazily on first extension event), long-lived per daemon lifetime. The daemon never loads extension code in-process.
- **Frontend talks only to the daemon**: `/api/extensions/*` routes; the daemon forwards activation events and command invocations into the host over a JSON-RPC/JSONL pipe (stdin/stdout), same transport pattern the existing plugin execute uses but persistent.
- **Manifest-driven activation**: daemon reads every installed extension's `package.json`, builds a contribution registry (commands, activationEvents, views, languages) at load; nothing executes until an activation event fires (`onCommand:<id>`, `onLanguage:<id>`, `*` when opted in).
- **Contribution registry**: daemon-side index of `id -> {manifest, activationEvents, contributes, engineOk, enabled, trusted}`; served via `GET /api/extensions`; used by the frontend to render commands/views and by the operator/agent pipelines to invoke extension commands.
- **Two host tiers** (Theia parity):
  - Tier 1 (v1, this phase): host process per daemon, all trusted+enabled extensions run in it, activate on events.
  - Tier 2 (future, Theia parity): host process per frontend connection — only if multi-window isolation becomes required.
- **Marketplace = Open VSX protocol** against a configurable base URL; default `https://open-vsx.org/api`, offline mode = local mirror directory served by the same client with the same response shape (drop-in).

## 3. Manifest schema SOP (VS Code shape)

AIDE v1 accepts the **real VS Code extension manifest** — a `package.json` at the extension root (inside the vsix, which is a zip whose top-level dir is `extension/`). The legacy `aide-plugin.json` format stays supported as a v1 alias (mapped below) so existing scaffolds keep working.

Required fields (VS Code rules, enforced):

```json
{
  "name": "wordcount",
  "displayName": "Word Count",
  "version": "0.1.0",
  "publisher": "ms-vscode",
  "description": "Counts words in Markdown files.",
  "engines": {
    "vscode": "^1.0.0"
  },
  "categories": ["Other"],
  "activationEvents": ["onLanguage:markdown"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "wordcount.report",
        "title": "Word Count: Report",
        "category": "Word Count"
      }
    ]
  }
}
```

Field rules for v1 support:

- `name`: lowercase, no spaces, `[a-z0-9]` start, max 64 chars (regex `^[a-z0-9][a-z0-9-]*$`).
- `version`: semver (parse with a strict semver check; reject non-semver).
- `publisher`: required, id-safe (`^[a-z0-9][a-z0-9._-]*$`); extension id = `publisher.name` (must be unique in the registry).
- `engines.vscode`: required, **never `*`**; must satisfy the engine range check against `AIDE_ENGINE_VERSION` (the AIDE extension-API version, initially `1.0.0`, semver-satisfies). Mismatch -> `engine_required` state, not installed as enabled.
- `activationEvents`: array of strings; v1 accepts `onCommand:<id>`, `onLanguage:<id>`, `onView:<id>`, `onDebug`, `onCustomEditor:<id>`, `*`. Unknown event prefix -> rejected with a clear message.
- `main` (or `browser` for web-only extensions): optional path, must resolve inside the extension dir (path-traversal guard, same rule as current `entry` check). Extension without `main` is a static/declarative extension (themes, snippets, grammars) — no host activation needed.
- `contributes`: v1 registry records these keys; UI/host dispatch implemented for: `commands`, `languages`, `keybindings`, `menus`, `views`, `configuration`, `grammars`, `snippets`, `themes`, `debuggers`. All other contribution points are accepted but marked `unsupported_contrib` (not fatal — matches Theia's restricted-API behavior).
- `capabilities` (AIDE extension, not VS Code): keep the existing allowlist `[workspace.read, workspace.write, terminal.run, ui.view, command.register, network.localhost]` for host-process grants. Extensions without this field default to `[workspace.read, ui.view]` (deny-by-default).

Legacy `aide-plugin.json` alias mapping: `{id: publisher.name, name, version, api_version:"1", entry: main, activation_events: activationEvents, contributes}` — same validation, same runtime.

## 4. Lifecycle SOP

`install -> verify -> quarantine-extract -> enable -> activate -> run -> uninstall`. Every transition is a daemon route; every failure is contained (broken extension disables itself, daemon keeps serving).

1. **INSTALL** — `POST /api/extensions/install` with `{ source: "vsix" | "registry", name?, version?, file? }`.
   - Registry path: daemon fetches vsix from Open VSX download URL (or local mirror).
   - Local path: user-supplied `.vsix` file path (file picker / drag-drop into workspace).
   - Uploads capped at 100 MB (body guard already exists in daemon at 5 MB — raise explicitly for vsix route to 100 MB).
2. **VERIFY sha256 gate** (mandatory, both paths):
   - Registry installs: fetch `files.sha256` URL (plain hex string) and compare against the computed hash of the vsix bytes. Mismatch -> reject, log, quarantine.
   - Local installs: require the `.vsix.sha256` sidecar or an explicit hash the UI/user supplies; if absent, hash is computed but marked `unverified` and the extension is installed **disabled** (see Security rules).
3. **EXTRACT to quarantine**: unzip to `<STATE_DIR>/extensions/.quarantine/<id>-<version>-<rand>/` (STATE_DIR = `<WORKSPACE>/.aide`, matching existing layout). Zip-slip guard: reject any archive entry that escapes the quarantine root (path resolve check per entry, and limit total entries to 5000 / 200 MB expanded).
4. **MANIFEST VALIDATE**: read `extension/package.json`, run section 3 validation (name/version/publisher/engines/activationEvents/contributes/main path).
5. **PROMOTE**: on success, atomically move to `<STATE_DIR>/extensions/<publisher>.<name>-<version>/` and record `{id, publisher, name, version, sha256, source, installedAt, engineOk, trusted:false}` in `<STATE_DIR>/extensions.json` (same atomic tmp+rename pattern as the existing `plugins.json`).
6. **ENABLE / TRUST** — `POST /api/extensions/trust` `{id, trusted:true}`: mirrors existing plugin trust flow; only then is the extension eligible for activation. `enabled === trusted && engineOk`.
7. **ACTIVATE** — host process starts (if not running); daemon sends `{type:"activate", id, manifest, grants}` over the JSONL pipe; host requires the extension module (via `require`/import with `--permission`-style grants on the host process args), executes its `activate` export, and returns `{ok, contributedCommands}`. Activation failure -> host reports `{error}`; daemon marks extension `activation_failed` and continues (never crashes the daemon; host restarts on next event with the failed extension excluded).
8. **RUN COMMAND** — `POST /api/extensions/command` `{id, command, args}`: daemon checks the contribution registry (command must be contributed or registered at activation), forwards to host, host invokes and returns JSON-serializable result. Timeout 10 s (same as plugin execute).
9. **UPDATE** — `POST /api/extensions/update` `{id, version?}`: fetch newer version, repeat 2-5 with version-stamped dir; keep previous dir until new one is verified and enabled, then delete old (atomic swap, matching the packaging doctrine's swap sequence).
10. **UNINSTALL** — `DELETE /api/extensions/<id>`: run `vscode:uninstall` script if declared (host, sandboxed), remove registry entry, delete dir recursively, update `extensions.json` atomically.

Containment invariant: any thrown error at any stage returns `{error, extension_state: "disabled"}` — the daemon's top-level catch already returns 500/503 JSON; the extensions routes additionally must never be reachable from extension code (extensions run in the host, which has no HTTP server).

## 5. Open VSX offline SOP

- **Registry URL config**: `AIDE_VSX_REGISTRY` env var, default `https://open-vsx.org/api`. The marketplace client builds all calls on this base: search `GET {base}/-/search?query=&size=&offset=`, detail `GET {base}/{ns}/{name}`, download `GET {base}/{ns}/{name}/{ver}/file/{ns}.{name}-{ver}.vsix`, hash `GET {base}/{ns}/{name}/{ver}/file/{ns}.{name}-{ver}.sha256`. This mirrors Theia's `VSX_REGISTRY_URL` exactly — a custom registry instance or a proxy/cache is a drop-in.
- **vsix cache**: `<STATE_DIR>/extensions/cache/` stores every downloaded vsix keyed by `sha256`. Registry search first checks cache (`install_offline: true` path). Re-installs and updates reuse cached bytes without network. Cache entries also serve as the offline mirror seed.
- **Offline mirror**: `AIDE_VSX_MIRROR=<dir>` — a directory containing `index.json` (the frozen `search` response shape, so the UI is unchanged) plus vsix+sha256 files. When set, the marketplace client resolves from the mirror only (no network calls at all — `R4` offline rule). A USB stick / bundled asset with a curated index = fully offline marketplace.
- **Search UI**: reuse the existing `#plugin-presets` pattern — a `#marketplace` section rendering search results from `GET /api/extensions/search` (daemon proxies to the registry), each card showing `displayName, namespace.name, version, verified badge, downloadCount`, with INSTALL button. Verify-first: search is always shown, install always requires the sha256 gate.
- **Bundled starter set** (offline-first): ship a small curated set of real, small, verified vsix files (e.g. a tiny theme + a keybindings pack + one small language extension) in the mirror/index, installed from the mirror on first run, so the marketplace has content with zero network. Every bundled vsix is sha256-pinned in the index.
- **Fail-closed**: any network error during a registry search/install returns `{error, offline: true, cached: [...]}`; UI shows the cache/mirror results, never a broken spinner.

## 6. Security rules (non-negotiable)

1. **sha256 gate**: no vsix is extracted before its sha256 matches `files.sha256` (registry) or an explicit user-supplied hash (local). `unverified` installs land **disabled**.
2. **Quarantine-then-promote**: extraction only into `.aide/extensions/.quarantine/`; promotion only after manifest validation passes.
3. **Sandboxed host process**: the extension host runs with Node Permission Model args exactly like the current plugin manager: `--permission --allow-fs-read=<extDir> --no-addons`; grants derived only from the extension's declared `capabilities`; host has no HTTP listener, no access to daemon internals; communication only over the daemon-owned JSONL pipe.
4. **Deny network by default**: no `--allow-net` unless the extension declares `network.localhost` (v1: loopback only). Hard requirement on Node 26+ runtime for the net grant (the existing `--allow-net` runtime check is inherited). Extension code cannot open sockets without the capability.
5. **Per-extension opt-in**: trust is per extension id in `extensions.json`; enabling an extension never grants anything to another extension; untrusted extensions are never activated.
6. **Zip-slip + path escape guards** on extraction and on `main`/asset paths (existing `entry` guard pattern).
7. **Version pinning**: installs are exact-version (`publisher.name@version`); the registry index pins sha256 per version — a mirror cannot serve a tampered vsix because the hash is in the index.
8. **Never trust `vscode:uninstall` scripts at install time**; they run only at uninstall, inside the sandbox, non-blocking, with output discarded after logging.
9. **Broken extension isolation**: manifest errors, activation crashes, or command timeouts disable that extension only. Daemon `/health` must return `ok` in all cases (verification gate).

## 7. Existing repo integration (what exists today -> [TODO] gaps)

Current plugin system (from `plugins/manager.mjs`, `daemon/server.mjs`, `app.js`, `index.html`, `plugins/test-manager.mjs`):

| What exists | Where | Works today |
|---|---|---|
| Manifest `aide-plugin.json` (id/name/version/api_version/capabilities/entry/activation_events/contributes) | plugins/manager.mjs:validate | Validated, folder-name-bound |
| Capability allowlist + Node Permission Model grants (`--permission`, `--allow-fs-read=<dir>`, `--no-addons`, deny-net-by-default) | plugins/manager.mjs:execute | Tested live (network probes pass/fail) |
| Per-plugin trust registry, atomic write (`plugins.json`) | plugins/manager.mjs:setTrust | Tested |
| Child-process execution, 10 s timeout, JSON stdin/stdout | plugins/manager.mjs:execute | Tested |
| Broken/invalid plugin never crashes load (marked invalid+disabled) | plugins/manager.mjs:load | Tested |
| Routes: `/api/plugins`, `/api/plugins/presets`, `/api/plugins/trust`, `/api/plugins/execute`, `/api/plugins/scaffold` | daemon/server.mjs:203-217 | Acceptance-passed |
| UI: PLUG activity button, `#plugin-list` trust buttons, `#plugin-presets` scaffolds | app.js:288-293, index.html:30-52 | UI-audit-passed |
| Preset catalog (20 scaffolds) | plugins/presets.json | Works |

[TODO] gaps to close for VS Code-class (phase 9 scope):

- [TODO] `.vsix` ingestion: zip parsing + `extension/package.json` extraction (no vsix support today — folder-drop only).
- [TODO] sha256 verification gate on every install (none exists today — presets are trusted in-repo).
- [TODO] Quarantine dir + atomic promote (today scaffold writes directly into `plugins/`).
- [TODO] Open VSX client: search/detail/download/hash calls against configurable base URL (no network marketplace today).
- [TODO] vsix cache + offline mirror index (none today).
- [TODO] `engines.vscode` engine-range check vs `AIDE_ENGINE_VERSION` (today: `api_version` string equality only).
- [TODO] Contribution registry in the daemon + `GET /api/extensions` exposing commands/activationEvents (today: contributes is declared but not registered as callable).
- [TODO] Long-lived extension host process with lazy activation (today: one-shot child per `execute`).
- [TODO] Routes: `install`, `update`, `uninstall`, `search`, `command` (today: trust/execute/scaffold only).
- [TODO] Marketplace UI section (`#marketplace`) + INSTALL buttons (today: presets+scaffold only).
- [TODO] `extensions/test-manager.mjs` unit test + engine-check fixture (mirror `plugins/test-manager.mjs`).
- [TODO] Keep `aide-plugin.json` legacy alias working (backward compat with 20 existing presets).

## 8. Verification gates (must observe real output)

1. **Real vsix install, headless**: pick a small real extension from Open VSX (e.g. a tiny theme or keybindings pack — query `GET https://open-vsx.org/api/-/search?query=...&size=1`), download its vsix + `.sha256`, run install through the daemon route, assert: hash matched, extension listed in `GET /api/extensions` with `trusted:false, enabled:false`, files present under `.aide/extensions/<id>-<version>/`.
2. **Trust + activation**: `POST /api/extensions/trust` -> host starts -> `GET /api/extensions/host/status` shows `running`; contributed command registered in the registry.
3. **Command execution**: `POST /api/extensions/command {id, command: "<contributed id>"}` returns the observable JSON result (for a command extension, e.g. a status-report command; for a declarative extension, at minimum `{ok, registered:true}`).
4. **Corrupt package rejected**: flip one byte in a downloaded vsix -> install returns `{error}` with `sha256 mismatch`, `/health` still `ok`, no `.aide/extensions/<id>` dir created.
5. **Broken manifest contained**: install a vsix whose `package.json` has `engines.vscode: "*"` or bad semver -> `engine_required`/invalid state, daemon continues, existing plugins still list.
6. **Deny-by-default live probe**: a test extension that attempts a socket in `activate` fails unless `network.localhost` declared (mirror the existing plugin test's `process.permission.has('net') === false` probe).
7. **curl the routes**: `GET /api/extensions`, `POST /api/extensions/install`, `POST /api/extensions/trust`, `POST /api/extensions/command`, `DELETE /api/extensions/<id>` — every one returns the JSON contract, including error paths.
8. **Offline mirror**: set `AIDE_VSX_MIRROR` to a dir with `index.json` + vsix + sha256; `GET /api/extensions/search` returns mirror results with zero network access (assert no socket attempted — daemon-side fetch is replaced by fs reads).
9. **Uninstall**: after `DELETE`, dir gone, registry entry gone, host still alive.
10. **Unit test**: `extensions/test-manager.mjs` added to the `npm test` chain (package.json `test` script), asserting lifecycle states + security rules, like `plugins/test-manager.mjs`.

## 9. Audit checklist + Sources

Checklist (run before claiming phase 9 done):

- [ ] vsix install -> sha256 gate -> quarantine -> promote -> disable-by-default sequence observed on a real file
- [ ] Trust opt-in required before any activation; untrusted extension provably not activated
- [ ] Host process sandbox args identical in spirit to `plugins/manager.mjs` grants; no `--allow-net` without capability
- [ ] Broken/corrupt/engine-incompatible extension disables itself; daemon `/health` ok
- [ ] Contribution registry lists commands + activationEvents from installed manifests
- [ ] Marketplace search works against live Open VSX AND against offline mirror (same response shape)
- [ ] vsix cache reused on reinstall (no second network fetch)
- [ ] Legacy `aide-plugin.json` scaffolds still load (regression: `plugins/test-manager.mjs` passes)
- [ ] Full `npm test` chain passes with the new extension test added

Sources:

- Eclipse Theia — Extensions and Plugins (VS Code extensions in dedicated process per frontend connection, runtime-installable, restricted API, Open VSX default, `VSX_REGISTRY_URL`): https://theia-ide.org/docs/extensions/
- Eclipse Theia — vsx-registry README (custom registry instance, `VSX_REGISTRY_URL`, OVSX router): https://github.com/eclipse-theia/theia/blob/master/packages/vsx-registry/README.md
- VS Code — Extension Manifest (required fields, engines.vscode, main, activationEvents, contributes, example): https://code.visualstudio.com/api/references/extension-manifest
- VS Code — Contribution Points (full list: commands, configuration, debuggers, grammars, keybindings, languages, menus, views, ...): https://code.visualstudio.com/api/references/contribution-points
- VS Code — Activation Events (onLanguage/onCommand/onView/onDebug/onCustomEditor/*): https://code.visualstudio.com/api/references/activation-events
- Open VSX Registry API — search response (verified live 2026-08-16: files.download, files.sha256, files.signature, files.publicKey, verified): https://open-vsx.org/api/-/search?query=python&size=2
- Open VSX Registry API — extension detail (verified live: files.manifest, engines, allVersions, downloads, bundledExtensions): https://open-vsx.org/api/ms-python/python/2026.4.0
- Open VSX — sha256 file content (plain hex string, verified live): https://open-vsx.org/api/ms-python/python/2026.4.0/file/ms-python.python-2026.4.0.sha256
- Node.js Permission Model (--permission, --allow-fs-read, --allow-net, --no-addons): https://nodejs.org/api/permissions.html
- TheiaCon 2025 — Project Update keynote (Theia AI GA, first-class MCP, agent sessions): https://eclipsesource.com/blogs/2025/11/18/theiacon-2025-eclipse-theia-project-update/
- TheiaCon 2025 — AI-Native IDE demo (MCP tools, custom agents, agent delegation): https://eclipsesource.com/blogs/2025/12/09/theiacon-2025-beyond-coding-ultimate-ai-native-ide-demo/
- Theia IDE — AI features for end users (MCP servers config, Sessions view Active/Restored): https://theia-ide.org/docs/user_ai/
- Repo ground truth: `E:\aide-sovereign-workbench\plugins\manager.mjs`, `daemon\server.mjs` (plugin routes 203-217), `app.js` (loadPlugins 288-293, plugins-button 1039), `index.html` (30-52), `plugins\test-manager.mjs`, `plugins\README.md`, `docs\RESEARCH_LOG.md` (permission-model findings 373-387, 477-483)