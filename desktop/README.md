# AIDE Desktop Shell Plan

The production desktop target is a lightweight native shell around the existing web workbench and the local daemon.

## Boundary

- **UI:** editor, panels, community views, model lanes, and user approvals.
- **Daemon:** filesystem, Git, terminal/task broker, model process lifecycle, workspace trust, audit log, and encrypted-sync adapters.
- **Model runtimes:** separate localhost processes using the AIDE model contract.
- **Community transports:** optional direct peers or user-selected relays; disabled by default.

Tauri is the intended shell because it can provide a smaller offline desktop package than an Electron-only implementation. This environment does not currently have Rust/Tauri installed, so the daemon is the runnable first boundary. Do not label a Tauri binary available until it is compiled and smoke-tested on each target platform.

The Tauri CLI is now pinned in the root package and the Rust project lives in `desktop/`. `desktop/prepare.mjs` stages only approved frontend assets, avoiding `node_modules` and build artifacts. Use `npm run desktop:dev` after installing platform prerequisites, or `npm run desktop:build` for a release build. A compiled binary is not claimed until that command succeeds on the target platform.

The core desktop package includes the model manifest but does not bundle GGUF weights. For a local weight-inclusive pack, set `AIDE_INCLUDE_MODEL_WEIGHTS=1` before `desktop:prepare` or `desktop:build`; this is intentionally not used by the release CI workflow.

## Shell Acceptance Gates

- Launches without network access.
- Restores workspace and unsaved editor state.
- Shows workspace trust before enabling tools.
- Starts and stops local model runtimes.
- Routes filesystem and Git operations through the daemon.
- Requires approval for writes, commands, sync, and publishing.
- Recovers from daemon/model crashes without losing local edits.
