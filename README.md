---
license: apache-2.0
tags:
- offline
- ide
- local-ai
- coding
- llama.cpp
- software-engineering
pipeline_tag: text-generation
---

# AIDE Sovereign Workbench

[![GitHub Sponsors](https://img.shields.io/github/sponsors/anonymousnomad?style=flat&logo=github)](https://github.com/sponsors/anonymousnomad)

If AIDE helps your local development or privacy work, sponsorship supports continued offline tooling, model evaluation, and community infrastructure.

AIDE is a local-first development workbench with a compact security-tool layout, angular panel structure, and an original Matrix-neon visual system. It combines an editor, terminal, Git-oriented workflows, model adapters, and bounded multi-model collaboration while keeping model execution on the user's device.

## Anonymous Local Agents

AIDE workers are anonymous local roles governed by `agents/manifest.json` and the universal harness. Reasoners read, builders propose, verifiers inspect, operators execute approved allowlisted actions, and archivists record local metadata. No agent receives personal credentials, arbitrary network access, arbitrary shell access, or permission to export private source by default.

## Current Model Strategy

- **Builder:** Qwen2.5-Coder 1.5B Instruct Q4_K_M from the official [Qwen repository](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF). The official model is Apache-2.0 and is intentionally not duplicated here.
- **Coordinator:** AIDE routes research, build, and verification sequentially. It shows a diff and requires approval before applying changes.

## Model Packs

The public pack includes registry entries for three optional Apache-2.0 models: SmolLM2 360M for fast chat/planning, Qwen2.5-Coder 0.5B for autocomplete, and Qwen2.5-Coder 1.5B for primary coding. See `models/PACKS.md`. My unfinished Liquid model is deliberately excluded.

## Offline Use

Install Node.js 20+ and run:

```bash
npm install
npm run doctor
npm start
```

Then open `http://127.0.0.1:4173/`. The doctor reports missing optional runtimes as warnings instead of hiding them. Import a model pack from the Model Lanes panel and use **START / TEST RUNTIME**.

See `runtime/README.md` and `models/manifest.json` for the adapter contract and model configuration. AIDE does not apply model-generated patches automatically.

## Desktop Architecture

`daemon/server.mjs` is the first runnable native boundary for workspace and Git operations. It binds to loopback and exposes only bounded read-only endpoints. `desktop/README.md` defines the Tauri shell plan and acceptance gates; no compiled desktop binary is claimed in this pre-production release.

## Universal Harness

`harness/` contains the model-independent closed loop: guard, retrieve, plan, propose, verify, revise, test, review, and learn. Liquid is assigned to reasoning and verification; Qwen Coder is assigned to patch generation. The harness does not mutate model weights and never lets a model approve or apply its own changes.

The original AIDE Developer's Credo, inspired by broad Mandalorian discipline themes and translated into engineering behavior, lives in `harness/credo.md`; its research and copyright boundary is in `harness/credo-research.md`. It is mandatory harness context for every model role, alongside the role-specific SOP cards in `harness/sops.json`. `harness/veritas.mjs` uses calibrated task thresholds: 90% for ordinary explanation/code-change evidence and 98% for security, publishing, payment, and identity operations. These are evidence gates, not promises of universal model accuracy; failed gates produce abstention.

`npm run veritas` executes the real local gate before a release or verified answer: compile checks, tests, Git whitespace checks, manifest validation, path boundaries, and secret scanning. It is intentionally allowlisted and does not execute arbitrary model-generated commands.

The Community Hub provides an offline cache for projects, issues, discussions, and marketplace metadata. Sync remains disabled until an encrypted transport is explicitly configured.

The daemon now owns an allowlisted LSP registry. TypeScript language intelligence is available through `languages/manifest.json`; models remain responsible for proposals, not syntax or semantic truth.

The daemon also owns an allowlisted DAP registry. Python debugging is provided through `debuggers/manifest.json` and `debugpy`; breakpoints, stack inspection, and execution remain outside the model harness.

The Training Room is defined in `training/manifest.json` and `training/README.md`; it is an approval-gated, resume-safe control room for data, tokenizer, training, evaluation, and release jobs. `benchmarks/` contains the first common smoke suite for all three public model packs. `desktop/tauri.conf.json` is the reproducible desktop-shell configuration; native compilation remains a platform gate until Rust/Tauri is installed.

`capsules/` adds reproducible offline workspace capsules: portable metadata for the exact model, runtime, Git revision, evidence hashes, tools, and Veritas result without exporting private source by default.

The first live three-pack scorecard is in `benchmarks/live-results-2026-08-10.json`: all three models passed function and planning smoke tasks, while all failed strict unified-diff formatting. AIDE therefore keeps every raw patch behind Veritas and human approval.

The public model packs are optional local adapters. The IDE remains useful with networking disabled and does not expose unfinished project-specific checkpoints as model choices.

The ARM64 Rust desktop binary is compiled and hashed in `release/desktop-build-status.json`. Installer bundles still require a desktop host with a graphical session.

## Status

This is a pre-production engineering release. The Liquid checkpoint is not included until its exact artifact, license, checksum, and evaluation are confirmed. The Qwen weight is downloaded separately from its official repository and should be verified before offline use.

## License

The AIDE source and documentation are Apache-2.0 unless a file or dependency states otherwise. Third-party models retain their original licenses and attribution.
