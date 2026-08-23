---
name: aide-arch-extensions
description: Phase 9 SOP for the AIDE offline-first IDE rebuild — a VS Code-class extension ecosystem: extension host as a separate Node process spawned by the daemon (fork/child), VS Code-compatible package.json manifest + contribution registry, Open VSX-compatible OFFLINE marketplace (local registry, vsix cache, sha256-verified installs, deny-by-default sandbox, network opt-in only), activation events, and a minimal vscode-like API surface. Use whenever wiring extension install/activate/execute/uninstall, building the marketplace UI, parsing manifests, or debugging extension-host failures. Research-grounded (VS Code extension host architecture docs, Open VSX, the verified aide-phase9-extension-host skill).
---

# AIDE Architecture — Phase 9: Extension Host + Marketplace

## Doctrine

- **Isolation is the point.** Extensions are third-party code running on the user's machine — they get a SEPARATE Node process (the extension host) with its own lifecycle, memory, and failure domain. An extension crash must NEVER take down the daemon (the VS Code model: extension host dies, IDE lives).
- **Deny by default.** Extensions have NO network (offline-first); no fs access beyond the workspace unless declared in manifest + granted; no process spawn unless the manifest declares an activation permission (VS Code extensions historically could do anything — WE choose stricter; the user opted into AIDE's safety model).
- **VS Code manifest compatible.** `package.json` with `contributes`, `activationEvents`, `main`, `engines.aide` (plus engines.vscode for compat) — real VS Code extensions (the millions on Open VSX) are the supply chain; AIDE is the runtime.
- **Offline marketplace by default.** The marketplace is a LOCAL registry (vsix files + index, sha256-verified); remote sync is an explicit opt-in (Phase 4 egress audit flag).
- Verify before claiming: install → activate (real activation event) → contribution visible (command runs) → uninstall, with an extension that crashes mid-run proving the host dies but the daemon lives.

## What

Phase 9 delivers:

- **Extension host process** (`node/extension-host/`): a forked Node process with a typed IPC protocol (JSON-RPC over `fork()` channel or MessagePort). Owns: extension loading, activation, API surface, command registry.
- **Extension manager** (daemon side): `extensions/` dir, install (unzip vsix → manifest parse → sha256 verify → move into place), uninstall, enable/disable, status.
- **Manifest schema** (`common/contracts/extensions.ts`): a zod schema covering the VS Code subset we support: `main`, `activationEvents` (`onCommand:x`, `onLanguage:y`, `*`), `contributes` (commands, languages, themes, keybindings — subset), `engines`, `capabilities` (AIDE extension: `network: false|true`, `spawn: false|true` — deny by default; unknown capability = denied).
- **API surface** (`vscode`-like): commands (registerCommand/executeCommand), workspace (fs ops via the daemon contract ONLY — the host proxies to the daemon, never touches fs directly... on second thought: the extension host is a privileged-ish process, but keep it consistent: it goes through the daemon's workspace service so containment rules apply uniformly), window (status bar, quick pick subset), languages (registerCompletionItemProvider etc. → bridged to Monaco via the Phase 5 protocol paths or a typed bridge), env, Disposable pattern, Event emitter util. This is the biggest single chunk — scope it: Phase 9.1 API core (commands + workspace fs read/write + window messages), Phase 9.2 language contributions (if time permits; the LSP bridge already gives languages without extensions).
- **Activation**: lazy — a command contribution activates on first execute; `*` activates on host start (with a warning badge "eagerly activated"). Host reports activation timing; the UI shows loaded/activated extensions.
- **Marketplace UI**: LOCAL registry view (installed + available-in-cache), install-from-vsix file picker (the real offline path: user downloads a vsix elsewhere or receives it and drops it in), verify + quarantine flow. Remote registry = opt-in flag + explicit button.
- **Sandbox**: capability checks before EVERY privileged call (network/spawn denied by default); manifest hash recorded at install; the host runs with `NODE_OPTIONS` minimal and no NODE_PATH; extension code gets a frozen `process` (no child_process, no net in the host's exposed globals — the host wraps them and denies unless capability granted).

## How

### 1. Host process + IPC

- `child_process.fork('node/extension-host/main.js', [], { stdio: ['pipe','pipe','pipe','ipc'] })` (or spawn with `--experimental-...`; fork gives the IPC channel for free).
- Protocol: JSON-RPC-style messages over `process.send`/`process.on('message')`: `{ type:'invoke', id, method, args }` (browser↔daemon methods proxied), `{ type:'event', name, payload }` (host → daemon → WS to browser), `{ type:'log', level, message }`.
- Heartbeat: daemon pings every 30s; host replies; 2 missed → considered hung → kill + restart with backoff (Phase 5 restart pattern).
- Crash isolation: host exit ≠ daemon exit. On host death: extensions deactivate, commands unavailable, UI shows "extension host restarted" + auto-restart with backoff (cap 3 restarts/min, then manual).
- Extension code runs in the host's module loader; `main` is resolved relative to the extension dir; `require` is sandboxed (the host provides a restricted loader: only the `vscode` module + safe builtins; no `fs`/`child_process`/`net` — deny by default, capability-granted wrappers only).

### 2. Manifest validation (zod, strict)

- `package.json` inside the vsix must parse + validate against the manifest schema; `engines.aide` semver range must match the running AIDE version (reject otherwise, clear message).
- `activationEvents` entries must be SUPPORTED kinds (onCommand/onLanguage/onView/onStartupFinished/`*`); unsupported kind = reject with a specific error (fail closed — silent non-activation is the worst outcome).
- `contributes` validated per kind: commands need id+title; languages need id+extensions; unknown contribution kinds are IGNORED (with a logged warning) — forward compat, but never silently broken for known kinds.

### 3. Install/uninstall (offline, verified)

- Install: user picks a .vsix (or the local registry has it) → daemon: sha256 compute → manifest parse → capability check → unzip (no `unzip` shell command: use a JS unzip lib or `tar -xf` via execFile with args — choose one, test on Windows; system `unzip` often absent) → write to `extensions/<id>@<version>/` → record in `extensions/index.json` (id, version, sha256, installedAt, capabilities).
- Integrity check at load: re-hash the main files? (vsix content hash suffices; files are immutable after install — index records the tree hash; a mismatch at load = "extension modified on disk" → disabled with warning).
- Uninstall: stop host → remove dir → index update → reload host (if extensions remain).
- Quarantine: on manifest/capability failure, the vsix is moved to `extensions/quarantine/` (never deleted silently) with the reason in the log/UI.

### 4. Capability enforcement (the security line)

- `capabilities.network`: if false (default) the host's `net`/`http` modules are replaced with throwers; if true, still proxied through the daemon's egress audit (Phase 4) — network is NEVER raw.
- `capabilities.spawn`: if false (default) child_process spawn/fork/exec are throwers in the host; if true, spawn goes through the daemon's process manager (so tree-kill/containment/limits apply).
- `capabilities.fs` — workspace-scoped by default via the daemon contract; absolute-path fs denied unless `capabilities.fsWide: true` (rare; requires user confirm at install — a dialog naming the extension).
- The daemon enforces, not the host: host requests a capability-gated op → daemon checks the extension's granted capabilities → denies with reason. Host-side throwing is belt, daemon-side check is suspenders.

### 5. Marketplace (offline-first)

- Local registry: `marketplace/` with an index.json (available extensions: id, version, size, sha256, description) — seeded empty; populated by (a) user-dropped vsix files (auto-indexed on drop into a watched folder), (b) opt-in remote sync (Phase 4 egress flag + explicit button; the sync fetches Open VSX metadata into the local index — the cache IS the registry; after sync, installs are still offline).
- Install from registry: read from cache + sha256 verify → same install path as vsix picker.
- The UI always shows install source: local file / local cache / (remote sync) — no surprise network.

## Why (research grounding)

- VS Code docs (extension host architecture): a separate process for extension isolation, lazy activation via activationEvents, contributions from package.json — the proven model; we keep its shape and STRICTEN its sandbox (VS Code extensions historically get full node; ours get deny-by-default).
- Open VSX: the compatible ecosystem — manifest format and vsix layout (extension.vsixmanifest + extension/package.json) are the interoperable standard; offline mirroring is the documented distribution practice.
- Theia: extension hosts as separate processes with IPC; contribution registry pattern.
- Verified project lesson: the existing aide-phase9-extension-host skill (24.7KB) already encodes the registry/install/activate/execute/uninstall flow + Open VSX compatibility — this arch skill is its architecture doctrine; the old skill remains the operational detail reference.
- Offline-first: the user's requirement is absolute here — a marketplace that phones home is a violation; the local cache registry design makes offline the default and the only mode until opt-in.

## Dependencies

Node 20+ (fork IPC), zod, an unzip lib (or tested `tar -xf` path — tar.exe ships with Windows 10+), Phase 1 process manager (host spawn + tree kill + heartbeat/timeout), Phase 4 WS (host events → browser), Phase 6 egress audit (opt-in sync path), Phase 5 protocol bridge (language contributions reuse it), the existing aide-phase9-extension-host skill as operational reference.

## Known issues / bugs (watch these)

- **Extension crash loop**: a buggy extension crashing at load → host restarts → crash again → infinite loop. Backoff + restart cap (3/min) + auto-DISABLE the crashing extension after 2 consecutive crash-on-activate (with the log) — the "disable loopers" rule.
- **`*` activation**: eager extensions slow host start + surface bugs on every boot; badge them in the UI; default suggestion "disable if unused".
- **VSIX zip bombs**: unzip with size caps (total uncompressed limit, e.g. 500MB; file count limit) — a malicious vsix filling the disk is a real attack.
- **Symlinks in vsix**: a vsix containing symlinks pointing outside the extension dir — extract with link resolution disabled (store as regular files) or reject.
- **IPC message floods**: a chatty extension spamming host→daemon events — per-extension event rate cap (e.g. 100/s) with a warning; the browser WS has its own caps (Phase 4).
- **NODE_OPTIONS leaks**: the host must NOT inherit NODE_OPTIONS from the daemon env (extensions could read secrets via NODE_OPTIONS tricks) — strip it in the host spawn env.
- **Module resolution**: extension `main` requiring its own deps (node_modules inside the vsix) — the restricted loader must resolve relative to the extension dir FIRST, then builtins; wrong order breaks real extensions.
- **Windows path in manifests**: extension code doing path joins with hardcoded `/` breaks on Windows — that's the extension's bug, but surface it clearly in the activation error log (host wraps uncaught exceptions with extension id + stack).
- **Engine version drift**: AIDE upgrades breaking installed extensions — engines.aide range check at upgrade (Phase 11 release notes must flag extension compat).

## Phase 9 audit checklist (applied to the existing extension-host work)

1. Host is a separate forked process; daemon survives host crash (verify by killing the host mid-session).
2. Manifest zod schema covers main/activationEvents/contributes/engines/capabilities; strict validation with clear errors; unknown contribution kinds logged-not-fatal.
3. Install from local vsix: sha256 + manifest + capabilities + unzip caps + symlink rejection; index.json records; uninstall clean.
4. Capability enforcement REAL: an extension with capabilities.network=false cannot fetch (egress audit catches it); spawn=false cannot spawn (daemon-side denial).
5. Activation: lazy onCommand/onLanguage works; `*` badges; crash-loop disable rule works.
6. Marketplace: local cache registry + opt-in remote sync behind the Phase 4 flag; UI shows install source.
7. `npm run check` green; live: install a real small vsix (e.g. a theme), activate, command fires, uninstall.