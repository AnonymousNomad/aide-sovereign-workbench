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

## Known Upstream Advisory

The desktop GTK dependency currently pins `glib` below the patched `0.20.0` release. Dependabot's attempted upgrade is incompatible with GTK 0.18 and fails CI. The issue is tracked as an upstream dependency constraint; AIDE does not suppress the security alert or claim the dependency is fixed.
