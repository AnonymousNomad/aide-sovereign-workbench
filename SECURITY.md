# Security Policy

## Scope

Report vulnerabilities in the daemon, model manager, patch application, community store, CaseFile handling, LSP/DAP process boundaries, or release tooling.

## Do Not Publish

Never include access tokens, private keys, credentials, private source, unredacted CaseFiles, model training data, or local checkpoint paths in issues or pull requests.

## Design Requirements

- Bind local services to loopback by default.
- Allowlist commands, model paths, language servers, and debugger adapters.
- Keep private community data local unless the user explicitly changes its boundary.
- Treat model output, plugins, dependencies, and imported artifacts as untrusted.
- Require diff review and user approval before writes or publication.
