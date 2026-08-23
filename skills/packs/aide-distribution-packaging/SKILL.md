# AIDE Distribution & Packaging (download -> install -> update)

How AIDE gets onto ANY machine fast, cheap, and trustworthy. Complements aide-arch-packaging-release (shell decision, offline bundling, sha256 verification, first-run smoke) and aide-packaging-offline (model file placement). This skill covers installer target selection, signing reality, GitHub Releases distribution, updater design, and the release-pipeline shape. Grounded 2026-08-22 in electron-builder target-selection docs, Tauri bundler internals, electron-updater/GitHub Releases practice, Antigravity production-distribution lessons (staged rollout, MotW trap, updater error semantics), RAXXO indie distribution data.

## Target Selection (decision tree, Windows-first)
- DEFAULT: NSIS `.exe` per-user install — consumer standard, no admin required, electron-updater compatible.
- `portable` single `.exe`: zero-install demo/sponsor-review build — "download, double-click, it runs". Ship alongside installer for evaluation. No auto-update (manual).
- `nsis-web` stub installer ONLY if total payload grows past ~500MB (models are NOT bundled by default — they download on first run per packaging-offline; revisit only if that decision reverses).
- MSI/MSIX/AppImage/dmg: later, when enterprise/mac/linux demand exists. Do not maintain targets nobody downloads.

## Code Signing Reality Matrix
| Stage | Signing | Consequence |
|---|---|---|
| Now (dev audience) | Unsigned Windows + unsigned macOS | SmartScreen/Gatekeeper warnings; publish clear one-time workaround instructions (right-click > Open; More info > Run anyway). RAXXO evidence: no measurable conversion loss with developer audiences |
| Sponsors/public traction | EV/OV Windows cert + Apple Developer ($99/yr) + notarization | Warnings gone; macOS silent auto-update REQUIRES signed builds |
Rule: never zip a signed `.exe` — Mark-of-the-Web resets SmartScreen reputation even for signed binaries (3-week lesson from the field). Distribute installers directly.

## Distribution Channel
- GitHub Releases is the primary channel for now: free, versioned, integrates with electron-updater, zero infrastructure. Tag push -> CI builds artifacts -> attach NSIS exe + portable exe + SHA256SUMS + latest.yml (updater manifest).
- Later migration path (only if needed): Cloudflare Worker + R2 for staged rollout and egress cost control — pattern documented, not built until a measured need exists.

## Updater Design (when auto-update lands)
1. Manifest check on startup, deferred AFTER first paint (perf skill). Update server errors must degrade QUIETLY: return "no update" semantics on failure, never surface error dialogs for background checks (204-not-500 doctrine).
2. Delta updates via electron-updater blockmap where supported; measure actual delta size per release.
3. Staged rollout: percentage flag in manifest (10% -> 50% -> 100%). Rollback = repoint manifest to previous versioned key; artifact URLs immutable, binaries never deleted.
4. Signing keys generated ONCE, backed up; rotation ships transitional dual-signed release (key change otherwise bricks every existing install's updates).
5. Update test battery before ANY release claim — five cases against a local mock server: same-version (no-op), minor, major, key-mismatch (reject), network-disconnected (silent).

## Release Pipeline Shape (stage-separated, fail-independent)
Build -> Sign -> Package -> Upload artifacts -> Publish manifest. Each stage a separate CI job consuming prior artifacts; manifest publish LAST so a failed sign/notarize never announces anything. Desktop bad releases sit on user machines until relaunch — conservatism is the default posture.

## Size Discipline
- Measure OUR OWN release artifacts each release: installer MB, portable MB, installed footprint, cold-start seconds. Record in AGENT_NOTES release entry. Never quote generic framework numbers publicly — measure ours.
- Production deps only in packaged app (misconfigured build.files can double size); devDependencies never ship.
- Models stay OUT of installers (first-run download w/ sha256 verify per packaging-offline); portable eval build may optionally point at a models-dir env var instead of embedding.

## Verification Gates
1. Fresh-VM/clean-profile install smoke: download -> install -> launch -> open workspace -> offline confirm (no network calls beyond opted-in).
2. Portable build runs from a USB-style path without writing outside its dir.
3. Updater battery (5 cases) green on mock server before enabling update checks in any shipped build.
4. SHA256SUMS published and spot-verified on a second machine.
5. Uninstall leaves workspace/user data intact; reinstall preserves settings (NSIS per-user mode verified).
