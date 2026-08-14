# Veritas Harness

Veritas is AIDE's evidence layer for model-assisted development. It turns the
developer credo into executable gates: a model may propose work, but the harness
does not present that work as verified until deterministic checks pass.

## Product Thesis

AI coding tools make implementation faster, but they move the bottleneck to
review and trust. Veritas fills that gap by making every claim answer a simple
question: what proves this?

## Developer Credo

The credo is inspired by disciplined craft traditions: protect the vulnerable
boundary, keep your oath, finish the trial, preserve the clan's knowledge, and
adapt without losing the core principles. In code, those become:

- protect the user, workspace, credentials, and device
- preserve existing user work
- prefer small reversible patches
- verify with tests, typechecks, parsers, and source evidence
- abstain when proof is missing
- leave a report the next developer can use

## Evidence Classes

| Task class | Required evidence |
| --- | --- |
| `explanation` | 90% evidence or explicit uncertainty |
| `code-change` | 90% evidence plus patch, compile/typecheck, tests, and diff checks |
| `security-or-publish` | 98% evidence plus independent review and reproducible artifacts |
| `payment-or-identity` | 98% evidence plus human approval and provider confirmation |

The percentages are evidence thresholds, not model self-confidence. A model
saying it is certain does not increase the score.

## CLI

```bash
npm run veritas
npm run veritas -- --report
npm run veritas -- --report --task-class security-or-publish
npm run veritas -- --report --output artifacts/veritas.md
npm exec aide-veritas -- --report
```

The report includes status, threshold, blocking checks, credo impact, and an
evidence ledger. If a gate fails, Veritas returns `abstain-needs-evidence` and
names the missing proof.

The repository also exposes `aide-veritas` as a package binary for local
development.

## Current Gates

- `path-boundary`: changed files must stay inside the workspace
- `secret-scan`: common API keys and private keys must not appear in source
- `manifest-validation`: required JSON manifests must parse
- `compile`: `npm run check`
- `tests`: `npm test`
- `git-diff`: `git diff --check` when the workspace is a Git repository

## Why This Can Get Traction

Most AI coding tools compete to generate more code. Veritas competes on trust.
That is a cleaner open-source wedge because it works with Codex, Claude Code,
Cursor, OpenCode, Gemini CLI, Aider, or human-written PRs.

## GitHub Action

Use the example workflow in `docs/examples/veritas-action.yml` to run Veritas in
CI and upload the human-readable report as a build artifact. A sample report is
available in `docs/examples/veritas-report.md`.
