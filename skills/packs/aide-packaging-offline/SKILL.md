---
name: aide-packaging-offline
description: Packaging SOP for the AIDE offline IDE — ship the workbench with its 3 GGUF models, fully offline, on Windows. Use whenever creating installers, deciding where model files live, verifying model integrity, or planning release/update mechanics.
---

# AIDE Packaging SOP (offline, Windows)

Target: `E:\aide-sovereign-workbench` — browser frontend + Node daemon (port 4777) + 3 GGUF models, packaged as a Tauri v2 Windows desktop app that works with ZERO internet. Installers are verified with honest smoke tests (silent install → daemon API probes → uninstall). **No browser is used in smoke tests** (Edge headless networking is broken on this machine — daemon API probes only).

## 1. Research base (verified from primary sources, Aug 2026)

| Topic | Verified fact | Source |
|---|---|---|
| `bundle.resources` | Files listed there are copied as **loose files** into `$RESOURCE` (on Windows NSIS/MSI = the install dir), preserving relative structure; directory entries copy recursively; object-map form controls target layout (`"resources/": ""` puts files at `$RESOURCE` root). `frontendDist` files are **embedded into the exe** — anything big in `frontend/` bloats the binary and cannot be spawned as a file on disk. | https://v2.tauri.app/develop/resources/ |
| WebView2 install modes | `downloadBootstrapper` (default, needs internet, +0MB), `embedBootstrapper` (+~1.8MB, still needs internet), `offlineInstaller` (**no internet, +~127MB**), `fixedVersion` (+~180MB), `skip` (app breaks without runtime). Win10 (Apr 2018+)/Win11 ship the runtime in the OS; offlineInstaller still required for Win10 LTSC/Server. | https://v2.tauri.app/distribute/windows-installer/ |
| NSIS vs MSI | NSIS: multi-language single exe, `installMode` default `currentUser` → installs to `%LOCALAPPDATA%` with **no admin/UAC**, silent flag `/S`. MSI (WiX v3): only buildable on Windows, needs the VBSCRIPT optional feature, silent via `msiexec /qn`. **Both have a ~2GB limit** (NSIS: per-file and total packed data; WiX: single files <2GB). Our largest payload-in-installer file is `node.exe` (98.4MB) — no risk today; any future >2GB single file forces MSI-out or a companion pack. | https://v2.tauri.app/distribute/windows-installer/ ; https://github.com/tauri-apps/tauri/issues/7372 ; https://nsis.sourceforge.io/Failure_when_compiling_a_big_installer |
| Sidecars | `bundle.externalBin` bundles an executable named `name-<target-triple>[.exe]` into the bundle, invoked via `app.shell().sidecar()`. For Node, either compile with `@yao-pkg/pkg` OR embed node.exe + JS as resources and spawn with `std::process::Command` (what `desktop/src/main.rs` does). | https://v2.tauri.app/develop/sidecar/ ; https://v2.tauri.app/learn/sidecar-nodejs/ |
| Model weights doctrine | Weights live BESIDE the app (`%LOCALAPPDATA%\<app>\models`, Local NOT Roaming), never inside the signed installer if >~200MB. Ship SHA-256 in the manifest; verify on first run; refuse on mismatch with an exact message. Update = atomic swap: download `.partial` → hash while writing → rename (atomic on one FS) → smoke prompt → switch manifest → delete old dir. | Established doctrine (see prior skill research) |
| Silent install/verify on Windows CI | NSIS `/S`, MSI `msiexec /i <pkg> /qn /norestart /L*v <log>`; find install via `HKCU/HKLM\...\Uninstall\*` DisplayName; verify the app by probing its localhost API, not by UI. Tauri MSI exit codes 0/3010 = success. | https://v2.tauri.app/distribute/windows-installer/ ; observed in repo `scripts/desktop-lifecycle-smoke.ps1` |

## 2. Packaging architecture decision (LOCKED)

- **Shell**: Tauri v2 (`@tauri-apps/cli` ^2.11.4, Rust project at `desktop/`). `desktop/src/main.rs` spawns the Node daemon via `std::process::Command` from the resource dir (`resource_dir/runtime/node.exe`, `resource_dir/daemon/server.mjs`) with `AIDE_WORKSPACE=<resource_dir>`, `AIDE_DAEMON_PORT=4777`, kills it on exit. Daemon stays the single source of truth (HTTP on `http://127.0.0.1:4777`).
- **Daemon transport**: Node daemon as an embedded runtime + resources (current design), NOT a pkg-compiled sidecar (avoid extra toolchain; main.rs already works).
- **Models**: OUTSIDE the installer. Installed model home = `%LOCALAPPDATA%\AIDE\models\`. The installer NEVER contains `.gguf` files (CI builds without `AIDE_INCLUDE_MODEL_WEIGHTS`, enforced by `desktop/verify-prepare.mjs` which fails if a `.gguf` is staged).
- **WebView2**: `offlineInstaller` (mandatory for the "zero internet" guarantee).
- **Installer kind**: **NSIS is the canonical Windows target** (per-user, no UAC, silent `/S` — reliable in CI). MSI (WiX) stays as a secondary artifact; it is NOT used for CI smoke because per-machine elevation/MSI discovery was flaky in the journal.
- **Repo facts to respect**:
  - `models/manifest.json` `packs[]` carry `file` + `sha256`: `smollm2-360m-instruct-q8_0.gguf` = `48ab3034…0201` (368.5MB), `qwen2.5-coder-0.5b-instruct-q4_k_m.gguf` = `1d961463…ff32` (468.6MB), `qwen2.5-coder-1.5b-instruct-q4_k_m.gguf` = `cc324af0…b046` (1065.6MB). Total ~1.9GB. Daemon endpoint per model: smollm2 8082, qwen-0.5b 8083, qwen-1.5b 8087 (`start_model_servers.ps1`, `models/manifest.json` `models[]`).
  - Daemon env resolution (`daemon/server.mjs:41-45`): `AIDE_HOME` = daemon's parent dir; `MODEL_DIR = $env:AIDE_MODEL_DIR | <AIDE_HOME>/models`; `MANIFEST = <AIDE_HOME>/models/manifest.json`. `AIDE_MODEL_DIR` is the documented override — the packaging layer MUST pass it, otherwise the installed app looks for models inside the (read-only-ish) install dir.
  - Daemon API (all on `127.0.0.1:4777`): `GET /health` → 200, `GET /api/models` → manifest models, `GET /api/models/status` → `{models:[{id,status,artifact_available,…}]}`, `POST /api/chat` `{modelId,messages}`. These are the smoke probes. No browser ever.

## 3. Build SOP (Windows)

### 3.1 Prereqs on the build machine
Rust MSVC toolchain + `rustup target add x86_64-pc-windows-msvc`, Node ≥20, and for MSI only: VBSCRIPT optional feature (Settings → Apps → Optional features). NSIS is fetched by the Tauri CLI automatically.

### 3.2 Fix the config first [TODO — currently broken for the built app]
Current `desktop/tauri.conf.json`:
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "AIDE Sovereign Workbench",
  "version": "0.1.0",
  "identifier": "org.ferrellsyntheticintelligence.aide",
  "build": { "frontendDist": "frontend", "devUrl": "http://127.0.0.1:4173" },
  "app": { "windows": [{"title": "AIDE Sovereign Workbench", "width": 1440, "height": 900, "minWidth": 900, "minHeight": 600}],
    "security": {"csp": "default-src 'self' http://127.0.0.1:4173 http://127.0.0.1:4777 http://127.0.0.1:*; connect-src 'self' http://127.0.0.1:*"} },
  "bundle": {"active": true, "targets": "all", "icon": ["icons/icon.png", "icons/icon.ico"], "resources": []}
}
```
Problems found in inspection:
1. `resources: []` is EMPTY — `node.exe` (98.4MB), `daemon/`, and the model manifest are currently staged under `frontendDist` → **embedded into the exe**, so `resource_dir/runtime/node.exe` does NOT exist as a real file in the built app and `main.rs` silently skips spawning the daemon. Fix: move runtime + daemon + manifest into `bundle.resources` (map form, to keep the exact paths main.rs expects):
```json
"bundle": {
  "active": true,
  "targets": "nsis",             /* canonical; add "msi" later, never "all" on CI */
  "icon": ["icons/icon.png", "icons/icon.ico"],
  "resources": {
    "frontend/runtime/": "runtime/",
    "frontend/daemon/": "daemon/",
    "frontend/models/manifest.json": "models/manifest.json"
  },
  "windows": { "webviewInstallMode": { "type": "offlineInstaller" } }
}
```
   (Paths in `tauri.conf.json` are relative to `desktop/`, so `frontend/…` = `desktop/frontend/…`.)
2. `desktop/prepare.mjs` copies EVERY non-`.gguf` file from `models/` — including the 401MB **`qwen2.5-coder-0.5b-instruct-q4_k_m.gguf.corrupt`** leftover. It was already staged into `desktop/frontend/models/` (measured: staged frontend = 499.9MB, of which ~401MB is that corrupt file). [TODO] Delete `models/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf.corrupt` (and from `desktop/frontend/models/`), or make prepare.mjs whitelist only `*.gguf|*.json|*.md`.
3. `main.rs` must pass the model home: `.env("AIDE_MODEL_DIR", <model_dir>)` where `<model_dir>` = `%LOCALAPPDATA%\AIDE\models` (`app.path().app_local_data_dir()`), created on first run. [TODO — currently only sets AIDE_WORKSPACE].

### 3.3 Commands
```powershell
# from E:\aide-sovereign-workbench
npm ci
npm run desktop:verify          # prepare + verify-prepare (fails if GGUF staged without AIDE_INCLUDE_MODEL_WEIGHTS=1)
npm run desktop:build           # = desktop:prepare && tauri build --config desktop/tauri.conf.json
npm run desktop:smoke           # scripts/desktop-artifact-smoke.mjs: bundle exists, installers non-empty
```
Output lands in `desktop/target/release/bundle/nsis/` (and `…/msi/` if enabled). The NSIS installer embeds the ~127MB WebView2 offline installer → expect ~150–250MB installer; exe payload stays <200MB because models are excluded.

## 4. Models first-run SOP (fail-to-safe)

1. **Location**: models live in `%LOCALAPPDATA%\AIDE\models\` (Local, never Roaming, never `Program Files`). The shell passes this as `AIDE_MODEL_DIR` to the daemon (3.2.3); daemon resolves per `daemon/server.mjs:44`.
2. **Shipping**: the release includes a companion archive `aide-models-0.1.0.zip` (3 × GGUF, ~1.9GB) BESIDE the installer (same download page). First run shows "Import model pack" → user points at the unpacked folder → provisioner copies into `%LOCALAPPDATA%\AIDE\models\`. Fully-offline: the archive is the payload, the installer is the app.
3. **Verify**: on first run AND at every daemon start, for each `packs[].file` with a `sha256` present in `models/manifest.json`: `Get-FileHash -Algorithm SHA256` compare. Log `MODEL_VERIFY: <file> OK|FAIL`. Reference implementation exists as CLI: `scripts/verify-model-bundle.mjs`. [TODO] port it into the daemon (`model-manager.mjs` currently does NO hash verification — only existence checks, `artifact_available`).
4. **Fail-to-safe**: any model whose hash mismatches or whose file is missing is reported `status: unavailable` with the EXACT message `MODEL_VERIFY: <file> FAIL — hash mismatch (expected <sha256>, got <sha256>)`. The app still launches; only that model is disabled. Never half-load a model.
5. **Update/atomic swap** (future model updates): download `weights.gguf.partial` into the new version dir → hash while writing → `Rename-Item` (atomic on one FS) → smoke prompt (fixed prompt, expected-shaped response) → switch `manifest.json` to the new version dir → delete old version dir only after the new one ran successfully. Rollback = one-line manifest change.
6. **Never** re-sign the app to change models — the manifest rides in `%LOCALAPPDATA%`, not in the signed payload.

## 5. Installer smoke SOP (headless, no browser)

`scripts/desktop-lifecycle-smoke.ps1` EXISTS and already does: locate bundle → pick installer (MSI first, NSIS fallback) → silent install → locate installed exe via Uninstall registry entries → launch → poll `GET http://127.0.0.1:4777/health` (200) → `CloseMainWindow` → same-build reinstall probe → uninstall → assert exe gone and daemon unreachable. Honest gaps:

- [TODO] **Model probe step**: after `/health` 200, assert `GET /api/models/status` returns HTTP 200 with JSON `{models:[…]}` containing all 3 model ids, and `POST /api/chat` `{modelId:"qwen-coder-1.5b-q4", messages:[{role:"user",content:"ping"}]}` returns 200 with generated text (CPU load takes 30–90s; poll up to 5min like `start_model_servers.ps1`). No browser, no WebDriver — Edge headless is broken on this machine.
- [TODO] **`scripts/desktop-installer-smoke.ps1` does NOT exist** — create it as the CI-cheap variant: silent install → `/health` 200 → `/api/models/status` 200 with 3 models (pre-seeded model dir, or skip if none) → uninstall → `/health` unreachable. Runs in ~2min vs lifecycle's full reinstall dance.
- Flags used (verified in script): NSIS `/S`; MSI `msiexec /i <pkg> /qn /norestart /L*v <log>` and `/x <ProductCode> /qn /norestart`. Exit codes 0/3010 = success; kill after 180s timeout.
- Installer discovery (the historically flaky part): script scans 4 bundle roots (`desktop/target/release/bundle`, `target/release/bundle`, ± `..\`) and prefers MSI. Mitigation: build `"targets": "nsis"` for CI (single artifact, deterministic discovery); check `HKCU` + `HKLM` + `WOW6432Node` uninstall keys and `%LOCALAPPDATA%`, `%LOCALAPPDATA%\Programs`, `Program Files(x86)`.

## 6. Offline guarantee checklist (run on a network-disabled machine or with firewall blocking all egress)

- [ ] Fresh install succeeds with NO internet (WebView2 installed from embedded offlineInstaller).
- [ ] App launches; `GET /health` 200 with no network.
- [ ] `GET /api/models/status` shows all 3 models; a `POST /api/chat` produces text on each.
- [ ] `MODEL_VERIFY` lines all `OK`; deliberately corrupting one model file → that model disabled with exact message, app still runs.
- [ ] `netstat -ano | findstr 4777` shows only `127.0.0.1:4777` listener — daemon binds loopback only (`HOST = '127.0.0.1'`).
- [ ] No outbound connections at boot: with firewall egress blocked, the app boots and works identically (no telemetry, no update check, no CDN calls).
- [ ] No `.gguf` present anywhere inside the installer payload (`msiexec /a <pkg> /qn TARGETDIR=<dir>` or 7-Zip on NSIS, then search).

## 7. CI note

`.github/workflows/desktop.yml` (exists): 3-OS matrix (ubuntu-22.04, macos-14, windows-2022) → `npm ci` → `desktop:verify` → `desktop:build` (weights intentionally excluded) → `desktop:smoke` → Windows: `scripts/desktop-lifecycle-smoke.ps1` → upload `desktop/target/release/bundle/**`. Adjustments [TODO]:
- Pin `"targets": "nsis"` on Windows CI to kill the MSI discovery flakiness; run the full lifecycle smoke locally on this machine (GTX 1060 laptop) per release and log evidence.
- Windows CI cannot verify models (none shipped) — it verifies installer mechanics only; model verification is the local Windows run (sections 4–5).
- `desktop:build` must run with `AIDE_INCLUDE_MODEL_WEIGHTS` unset — `desktop/verify-prepare.mjs` enforces this (fails if `.gguf` staged).

## 8. Audit checklist (before calling a release done)

- [ ] `desktop/tauri.conf.json`: `resources` non-empty and contains `runtime/`, `daemon/`, `models/manifest.json`; `webviewInstallMode: offlineInstaller`; `targets: nsis`.
- [ ] `desktop/frontend/models/` contains NO `.gguf` and NO `*.corrupt` files; `models/` tree has no junk (the 401MB `.corrupt` file is gone).
- [ ] `desktop/prepare.mjs` + `desktop/verify-prepare.mjs` agree on what may be staged.
- [ ] `main.rs` spawns daemon with `AIDE_MODEL_DIR=%LOCALAPPDATA%\AIDE\models`; daemon hash-verifies on start (MODEL_VERIFY lines).
- [ ] `scripts/desktop-installer-smoke.ps1` exists and passes: install → `/health` 200 → `/api/models/status` 200 with 3 models → chat returns text → uninstall → daemon gone.
- [ ] Offline checklist (section 6) passes on a network-off machine.
- [ ] Installer + model pack hashes recorded; smoke output logged (installer path, sizes, hashes, API results).

## Sources

- Tauri v2 — Embedding Additional Files (resources): https://v2.tauri.app/develop/resources/
- Tauri v2 — Windows Installer (WebView2 modes, NSIS installMode/hooks, WiX): https://v2.tauri.app/distribute/windows-installer/
- Tauri v2 — Embedding External Binaries (sidecars): https://v2.tauri.app/develop/sidecar/
- Tauri v2 — Node.js as a sidecar: https://v2.tauri.app/learn/sidecar-nodejs/
- Tauri v2 — Config reference: https://v2.tauri.app/reference/config/
- NSIS — Failure when compiling a big installer (2GB limit): https://nsis.sourceforge.io/Failure_when_compiling_a_big_installer
- tauri#7372 — NSIS/WiX fail above 2GB: https://github.com/tauri-apps/tauri/issues/7372
- pytauri#181 — large-file packaging workarounds (MSI not affected): https://github.com/pytauri/pytauri/issues/181