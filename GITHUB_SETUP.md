# GitHub Repository Setup

Recommended repository name: `aide-sovereign-workbench`.

Recommended settings:

- Public repository
- Description: `A local-first sovereign development workbench with model packs, Veritas verification, and offline community tools.`
- Topics: `offline-ide`, `local-ai`, `developer-tools`, `llama-cpp`, `lsp`, `dap`, `privacy`, `open-source`, `software-engineering`
- Enable Issues and Discussions
- Protect `main` with CI required before merge
- Disable force pushes and branch deletion on `main`
- Enable secret scanning and push protection when available
- Add the Apache-2.0 license
- Do not commit model weights, tokens, checkpoints, or private CaseFiles

The Hugging Face repository remains the model/package mirror. GitHub should be the code, issue, discussion, and contributor home.
