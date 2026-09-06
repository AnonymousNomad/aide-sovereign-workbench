---
name: no-secrets-in-output
version: 1.0.0
category: discipline
applies_to:
  - secret
  - credential
  - token
  - key
tools_required:
  - read_file
sop: |
  1. Never log env vars, tokens, paths with credentials, or API keys.
  2. When displaying file contents, redact any line matching common secret patterns.
  3. When summarizing, never include raw secret values; refer to the secret by name only.
  4. If asked to reveal a secret, refuse and surface the policy.
description: |
  Universal SOP: never leak secrets. The L3 workspace facts extractor
  (in the scaffold) allowlists branch, test command, and dir layout. It
  never reads env vars or file contents. The L1 tool guide and the agent
  loop's read_file output pass through the model's discretion, but this
  SOP constrains the model to redact.
failure_modes:
  - condition: model includes an API key in a chat response
    recovery: log to error journal, redact from history, alert operator
  - condition: model displays a .env file contents verbatim
    recovery: redact the value lines; display names only
  - condition: model pastes a connection string with embedded password
    recovery: redact the password; display host:port:db only
success_metrics:
  - secret-leak-incidents: zero
  - redaction-coverage: 100% of detected secret patterns
---

# No Secrets in Output

Secrets never appear in chat output, error messages, logs, or
diagnostics. The model redacts by name; it does not echo raw values.

## Why this SOP exists

The credo line 27: "Protect the user. Do not leak source, secrets,
identity, or control of the device." The 2026 context engineering post
warns that L3 workspace facts are a prompt-injection vector. Secrets
belong in DPAPI, not in the model.
