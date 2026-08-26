---
name: aide-android-build
description: Android build integration for AIDE — Gradle wrapper detection, APK build/debug/install via task service, emulator control, logcat streaming. Requires JDK 17+ and Android SDK with build-tools/platforms. Use when adding Android development support to the cockpit.
---

# Android Build Integration

## Current State (honest)

This machine has:
- Android SDK cmdline-tools + licenses at %LOCALAPPDATA%\Android\Sdk
- NO build-tools, platforms, or emulator installed
- NO JDK installed system-wide
- NO Gradle on PATH

To build Android apps, the operator must first install:
1. JDK 17+ (`winget install Microsoft.OpenJDK.17` or download from adoptium.net)
2. Android SDK build-tools + platform (via sdkmanager from cmdline-tools)
3. Gradle wrapper (comes with any Android project)

AIDE detects these at boot and shows setup guidance if missing — never a silent failure.

## Architecture

When properly configured, AIDE provides:
- **Build**: `gradlew assembleDebug` via task service → APK output path surfaced
- **Install**: `adb install -r app-debug.apk` to connected device/emulator
- **Logcat**: stream filtered by package name into terminal drawer
- **Test**: `gradlew testDebugUnitTest` → results parsed to rail badge
- **Emulator**: `emulator -avd <name>` launch/control (if emulator installed)

## Task Service Integration

Android build commands run through the existing task service:
- Build: `{program: "gradlew.bat", args: ["assembleDebug"], cwd: "<project-root>"}`
- Test: `{program: "gradlew.bat", args: ["testDebugUnitTest"], cwd: "<project-root>"}`
- Clean: `{program: "gradlew.bat", args: ["clean"], cwd: "<project-root>"}`

Gradle wrapper (gradlew.bat) is project-local — no global Gradle install needed.
JDK must be on PATH or JAVA_HOME set.

## Detection

At boot or workspace open, detect Android projects by:
- Presence of `build.gradle` or `build.gradle.kts` in workspace root or subdirectories
- Presence of `gradlew.bat` / `gradlew`
- If found: show ANDROID section in MODELS panel with BUILD/TEST/CLEAN buttons

If JDK/SDK missing: show setup wizard with exact commands (never silent failure).

## Pitfalls

- gradlew.bat requires JAVA_HOME or java on PATH — detect and guide
- Android SDK licenses must be accepted: `sdkmanager --licenses`
- First Gradle build downloads dependencies (~500MB+) — warn operator about network/disk usage
- gradle daemon stays running after build — kill it on AIDE shutdown to free RAM
- Windows path length limit (>260 chars) can break Gradle — recommend short project paths
