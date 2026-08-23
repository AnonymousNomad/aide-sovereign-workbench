---
name: aide-phase8-android-build
description: Phase 8 SOP for the AIDE offline IDE — Android Studio-style build tooling: Gradle builds, APK assembly/signing, emulator + adb, build pipeline UI. Use whenever wiring APK build tasks, Gradle execution, signing, or emulator controls.
---

# Phase 8 — Android Build SOP

Goal: build Android projects from the IDE like Android Studio's Build menu: assemble debug APK, install to emulator/device, sign releases — via the Gradle wrapper CLI, surfaced through the daemon + frontend.

Repo: `E:\aide-sovereign-workbench`. Journal: **this phase was NOT built yet**. Audit on 2026-08-16 confirms:
- `daemon/android-manager.mjs` — **ABSENT** (must be created).
- `daemon/server.mjs` — **no** `/api/android/*` routes (only `/api/training/*`, lines 371-383, exist as the pattern to mirror).
- `app.js` — **no** android buttons/helpers (the `trainingRequest()` helper at app.js:883 and the wiring at app.js:1143-1145 are the pattern to mirror).
- `daemon/terminal/run` allowlist (server.mjs:291: `node, npm, npx, git, py, python, python3, cargo, rustc`) does NOT include `adb`/`emulator`/`gradlew` — the android manager must spawn them directly, never via the terminal route.

## Research base (verified, primary sources)

| Area | Verified fact | Source |
|---|---|---|
| CLI entry | `gradlew.bat` (Windows) / `./gradlew` at project root; `gradlew tasks` lists all build/install tasks per variant | building-cmdline |
| Debug build | `gradlew assembleDebug` → `project/module/build/outputs/apk/debug/module-debug.apk` — **already signed with the SDK debug key and zipaligned**; instantly installable | building-cmdline |
| Install | `gradlew installDebug` = build + install to running emulator/device; `installRelease` works once a signingConfig is defined | building-cmdline |
| Variants | variants = build types (debug/release) × product flavors; task names camelCase: `assembleDemoDebug`, `installFullRelease`; `gradlew build` assembles all | build-variants, gradle-build-overview |
| Release signing | release is UNSIGNED by default unless `signingConfigs` is defined; signing = keytool keystore + `apksigner sign`; zipalign must run BEFORE apksigner (apksigner preserves alignment; any post-sign change invalidates the signature) | build-for-release, zipalign, apksigner |
| Secret handling | passwords in build files are bad practice; official pattern: `keystore.properties` at project root, loaded in build.gradle, **never committed**; or env vars (`KSTOREPWD`, `KEYPWD`) | app-signing, build-variants |
| Debug keystore | auto-created at `%USERPROFILE%\.android\debug.keystore` on first run; insecure, never publishable | app-signing |
| apksigner | SDK build-tools tool; `apksigner sign --ks <store> --ks-key-alias <alias> --ks-pass pass:<pw> [--key-pass pass:<pw>] [--out out.apk] in.apk`; verify via `apksigner verify --verbose` | apksigner |
| zipalign | `zipalign -p 4 in.apk out.apk` (align before sign); `-P 16` recommended for page-aligned `.so`; `-c` checks only | zipalign |
| Emulator | `emulator -avd <name>`; headless: `-no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect`; AVDs under `%USERPROFILE%\.android\avd\` (overridable via `ANDROID_AVD_HOME`); **x86 images require hardware acceleration on Windows (WHPX)**; `-accel off` is debugging-only and extremely slow | emulator-commandline, variables |
| AVD creation | `sdkmanager --install "system-images;android-34;google_apis;x86_64"` then `echo no | avdmanager create avd -n <name> -k "<package>"` | SO + sdkmanager docs |
| adb | `adb devices`, `adb install -r <apk>`, `adb shell am start -W -n <pkg>/<activity>`, `adb -s <serial> ...` for multi-device; emulator serials are `emulator-5554` style (odd ports); `ANDROID_SERIAL` env selects default target | adb |
| Boot readiness | `adb wait-for-device` only waits for the transport, NOT boot; poll `adb shell getprop sys.boot_completed` until `1` (Playwright pattern) | playwright avd_start.sh |
| Logcat | `adb logcat -d [-t <lines>] [tag:level ...]`; filters like `*:e`, `ActivityManager:I MyApp:D *:S`; streaming: `adb logcat` without `-d` | logcat, emulator-commandline |
| Daemon | Gradle daemon = long-lived JVM, default ON, caches build state; `--no-daemon` runs one-shot (CI pattern); `--offline` builds only from local cache | gradle-daemon, command_line_interface |
| JAVA_HOME | Gradle client JVM comes from `JAVA_HOME`; must be a real JDK dir containing `bin\java.exe`; AGP 8.x requires JDK 17+; mis-set JAVA_HOME is the #1 Windows failure ("supplied javaHome seems to be invalid") | gradle_daemon, build_environment, gradle#18092 |
| First-run download | `gradlew.bat` downloads the Gradle distribution zip ONCE into `%USERPROFILE%\.gradle\wrapper\dists`; dependency artifacts cache to `%USERPROFILE%\.gradle\caches\modules-2`; both are copyable/mountable to another machine for offline use | dependency_caching, setup-gradle |
| Gradle phases | initialization → configuration → execution; stream output lines live, never swallow; long builds must not hit HTTP timeouts | gradle-build-overview, prior phase research |
| Windows file locks | Gradle daemon holds locks on the cache; stop daemons (`gradlew --stop`) before copying/moving the Gradle user home (CI action does this) | setup-gradle |

## Toolchain prerequisites (Windows)

The IDE is offline-first. Decide: **pre-bundled offline toolchain** vs **opt-in online download for the Android phase**. `DECISION NEEDED` — both are valid; the marker below states the trade-off.

- **JDK 17+** — required for AGP 8.x. `JAVA_HOME` must point at the JDK directory (must contain `bin\java.exe`). Verify: `& "$env:JAVA_HOME\bin\java.exe" -version`. Do NOT accept a JRE only. Windows default install: `C:\Program Files\Eclipse Adoptium\jdk-17*\` (Adoptium/Temurin 17 is the standard CI choice; `actions/setup-java` uses `distribution: temurin, java-version: 17`).
- **Android SDK** — `cmdline-tools` + `platform-tools` (adb) + `build-tools` (apksigner, zipalign, aapt) + `emulator` + a `system-images;android-<api>;google_apis;x86_64` image + platform/android-<api>. Windows default root: `%LOCALAPPDATA%\Android\Sdk`. Env: `ANDROID_HOME` (also honored: `ANDROID_SDK_ROOT`). Put `%ANDROID_HOME%\platform-tools` and `%ANDROID_HOME%\emulator` on PATH for the daemon's spawned children.
- **Gradle wrapper distribution + dependency cache** — first `gradlew.bat` run downloads the dist zip (~100-200 MB) and all plugin/dependency jars into `%USERPROFILE%\.gradle\`. Offline strategy:
  1. **Pre-bundled (true offline):** run the Android sample project once on a networked machine, then copy `%USERPROFILE%\.gradle\wrapper\dists` + `%USERPROFILE%\.gradle\caches` into the AIDE pack (or a shared dir). Point children at it via `GRADLE_USER_HOME` env when spawning. Stop daemons first (`gradlew --stop`) to avoid file-lock corruption. Every `gradlew` invocation then runs with `--offline`.
  2. **Opt-in online:** the Android phase requires network ONCE (or on new dependency versions). Show a clear consent step in the UI before the first build; then the normal cache keeps it offline thereafter.
  - Either way, pass `--offline` when the cache is known-complete so builds never hang on network stalls, and keep a known-good "seed project" in the repo (e.g. `fixtures/android-sample/`) that carries the wrapper (`gradle/wrapper/gradle-wrapper.jar` + `.properties` + `gradlew.bat`) — the wrapper JAR itself must be committed for the offline claim to hold.
- **Hardware acceleration note:** the emulator on Windows needs WHPX (Windows Hypervisor Platform) for x86_64 images. `-accel off` software emulation boots in many minutes and is debugging-only. The SOP below assumes WHPX is enabled (Windows feature); if boot fails with "x86 emulation currently requires hardware acceleration", surface that exact message in the UI rather than pretending.
- **Sample project:** keep `fixtures/android-sample/` (a minimal single-activity app with wrapper committed) so verification gates and UI demos never depend on a user-supplied project.

## Step-by-step build SOP

Run from the IDE's daemon, mirroring `daemon/training-manager.mjs` (spawn → stream → logs ring → status → stop). Each step is one function in `daemon/android-manager.mjs`.

1. **Preflight** — `POST /api/android/build` validates: project dir exists and contains `gradlew.bat`; `JAVA_HOME` resolves to a JDK (`Test-Path "$JAVA_HOME\bin\java.exe"`); `ANDROID_HOME` set; if emulator requested, AVD exists. Fail fast with a human-readable error, HTTP 400/503.
2. **Assemble** — `spawn('gradlew.bat', [task, '--no-daemon', '--stacktrace', ...(offline ? ['--offline'] : [])], { cwd: projectDir, env: { ...process.env, JAVA_HOME, ANDROID_HOME } })`. Task comes from `{task: 'assembleDebug'|'assembleRelease', flavor?}` — with a flavor, compose `assemble<Flavor><Type>`. `--no-daemon` guarantees the child exits when the build ends (no orphaned JVM holding locks); never rely on the terminal route's 30 s timeout — builds routinely take minutes, so spawn directly and stream.
3. **Locate artifact** — after `exit` code 0, glob `**/build/outputs/apk/**/*.apk` under the project dir, newest first; prefer `<module>-<variant>.apk` matching the task (e.g. `app-debug.apk`). Return the absolute path. Debug APK is already signed + aligned — done.
4. **Align (release only, if signing manually)** — `zipalign -p 4 unsigned.apk aligned.apk` BEFORE signing. If AGP already ran zipalign (it does for AGP-built APKs), `zipalign -c -p 4` can verify instead. Rule: apksigner last.
5. **Sign debug** — nothing to do: AGP auto-signs with the debug key (`%USERPROFILE%\.android\debug.keystore`). For release, either (a) the project has a `signingConfig` (keystore.properties pattern) and `assembleRelease` signs during the build, or (b) manual: `apksigner sign --ks <keystore> --ks-key-alias <alias> --ks-pass env:AIDE_KS_PASS --key-pass env:AIDE_KEY_PASS --out <signed> <aligned>`. Passwords arrive via env vars only (`env:VARNAME` syntax keeps them out of the command line); the daemon must log a redacted command (replace `--ks-pass env:...` with `--ks-pass ***`) and never echo env values.
6. **Verify signature** — `apksigner verify --verbose <signed.apk>`; expect `Verified using v1 scheme` / `v2 scheme` lines and exit 0. Fail the build if verify fails.
7. **Boot emulator (headless)** — `spawn('emulator', ['-avd', avd, '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot', '-gpu', 'swiftshader_indirect'], { detached: true })` and keep the PID in manager state (`POST /api/android/emulator {action:'start'}`). Do NOT await exit — it stays alive. Track readiness separately.
8. **Wait for boot** — `adb wait-for-device`, then poll `adb shell getprop sys.boot_completed` until it returns `1` (trim CR; max ~300 s; report progress lines). This is the Playwright-verified pattern — `wait-for-device` alone is NOT boot.
9. **Install** — `adb -s <serial> install -r <apk>` (serial from `adb devices`; `-r` preserves data on reinstall). Expect `Success`.
10. **Launch** — `adb shell am start -W -n <package>/<activity>`; expect `Status: ok`. Package/activity may be parsed from the project's manifest or passed in the request.
11. **Capture logcat** — `adb logcat -d -t 500` (dump mode, last 500 lines) into the logs ring for the UI panel; streaming follow-up reads use `-T <last-timestamp>` for delta dumps. Optional filter from the request (`*:e`, `MyApp:D`).

## Daemon API contract (routes to CREATE — none exist)

Mirror the exact server.mjs registration style (`/api/training/*`, server.mjs:371-383) and the TrainingManager shape (daemon/training-manager.mjs: spawn, `logs` ring `slice(-100)`, `active`, `stop()` via SIGTERM, approval-gated `start`).

```
POST /api/android/build
  req:  { projectDir: string, task: "assembleDebug"|"assembleRelease"|string, flavor?: string, approved: true }
  200:  { jobId: string, status: "running", task: string }
  400:  { error: "..." }   // no gradlew.bat, unknown task, another job active
  503:  { error: "..." }   // JAVA_HOME/ANDROID_HOME missing

GET  /api/android/status
  200:  { active: { jobId, task, status: "running"|"succeeded"|"failed", startedAt } | null,
          logs: [ { jobId, line, at } ],        // ring, last 100, same shape as training logs
          lastArtifact: string | null }         // absolute path of last successful APK

GET  /api/android/logs?since=<index>
  200:  { since: number, logs: [ { jobId, line, at } ] }   // incremental for the UI poller

POST /api/android/install
  req:  { apkPath: string, deviceId?: string }            // deviceId = adb serial
  200:  { exitCode, stdout, stderr }
  400:  { error }  // apk missing, no device

GET  /api/android/devices
  200:  { devices: [ { serial: "emulator-5554", state: "device"|"offline", model: string|null } ] }

POST /api/android/emulator
  req:  { action: "start"|"stop"|"list", avd?: string, headless?: true }
  200:  start  → { status: "starting", pid, avd }
        stop   → { status: "stopped" }                    // kill PID; also `adb emu kill` fallback
        list   → { avds: [ string ] }                     // `emulator -list-avds`
  400:  { error }  // start: no such AVD

POST /api/android/sign
  req:  { apkPath, keystorePath, keyAlias }               // passwords via env ONLY: AIDE_KS_PASS, AIDE_KEY_PASS
  200:  { status: "signed", outPath, verified: true }     // apksigner verify must pass first
  400:  { error }

GET  /api/android/logcat?deviceId=<serial>&filter=<tags>&tail=<lines>
  200:  { lines: [ { at, tag, level, message } ] }          // parsed or raw lines; dump mode
```

Hard guards (same family as training): one build job at a time (`if (this.active) throw`); every build/install/sign requires `approved: true`; `stop` on a running build kills via SIGTERM only after explicit user confirmation; emulator start/stop are separate from build jobs and tracked independently.

## UI wiring SOP (mirror Phase 5 training-arena)

Current patterns to reuse verbatim:
- `trainingRequest(action, payload)` helper — app.js:883-890 (fetch to `/api/training/<action>`, sets `#training-status` text, `appendLog('TRAINING', error, 'warning')` on catch).
- Buttons wired at app.js:1143-1145 (`#training-verify`, `#training-stop` onclick handlers).
- Log rendering: `.terminal-output` pre blocks appended via `insertAdjacentHTML('beforeend', ...)` with `esc()` — app.js:364-405 (task + terminal run patterns).
- Every new element id must be referenced in JS — `node scripts/ui-audit.mjs` (currently 103 ids) is part of `npm run check`; add ids AND references or the audit fails.

Steps:
1. Add an ANDROID section to the RUN view (or a new activity-tab): `#android-output` (terminal-output style, scroll-contained), `#android-status` status line, and buttons: `#android-build` (BUILD DEBUG APK), `#android-build-release` (BUILD RELEASE APK, disabled until signing configured), `#android-install` (INSTALL TO DEVICE), `#android-emulator-start` / `#android-emulator-stop`, `#android-devices` (dropdown + refresh), `#android-logcat` (CAPTURE LOGCAT).
2. `androidRequest(action, payload)` helper — clone `trainingRequest`: `POST /api/android/${action}` with `{...payload, approved: true}`; surface `result.error` via `appendLog('ANDROID', message, 'warning')`; update `#android-status`.
3. Build flow: on `#android-build` click → `POST /api/android/build` → start a 2 s `setInterval` polling `GET /api/android/status`; keep a local `since` cursor; append only `logs` entries with index ≥ `since` into `#android-output` as `<pre class="terminal-output">${esc(line)}</pre>`, then `scrollIntoView`; on `status === 'succeeded'` show `result.lastArtifact` in `#android-status` and stop polling; on `failed` append a red `.terminal-output.error` with the exit code and stop. (Same pattern as the training status poller, app.js:895-900, but with delta-log streaming.)
4. Install flow: `#android-install` → `POST /api/android/install {apkPath: <lastArtifact>, deviceId: <dropdown value>}` → append stdout/stderr to `#android-output`.
5. Emulator flow: start/stop buttons → `POST /api/android/emulator`; after start, poll `/api/android/devices` until `emulator-5554`-style serial shows `device`, then auto-run the boot-wait + install + launch sequence, logging each step.
6. Logcat button → `GET /api/android/logcat` → append lines.
7. Console.log every action: `ANDROID_BUILD: <task> → exit <code>, <artifact>`; `ANDROID_EMULATOR: start <avd>`; `ANDROID_INSTALL: <serial> <apk>`.

## Safety rules (non-negotiable)

1. **Never commit keystores**: `*.jks`, `*.keystore`, `keystore.properties`, and `~/.android` content stay out of git (add to `.gitignore`). The `keystore.properties` file lives at the project root of the USER'S android project, not in this repo.
2. **Never sign with the release key in automated flows**: release signing runs only on explicit user action in the UI (never inside `assembleRelease` CI automation, never in a scripted loop). The debug key is the only key automation may touch.
3. **Passwords only via env vars**: `AIDE_KS_PASS` / `AIDE_KEY_PASS` (or `KSTOREPWD`/`KEYPWD` for gradle.properties-based projects); daemon logs are redacted (`--ks-pass ***`); never JSON-stringify an env containing secrets into logs.
4. **Zipalign before apksigner, never after** — post-sign changes invalidate the signature.
5. **One build at a time**; no mid-build kill without explicit confirmation (protects the daemon-owned child and avoids corrupt caches).
6. Never run `gradlew` through `/api/terminal/run` — the 30 s timeout kills long builds and the allowlist blocks it anyway; the manager owns all children and their kill/exit bookkeeping.

## Verification gates (exact commands + expected outputs)

Run on `fixtures/android-sample/` with a fresh `GRADLE_USER_HOME` seeded per the offline strategy above.

| # | Gate | Command | Expected |
|---|---|---|---|
| 1 | Toolchain | `& "$env:JAVA_HOME\bin\java.exe" -version` | `openjdk version "17..."` (JDK, not JRE) |
| 2 | Tasks visible | `.\gradlew.bat tasks --no-daemon` (cwd=project) | lists `assembleDebug`, `installDebug`, ... and `BUILD SUCCESSFUL` |
| 3 | Debug build | `.\gradlew.bat assembleDebug --no-daemon` | `BUILD SUCCESSFUL`; `Test-Path .\app\build\outputs\apk\debug\app-debug.apk` → `True` |
| 4 | Debug APK verified | `apksigner verify --verbose .\app\build\outputs\apk\debug\app-debug.apk` | exit 0; `Verified using v1 scheme: true` / `v2 scheme: true` |
| 5 | Release signed manually | `zipalign -p 4 <unsigned>.apk aligned.apk` then `apksigner sign --ks test.jks --ks-key-alias test --ks-pass env:AIDE_KS_PASS --out signed.apk aligned.apk` | exit 0; `apksigner verify --verbose signed.apk` exit 0 |
| 6 | No secrets in logs | grep daemon log for the keystore password string | no match |
| 7 | Headless boot | `emulator -avd <avd> -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect` + poll `adb shell getprop sys.boot_completed` | boot_completed → `1` within bound; `adb devices` shows `<serial> device` |
| 8 | Install + launch | `adb -s <serial> install -r <apk>` then `adb shell am start -W -n <pkg>/<activity>` | `Success`; `Status: ok` |
| 9 | Logcat capture | `adb logcat -d -t 200` | ≥1 log line returned |
| 10 | Daemon E2E | start daemon; POST `/api/android/build` → poll status → `lastArtifact` non-null; logs contain streamed gradle lines; second concurrent build rejected with 400 | all assertions pass |

Manager unit test mirroring the house style: `daemon/test-android-manager.mjs` with injected fake spawn (same pattern as `daemon/test-training-manager.mjs`) asserting: approval required, single-job guard, log ring cap, artifact glob, redacted sign command.

## Audit checklist

- [ ] `daemon/android-manager.mjs` exists; exposes `build/status/install/devices/emulator/sign/logcat`; approval-gated; single-job guard; SIGTERM stop.
- [ ] Routes registered in `server.mjs` matching the contract above (exact JSON fields).
- [ ] `daemon/test-android-manager.mjs` passes (fake-spawn based, like test-training-manager.mjs).
- [ ] `fixtures/android-sample/` exists with committed wrapper (`gradlew.bat`, `gradle/wrapper/*`) and builds on this machine.
- [ ] Offline strategy DECIDED (pre-bundled `%USERPROFILE%\.gradle` copy vs opt-in first-run download) and documented; `--offline` flag consistent with it.
- [ ] UI ids (`#android-*`) all present in `index.html` AND referenced in `app.js` — `node scripts/ui-audit.mjs` still passes (103+).
- [ ] `npm run check` passes; no keystore/`keystore.properties`/`.jks` in git status.
- [ ] Gates 1-10 above green on the sample project.
- [ ] `ANDROID_BUILD:`/`ANDROID_EMULATOR:`/`ANDROID_INSTALL:` console logs present.

## Sources

- Build from the command line: https://developer.android.com/build/building-cmdline
- Configure build variants: https://developer.android.com/build/build-variants
- Gradle build overview: https://developer.android.com/build/gradle-build-overview
- Build for release: https://developer.android.com/build/build-for-release
- apksigner: https://developer.android.com/tools/apksigner
- zipalign: https://developer.android.com/tools/zipalign
- Sign your app (keystore.properties, upload key, debug.keystore): https://developer.android.com/studio/publish/app-signing
- Start the emulator from the command line: https://developer.android.com/studio/run/emulator-commandline
- adb: https://developer.android.com/tools/adb
- logcat: https://developer.android.com/tools/logcat
- Environment variables (ANDROID_HOME, ANDROID_SERIAL, AVD homes): https://developer.android.com/tools/variables
- Gradle CLI: https://docs.gradle.org/current/userguide/command_line_interface.html
- Gradle Daemon (--no-daemon, JAVA_HOME, org.gradle.java.home): https://docs.gradle.org/current/userguide/gradle_daemon.html
- Dependency caching + --offline + cache portability: https://docs.gradle.org/current/userguide/dependency_caching.html
- Gradle build environment (JAVA_HOME priority): https://docs.gradle.org/current/userguide/build_environment.html
- Playwright AVD boot-wait pattern (wait-for-device + boot_completed poll): https://github.com/microsoft/playwright/blob/main/utils/avd_start.sh
- gradle/actions setup-gradle (cache seeding + daemon stop before Windows cache moves): https://github.com/gradle/actions/blob/main/docs/setup-gradle.md
- Gradle javaHome error on Windows: https://github.com/gradle/gradle/issues/18092