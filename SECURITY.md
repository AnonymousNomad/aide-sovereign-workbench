# Security Policy

## Scope

Report vulnerabilities in the daemon, model manager, patch application, plugin host, LSP/DAP process boundaries, or release tooling.

## Do Not Publish

Never include access tokens, private keys, credentials, private source, unredacted CaseFiles, model training data, or local checkpoint paths in issues or pull requests.

## Design Requirements

- Bind local services to loopback by default.
- Allowlist commands, model paths, language servers, and debugger adapters.
- Keep private community data local unless the user explicitly changes its boundary.
- Treat model output, plugins, dependencies, and imported artifacts as untrusted.
- Require diff review and user approval before writes or publication.
- Treat capsules as metadata by default; source/evidence export must be explicit and encrypted.

## Known Upstream Advisory (accepted, tracked, not suppressed)

The Linux desktop build pins `glib 0.18.5`, which is affected by a moderate
unsoundness advisory in `VariantStrIter` (glib < 0.20).

- Advisory: RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g
- Chain: `tauri 2.11.5 → tauri-runtime-wry → wry 0.55.1 → tao 0.35.3 →
  gtk 0.18.2 → glib ^0.18`
- Why it cannot be upgraded in place: the `gtk` crate (gtk3) is EOL at 0.18 and
  hard-pins `glib ^0.18`; the patched `glib >= 0.20` ships only via `gtk4-rs`,
  which Tauri has not yet adopted (upstream migration tracked at
  https://github.com/tauri-apps/tauri/issues/12561, PR #14684).
- Scope: Linux build target only. This machine's primary runtime (Windows)
  never links gtk3, and the advisory is a soundness defect, not a remotely
  exploitable vulnerability.
- Re-check procedure: after each Tauri/wry release, run
  `cargo update && cargo tree -i glib`; when glib resolves to >= 0.20, upgrade
  and this section is removed.
- AIDE does not suppress the Dependabot alert and does not claim the dependency
  is fixed; it is recorded here as an accepted, upstream-blocked constraint.
