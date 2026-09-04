# AIDE Packaging And Installation Decision

Status: research and source audit, 2026-09-03

## Decision

Use one canonical native distribution and two deliberately different delivery
options:

1. **Primary:** Tauri v2 per-user NSIS installer for Windows, with the app,
   Node runtime, daemon resources, and frontend included, but no GGUF weights.
2. **Portable fallback:** a versioned ZIP containing the same prepared app
   resources, with a first-run check for WebView2 and writable directories.
3. **Model delivery:** separate versioned model packs, each with a manifest,
   SHA-256 file, fit metadata, and a first-run import/verify flow.

WinGet can be added after the NSIS artifact is stable because Microsoft requires
a silent installer, metadata, and installer SHA-256 in the package manifest.
MSIX is a later enterprise/store artifact, not a second primary runtime path.
Electron is not maintained in parallel: the official Electron documentation
confirms that it adds its own runtime/package distribution path, while the
existing AIDE code and tests already target Tauri.

## Research Basis

- Tauri officially supports Windows NSIS `.exe` and WiX MSI installers. Its
  default per-user NSIS mode avoids administrator elevation; `offlineInstaller`
  embeds WebView2 for disconnected installs. Sources:
  <https://v2.tauri.app/distribute/windows-installer/> and
  <https://v2.tauri.app/develop/resources/>.
- Tauri resource maps copy files outside the embedded frontend into `$RESOURCE`
  and preserve or explicitly map paths. Large or executable files must be
  resources, not frontend content.
- Microsoft documents WebView2 Evergreen as the normal shared/updateable mode
  and the standalone installer for offline deployment. Source:
  <https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution>.
- Microsoft documents MSIX package identity, signed block maps, differential
  updates, and clean install/uninstall. Source:
  <https://learn.microsoft.com/en-us/windows/msix/overview>.
- Microsoft documents WinGet manifests with installer type, silent install
  support, URL, and `InstallerSha256`. Source:
  <https://learn.microsoft.com/en-us/windows/package-manager/package/manifest>.
- GitHub Releases supports versioned release assets and requires each asset to
  be under 2 GiB. Source:
  <https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases>.
- Electron recommends Electron Forge or a separately packaged Electron runtime;
  its official packaging page documents the additional prebuilt runtime and
  `asar` distribution path. Source:
  <https://www.electronjs.org/docs/latest/tutorial/application-distribution>.

## Why This Is Faster

- The core installer does not carry the roughly 1.9 GB model payload.
- A user can install and open the shell before choosing a model pack.
- A small starter model pack can be downloaded/imported independently from a
  larger coding pack.
- Updates replace the app artifact without redownloading model weights.
- Portable ZIP is useful for no-admin, removable-drive, and evaluation use.
- WinGet provides a familiar install/update channel after the release artifact
  is proven, but it is not the offline path.

## Required Artifact Set

```text
<product>-setup-<version>-x64.exe       # signed NSIS installer
<product>-portable-<version>-x64.zip    # same resources, no registry install
<product>-models-starter-<version>.zip  # optional small model pack
<product>-models-coding-<version>.zip   # optional larger model pack
SHA256SUMS                               # app and model pack hashes
SBOM.spdx.json                           # dependency inventory
release-notes.md                         # limits and verified gates
```

Every artifact gets a reproducible version, size, SHA-256, platform, and
verification record. Models are not committed to Git or embedded in the core
installer.

## First-Run Flow

1. Check WebView2 and show one actionable recovery message if missing.
2. Create writable user state and model directories outside the install path.
3. Run the local doctor: runtime, disk, RAM, backend, and model-manifest checks.
4. Offer `Import model pack` or `Import GGUF`; do not auto-download weights.
5. Validate architecture, tokenizer/template, SHA-256, fit, and model identity.
6. Offer a measured benchmark only when no other model/training workload is
   active; show pp512 and tg128 separately.
7. Start the selected local model and verify `/v1/models` identity plus a real
   chat response before showing `READY`.
8. Advance the onboarding checklist only after the user actually opens a file,
   runs a task, reviews a diff, and sees a fresh verification result.

## Current Packaging Defects

The source audit found concrete defects that block a release claim:

- `desktop/tauri.conf.json` has `resources: []`, so the Rust shell's expected
  `resource_dir/runtime/node.exe` and `resource_dir/daemon/server.mjs` are not
  packaged as loose resources.
- `desktop/prepare.mjs` copies daemon data into `frontend/`, omits root
  `assets/` and `skills/`, and currently permits stale/corrupt non-GGUF model
  files into the staged model directory.
- `desktop/frontend/index.html` requests `/assets/monaco/...`, but the prepared
  desktop tree does not currently contain `assets`.
- `desktop/src/main.rs` starts only the legacy daemon, points
  `AIDE_WORKSPACE` at the resource directory, and does not pass a writable
  `AIDE_MODEL_DIR`.
- `desktop/frontend` differs from the current root UI and does not contain all
  current panels or the current generated assets.
- `scripts/desktop-lifecycle-smoke.ps1` does not yet verify model status, model
  identity, a real chat response, or the portable artifact.

## Resource-Staging Slice Result

The 2026-09-03 preparation slice corrected the first three defects above:

- `desktop/prepare.mjs` now stages the embedded UI separately from loose
  daemon/runtime resources and copies the real `assets/` and `skills/` trees.
- Recursive model staging excludes `.gguf`, `.safetensors`, `.bin`, and
  `.corrupt` files from the core package by default.
- `desktop/tauri.conf.json` maps `desktop/resources/` to `$RESOURCE` and uses
  Tauri's offline WebView2 installer mode.
- `desktop/src/main.rs` now fails loudly when required Node/daemon resources are
  missing, uses writable per-user workspace/model directories, and tree-kills
  the daemon on Windows exit.
- Positive preparation with the verified local engine input passed; staged
  resources contained `123` files, including daemon, Node, llama-server, and
  model manifest. The supplied and staged llama-server SHA-256 values matched:
  `E3F35520CA9DCB448FC5471C881DC55059A0E5622B832213745C8E5BB71A560E`.
- The required-runtime negative probe failed closed with the expected missing
  `llama-server.exe` error, then the positive tree was restored and verified.

Still open: Rust/Tauri compilation (`cargo` is not installed on this machine),
the installed-app/portable/offline smoke, model provisioning into the user
directory, and model status/chat verification. The packaged TS/legacy/facade
topology is now staged and verified locally through the embedded Node runtime on
ephemeral ports by `npm run desktop:verify`.

## Packaging Acceptance Battery

### Static and preparation gates

- `npm ci` from a clean checkout.
- `npm run desktop:prepare`.
- `npm run desktop:verify` proves required UI, daemon, runtime, assets, skills,
  manifest, and no unintended weights/corrupt artifacts.
- Tauri config validation proves `resources`, install mode, target, and paths.
- SHA-256 checks prove staged runtime/manifest artifacts match the release input.

### Installed-app gates

- Silent install into a clean Windows profile.
- Installed executable is found through the Uninstall registry entry.
- App launches without network access.
- Daemon binds only to loopback and returns health 200.
- Model status contains the expected model IDs and honest availability.
- A real local chat response is returned after model warmup.
- Close, same-version reinstall/upgrade, and uninstall leave no daemon/runtime
  processes or stale app files.

### Portable gates

- Extract ZIP to a path containing spaces.
- Launch without administrator rights.
- Use a writable user-state/model directory outside the extracted tree.
- Run health, model import, chat, close, and restart probes.
- Delete the extracted tree and confirm no state outside the documented user
  directory is incorrectly required.

### Offline gates

- Disable network before install and first run.
- Confirm WebView2 offline path or a clear installed-runtime prerequisite.
- Confirm zero outbound connections at boot.
- Confirm local chat, files, tasks, and verification still work.
- Corrupt one model file and confirm only that model is disabled with the exact
  hash-mismatch reason while the application remains usable.

## Naming Gate

The product should not ship under `AIDE` as its public primary name because it
is too close to Aider. A final name must pass all of these checks before a mass
rename:

- no material collision with an IDE, coding agent, model, or developer platform;
- available repository/package/installer identifier;
- domain and social handle audit recorded separately;
- pronounceable, searchable, and not dependent on the internal `AIDE` acronym;
- supports a technical descriptor such as `local-first verified development
  workbench` without implying unsupported superiority.

Initial research rejected `Creed`, `ThreadForge`, `Proofline`, `Nexthread`,
`Forgepath`, `Workstrand`, and `Keel` as immediate choices because each already
has material software, service, or product collisions. In particular,
<https://creed.md/> is already a context product, so `Creed Aide` and
`Developer's Creed` would be confusingly close to an existing category product.
This is not a trademark opinion; a candidate remains provisional until a formal
name search is recorded.

`Developer's Creed` remains a good name for AIDE's internal operating document
and harness layer. It should not be treated as the final public product name
until the operator selects a distinct brand.

No public README or package identifier is renamed until the operator selects a
candidate and the collision audit passes.
