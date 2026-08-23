---
name: aide-ide-research
description: Master research skill for building the AIDE offline IDE (aide-sovereign-workbench). Encodes what Big Tech does for IDE architecture and offline model integration, and routes every feature decision to the phase skills. Use at the START of any AIDE task, before writing any code, when deciding how a feature must work, and when a feature request conflicts with verified practice.
---

# AIDE IDE Research Doctrine (Master Skill)

AIDE = offline-first IDE: VS Code + GitHub + Android Studio in one sovereign workbench, packaged with 3 pre-installed GGUF models, zero cloud dependencies.

## The Research Base (verified from primary sources)

1. **Two-process IDE architecture (Eclipse Theia docs)**: a desktop IDE is TWO processes — a browser frontend (renders UI, may assume browser APIs only) and a Node.js backend (filesystem, spawns processes, HTTP server that also serves the frontend). They communicate via JSON-RPC over WebSockets or REST over HTTP. AIDE already mirrors this: `Desktop/frontend/` (browser) + `daemon/server.mjs` (Node, ports 4173 UI / 4777 API). Never put filesystem/process code in the frontend.

2. **Editor is MVVM (VS Code Monaco design doc)**: Model (file content, tokens, markers) is UI-independent; ViewModel (selection, cursor, tab rendering) bridges Model and DOM View; both are EventEmitters. Views never talk to the Model directly. AIDE's editor must keep state in JS objects, not in DOM, or it breaks.

3. **Debugging via DAP (VS Code debugger-extension guide)**: a generic debugger UI talks to a Debug Adapter (DA) — a standalone process speaking the Debug Adapter Protocol over stdin/stdout (or a server on a port, or an in-process object). Contribution points declare `debuggers`, `configurationAttributes`, `initialConfigurations`. AIDE's existing DAP adapters (TypeScript/Python) already follow this.

4. **Terminal (Theia DeepWiki)**: xterm.js in the frontend streams I/O over WebSocket to a backend that wraps a real shell via node-pty. Never fake a terminal in the DOM; spawn real processes.

5. **Local model serving (llama.cpp server README + production guides)**: llama-server / `python -m llama_cpp.server` exposes an **OpenAI-compatible API** at `/v1` (chat completions, completions, embeddings, models). Any OpenAI SDK works by changing `base_url` to `http://127.0.0.1:PORT/v1`. Bind to `127.0.0.1` only (no auth built in). Model + KV cache must fit memory; on this GTX 1060 (6GB, no Tensor Cores) use `-n_gpu_layers 0` (CPU-only). Symptoms: gibberish/never-ending output = chat-template mismatch → pass `--jinja`/`--chat-template`; first-request latency is normal → warmup; slow generation is expected on CPU → generous client timeouts. Verify a server with `GET /v1/models` before trusting it.

6. **Offline packaging (Multigrid model-shipping doctrine + Tauri/Electron docs)**: model weights live BESIDE the app bundle (Windows: `%LOCALAPPDATA%\<app>\models\`), never inside the signed installer when >~200MB. Every release must not re-ship 1.9GB of weights. Verify models with SHA-256 shipped in the app; atomic swap sequence (download `.partial` → hash → rename → smoke test with a fixed prompt → switch manifest → delete old). NSIS installers cap individual files at 2GB — use MSI or split for larger. Tauri bundles extra files via `bundle.resources`; Electron must exclude models from `asar`. For truly offline installs, embed the WebView2 offline installer (Tauri `webviewInstallMode: offlineInstaller`, ~127MB).

7. **Android build (Android developer docs)**: Gradle wrapper (`gradlew.bat`) is the CLI entry; `assembleDebug` builds a debug APK (auto-signed with debug key, `zipalign`ed), `installDebug` builds+installs to emulator/device; release signing = `keytool` keystore + `apksigner` + `zipalign`, configured in `build.gradle.kts` via a properties file (never commit passwords); emulator = `emulator -avd <name>` + `adb install`. Build types × product flavors = build variants.

8. **Theia DI containers + contribution points (Theia services-and-contributions + extensions docs)**: Theia extensions are npm packages exposing `ContainerModule` DI modules that contribute to the application's dependency-injection container; contribution points (commands, menus, keybindings, preferences, widgets) are declarative registrations resolved by the framework. The DI-container model is why Theia can reshape anything at compile time, while VS Code extensions are restricted to the declarative contribution surface at runtime. AIDE phase 9: contribution registry in the daemon, DI-style service wiring only where the VS Code API surface is insufficient. Source: https://theia-ide.org/docs/services_and_contributions/

9. **Protocol-based integration standard (LSP/DAP/MCP)**: Theia and VS Code converged on protocols as the integration seam — LSP for language features, DAP for debugging, MCP for AI tools — each a standalone process/JSON-RPC peer, never in-process code. Theia AI was one of the first tools to support MCP and gained GA in March 2025 (TheiaCon 2025 keynote). AIDE already mirrors this (lsp-manager, dap-manager); phase 9 extensions must contribute MCP servers, not in-process tool code. Sources: https://eclipsesource.com/blogs/2025/11/18/theiacon-2025-eclipse-theia-project-update/ and https://theia-ide.org/docs/language_support/

10. **Extension ecosystem = the decisive lever; Open VSX offline mirroring**: VS Code's moat is its extension ecosystem, not the editor; Theia proves a compatible IDE can run the same ecosystem via Open VSX as default marketplace with `VSX_REGISTRY_URL` pointing at a custom registry, proxy, or cache to go offline. AIDE phase 9 replicates this exactly: configurable registry base URL, local vsix cache, static mirror index — offline-first marketplace. Sources: https://theia-ide.org/docs/extensions/ and https://github.com/eclipse-theia/theia/blob/master/packages/vsx-registry/README.md

11. **AI-native IDE patterns (TheiaCon 2025 + Theia AI docs)**: the 2025 AI-native IDE standard = MCP context injection (agents get tools from MCP servers grouped by server), visual diff editors for agent-made changes, and session management (Sessions view with Active/Restored tree, delegated sub-sessions nested under parents), plus agent-to-agent delegation and tool-call confirmation UI. AIDE phase 9: extensions contribute MCP servers; operator applies agent changes as reviewable diffs; session store already exists (SessionStore) and maps to the Sessions-view pattern. Sources: https://theia-ide.org/docs/user_ai/ and https://eclipsesource.com/blogs/2025/12/09/theiacon-2025-beyond-coding-ultimate-ai-native-ide-demo/

12. **Diagnostics: document = push, workspace = pull (dbaeumer / microsoft/vscode#112501)**: VS Code's diagnostics architecture is asymmetric — document-scoped diagnostics are PUSHED by the language server (`textDocument/publishDiagnostics`, streamed file-by-file, client shows what it has) while workspace-scoped diagnostics are PULLED with result-id delta encoding (`provideWorkspaceDiagnostics` + `provideWorkspaceDiagnosticsEdits`, aborts, busy re-trigger). Rationale: the extension cannot know which files are visible or whether a problems view exists, so pushing per-file is simpler and prioritizes open files; pulling for the whole workspace is needed for inter-file errors (file A breaks file B). AIDE decision (2026-08-19): implement document diagnostics as PUSH via the existing `diagnostics` WS event channel (matches our fail-closed event hub); DO NOT build the workspace pull/delta model — hundreds of diagnostics is normal, ten-thousands is not worth delta encoding for a local IDE. Markers are the only UI (no problems view yet). Source: https://github.com/microsoft/vscode/issues/112501

13. **VS Code contribution layering (microsoft/vscode wiki, Source Code Organization + Roadmap)**: the workbench contributes search/git/debug/etc. as isolated `vs/workbench/contrib/*` packages, each exposing its internal API from a single file (e.g. `contrib/search/common/search.ts`), entry points split desktop/web/common. Roadmap priorities relevant to AIDE: unified fast file watching (needed by diagnostics + git), improved smoke/e2e testing (failure paths), LSP refinement. AIDE decision: port legacy lsp-manager/dap-manager into `node/src/services/` as single-file-service contributions mirroring the contrib pattern; a native file watcher (ReadDirectoryChangesW on Windows) is a Phase 5 sub-item, not Phase 4.

## Rules (non-negotiable)

- R1: Every AIDE feature implementation must load the matching phase skill and follow its SOP. Phase skills: aide-phase1-model-runtime, aide-phase2-view-switching, aide-phase3-editor-core, aide-phase4-git-integration, aide-phase5-training-arena, aide-phase6-tutor-mode, aide-phase7-community-hub, aide-phase8-android-build, aide-phase9-extension-host, aide-packaging-offline.
- R2: Facts come from the research base above or from re-verification (ask-dont-circle: 3 sources for anything contested). Never invent API shapes — OpenAI-compatible is the contract, verify with curl.
- R3: Verify-first: no "done" without observed output (a log line, a curl response, a console log). Tests must run against the real daemon and real model servers.
- R4: Offline-only: any feature that would require a cloud call must have a local-first equivalent or be rejected.
- R5: Ports 4173 (UI) / 4777 (daemon) / 8081 (qwen 1.5B) / 8082 (smollm2 360M) / 8083 (qwen 0.5B) are the AIDE contract — the manifest `models/manifest.json` is the source of truth for model IDs, lanes, and endpoints.

## SOP — starting any AIDE task

1. Read `E:\aide-sovereign-workbench\AGENT_NOTES.md` (this project's journal) first.
2. Identify the phase → load that phase skill → follow its steps + acceptance gates.
3. State the expected result, run it, quote the actual output (verify-first-discipline).
4. Log every change/decision in AGENT_NOTES.md (agent-notes protocol).