# Contributing to AIDE

AIDE is a local-first, offline-capable development workbench. Contributions should preserve user control, reproducibility, and honest capability reporting.

## Before A Change

- Open an issue for substantial features or protocol changes.
- Keep model weights, tokens, credentials, private CaseFiles, and training checkpoints out of Git.
- Prefer existing protocols such as LSP, DAP, Git, JSON-RPC, and OpenAI-compatible local APIs.
- Add a test and update the relevant manifest or documentation.

## Required Checks

```bash
npm test
npm run check
npm run veritas
```

For desktop work, also run `npm run desktop:prepare` and `npm run desktop:build` on a supported desktop host.

## Model Contributions

Every model pack must include its upstream license, source revision, tokenizer/template details, checksum, hardware estimate, benchmark results, and limitations. A model is not `ready` merely because it loads.
