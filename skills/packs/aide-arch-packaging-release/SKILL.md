---
name: aide-arch-packaging-release
description: Phase 11 SOP for the AIDE offline-first IDE rebuild — desktop packaging + release engineering: shell technology decision (Tauri vs Electron vs browser-only launcher, evaluated on THIS machine), offline asset bundling (Monaco workers, fonts, models, language servers — everything local), installer + first-run offline smoke test, model integrity sha256 verification, update mechanics, and the full verification battery before any release claim. Use whenever deciding the desktop shell, building the installer, verifying model/asset integrity, or auditing "does the shipped product actually work offline from a clean install". Research-grounded (Tauri/Electron/WebView2 docs, the verified aide-packaging-offline skill, verification-complete doctrine).
---

# AIDE Architecture — Phase 11: Packaging + Release

## Doctrine

- **The product is the offline experience.** The shipped artifact must run AIDE from a CLEAN install with NO internet: all Monaco workers, fonts, CSS, models, language servers, and the daemon bundled; first-run works on a fresh machine profile. Any post-install download = a bug.
- **Integrity before trust.** Models and vsix assets are verified by sha256 before first load (the verified aide-packaging-offline scheme). A mismatched model is disabled with a clear message + re-download/restore guidance — never silently loaded.
- **Shell decision is evidence-based, not vibes.** Evaluate Tauri (WebView2 + Rust), Electron (Chromium + Node), and a browser-only launcher (the current static-server model) against THIS machine's reality: solo dev, offline-first, no Rust toolchain installed, Windows 10/11, WebView2 preinstalled on modern Windows. Decide with a measured spike (see How #1), encode the result here.
- **Verify before claiming:** the release checklist (How #5) is executed in full, including a clean-VM/clean-profile install + offline smoke test, before "released" is ever said. Verification-complete doctrine applies: smoke tests are not proof.

## What

Phase 11 delivers the shippable product:

- **Desktop shell** (decision pending spike): the frontend (Phase 2-4) + daemon (Phase 1) packaged so the user double-clicks an installer and gets the IDE: window, menu-less UX, daemon lifecycle owned by the shell (start on launch, graceful stop on quit — children first, Phase 1).
- **Offline asset bundle**: `dist/` = vite build (workers, css, fonts, monaco) + `models/` (3 GGUF, sha256 manifest) + `servers/` (bundled language servers if shipped) + `marketplace/` cache. One folder, fully self-contained; the app's ONLY network is localhost.
- **Installer**: per shell decision (NSIS for Electron/Tauri-bundle, or a .bat/start-menu shortcut + unpack for the browser-launcher model — a real installer is expected for "rival VS Code" positioning; evaluate).
- **First-run flow**: workspace picker (or default), model integrity check (sha256, ~seconds for GGUF on SSD), model warmup (Phase 6 gate), session restore — all offline, all logged.
- **Update mechanics**: version file + optional local update check (opt-in online only); manual "update from folder/zip" flow for offline users (replace dist + models with a verified bundle). No silent updates, no network by default.
- **Release artifacts**: installer + sha256 + changelog + extension-compat notes (Phase 9 engines.aide), published per the user's release process.

## How

### 1. Shell decision spike (do this first, evidence wins)

Candidates on THIS machine (Windows 11-ish, no Rust, no VS Build Tools verified):

| Shell | Pros | Cons | Decision gate |
|---|---|---|---|
| Tauri 2 | Tiny (~5MB), WebView2 preinstalled on Win10/11, Rust backend can own the daemon | Requires Rust toolchain + MSVC build tools (not installed — big setup cost); first Rust build is slow; solo dev debugging Rust + TS | Only if toolchain install is acceptable and a spike build passes |
| Electron | Chromium + Node in one runtime — the daemon could run IN the shell process (no IPC split); huge ecosystem; no toolchain (npm only) | ~100MB+ per install; 2 Chromium memory footprints; heavier updates | Works today with zero new toolchains; memory cost real on 16GB machine |
| Browser-launcher (current model) | Zero new tech: daemon + vite preview static server + a .cmd/shortcut that opens the browser | No window chrome/UX polish; browser tab UX; no menu/tray | Fine as interim; weak vs "rival VS Code" positioning |

Spike (bounded, ~1 session each): Tauri: `npm create tauri-app` + a hello-world build (measure: toolchain install time, first-build time, binary size). Electron: `npm init electron` + hello-world with the daemon spawned (measure: package size, memory). Then DECIDE and record the decision + measurements in AGENT_NOTES and this skill. Default recommendation if Tauri's toolchain install fails or exceeds a session: Electron — the daemon-inside-shell option (one process, one lifecycle, no port juggling) is architecturally clean for our split (though port 4777 IPC also works and keeps the current daemon boundary for tests).

### 2. Offline bundle audit (the egress rule for the release)

- `grep -R "https\?://" dist/` → allowed: NONE except `localhost`/`127.0.0.1` literals. Monaco workers are emitted as local chunks (Phase 3 rule) — verify in the BUILT bundle, not dev.
- Fonts/icons: bundled (Phase 2/3 rule). The packaged app must render identically with the network cable pulled.
- Models manifest: `models/manifest.json` = { id, file, sha256, sizeBytes, modelClass } — verified at first run and on every model start (cheap: compare size then hash on first start only; full hash per start is wasteful on 1GB+ files — hash at install/first-run, size check per start).
- Language servers: bundled or PATH-resolved (Phase 5); the bundle must NOT silently need a download.

### 3. Installer + first run

- Installer: installs the bundle + creates per-user data dir (sessions, extensions, community, credentials) + start-menu shortcut + optional desktop shortcut + uninstaller. No admin rights needed (per-user install; models land under the user's AppData or install dir — decide, document).
- First run: daemon start (its own logs dir), integrity check, model warmup (user-visible progress in the RUN view), session restore. Failure of ANY offline check = a clear dialog, not a silent skip.
- Idempotent upgrade: install over an existing version keeps user data dir; version bump in data dir; extension compat checked (Phase 9 engines).

### 4. Verification battery (the release gate — verification-complete doctrine)

- Unit + contract tests (all phases' `npm run check`).
- E2E suite in a fresh profile dir (no leftover session/state).
- Clean-install smoke on a VM or a temp Windows user profile: install → launch → workspace pick → open file → edit → save → model chat round-trip → git commit in a scratch repo → ALL OFFLINE (network adapter disabled) → uninstall clean.
- Model integrity: corrupt a copy of a GGUF byte → first-run must flag it and refuse to load it.
- Memory: idle daemon < 200MB, idle UI < 300MB (16GB machine, user's training jobs share RAM).
- Startup latency: cold start (daemon + UI + first model warm) measured and recorded — regression-check against the previous release.
- Log review: zero ERROR lines in a clean first-run log.

### 5. Release checklist (final answer to "is it released?")

1. All phases' audit checklists green (this skill + the 11 phase skills).
2. Offline bundle audit clean; models manifest verified.
3. Installer built from a CLEAN checkout (reproducible: same artifact from a fresh clone).
4. Clean-install offline smoke passed (How #4) on a fresh profile.
5. Changelog + sha256 + extension-compat note written; artifacts placed per release process.
6. The shell decision spike + measurements recorded in AGENT_NOTES (evidence, not vibes).

## Why (research grounding)

- Tauri docs: WebView2-based, small binaries, requires the Rust toolchain + platform build tools. Electron docs: self-contained Chromium+Node, npm-only toolchain. Both are legitimate; the choice is machine-contextual (this machine has no Rust toolchain — verify before committing months of builds to it).
- aide-packaging-offline (verified): the GGUF-bundling + integrity scheme (sha256 manifests, offline install, Windows paths) is already encoded and proven — Phase 11 generalizes it to the whole bundle.
- verification-complete: smoke tests are not proof; the clean-profile offline run with the network disabled IS the proof. NASA-style: independent verification on a fresh environment.
- Offline-first doctrine: every phase skill repeats it; Phase 11 is where it becomes a test — "run with the cable pulled" is the acceptance test.

## Dependencies

Per shell decision: Tauri (Rust + MSVC toolchain — may require a setup session) or Electron (npm only) or the browser-launcher interim. NSIS (Electron) / Tauri bundler for installers. The full output of Phases 0-10 (bundle contents). sha256 tooling (node crypto — built-in, no deps). Existing aide-packaging-offline skill as the operational reference.

## Known issues / bugs (watch these)

- **WebView2 missing** (rare Windows 10 old builds): Tauri/WebView2 apps fail to render — detect at first run and guide the user (install WebView2 runtime offline package, or fall back to a bundled browser mode). Never silent blank.
- **Custom scheme vs secure context**: a `aide://` protocol may not count as a secure context — clipboard (Phase 8) and other secure-context APIs break; serve the UI over `http://127.0.0.1:<port>` from the daemon instead (localhost is a secure context and needs no scheme registration). Decision: packaged app serves via localhost HTTP — document why (matches the dev model exactly, zero context surprises).
- **Port collisions in packaged mode**: another app on 4777 → the daemon's port doctrine applies (reuse-ours/next-free + loud log); the shell must read the ACTUAL port back from the daemon (health endpoint) to open the window to the right URL.
- **Daemon lifecycle in Electron**: shell quit must tree-kill the daemon (children first) or models/training orphans survive (Phase 1/6 doctrine) — bind daemon death to shell quit explicitly; never rely on window close.
- **Model hash cost**: sha256 of 1-2GB GGUF at every start = seconds per boot; hash at install/first-run only, size-check per start (decided in How #2 — keep it).
- **AV false positives**: Electron/Tauri installers trigger Defender SmartScreen on unsigned builds — document the "More info → Run anyway" flow in the release notes; a code-signing cert is an opt-in (cost) decision, not a blocker.
- **Installer reproducibility**: a build machine with leftover node_modules/deletions produces non-reproducible artifacts — release builds run from a CLEAN checkout with `npm ci` (exact lockfile); record the artifact hash in the release notes.
- **Update integrity**: the offline "update from folder" flow re-verifies the models manifest + bundle hashes before swapping; a broken zip must never half-apply (stage → verify → swap → rollback on failure).

## Phase 11 audit checklist (applied to the existing packaging)

1. Shell decision made with the spike evidence recorded (toolchain installed or rejected; binary size; memory measured).
2. Offline bundle audit: zero remote URLs in dist/; fonts/workers/css local; models manifest sha256 verified at first run; corrupt-model test passes (refuses to load).
3. Installer from a clean checkout; installs per-user; uninstaller clean; upgrade keeps user data + extension-compat check.
4. Clean-profile offline smoke (network disabled) passes the full battery: open/edit/save/chat/git/lesson — with logs ERROR-free.
5. Release artifacts: installer + sha256 + changelog + compat notes; everything recorded in AGENT_NOTES.