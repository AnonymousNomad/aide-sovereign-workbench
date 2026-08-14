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

> An offline-first, model-agnostic development workbench with a real editor,
> local operator workflows, Git review, tasks, plugins, and reproducible audit
> artifacts.

## Veritas: Evidence Gates For AI Coding

AI coding tools can generate changes faster than teams can review them. AIDE's
Veritas harness makes every coding claim prove itself with deterministic checks,
an evidence ledger, and a developer credo that prefers abstention over false
certainty.

```bash
npm run veritas -- --report
```

Example output:

```text
Status: verified
Evidence: 100% observed, 90% required (sufficient)

Evidence Ledger
- path-boundary: pass
- secret-scan: pass
- manifest-validation: pass
- compile: pass
- tests: pass
- git-diff: pass
```

Use stricter 98% gates for publishing, security, payment, or identity work:

```bash
npm run veritas -- --report --task-class security-or-publish
```

See `docs/VERITAS_HARNESS.md` for the credo, CLI, GitHub Action example, and
product thesis.

[![CI](https://github.com/AnonymousNomad/aide-sovereign-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/AnonymousNomad/aide-sovereign-workbench/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/AnonymousNomad/aide-sovereign-workbench)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/AnonymousNomad/aide-sovereign-workbench?include_prereleases)](https://github.com/AnonymousNomad/aide-sovereign-workbench/releases)

## Start In One Minute

```bash
npm install
npm run doctor
npm start
```

Open `http://127.0.0.1:4173/`. The first-run guide walks through model
selection, runtime startup, chat, Plan, Agent, and optional Dual Model mode.

## What Works Today

- Real workspace tree, file reads, editor tabs, dirty state, and session recovery
- Local model chat through an OpenAI-compatible loopback runtime
- Ask, Plan, Agent, and opt-in Dual Model handoff modes
- Reviewable unified-diff workflow with explicit approval and audit artifacts
- Bounded terminal and task execution
- Git status, diff review, approved staging, and temporary-repository commit tests
- LSP diagnostics and Problems navigation
- DAP session event tracking and stack/scope inspection foundation
- Offline plugin manifests, 20 preset scaffolds, trust, capabilities, and
  isolated child-process execution
- Academy tracks for Python, ML/AI, and Production Software Engineering
- Interactive Blueprint view
- Optional OpenAI-compatible, OpenAI, Anthropic, and Gemini provider adapters

## Release Status

AIDE is pre-production. The repository publishes verified engineering milestones,
not a claim of complete VS Code parity. Desktop daemon lifecycle, full debugger
fixtures, split editor groups, and broader real-repository benchmarks remain
release gates. See `docs/RELEASE_ROADMAP.md` and `docs/RESEARCH_LOG.md`.

## Offline Models

The source repository does not store large weights. The full offline release
uses a separate model bundle with checksums. Run `npm run verify:model-bundle`
before publishing a bundle. Provider credentials are optional, never required
for local mode, and never written to workspace artifacts.

[![GitHub Sponsors](https://img.shields.io/github/sponsors/anonymousnomad?style=flat&logo=github)](https://github.com/sponsors/anonymousnomad)

If AIDE helps your local development or privacy work, sponsorship supports continued offline tooling, model evaluation, and community infrastructure.

AIDE is an offline-first development workbench with a distinctive security-workbench visual system. It combines a real workspace editor, terminal, Git review, local model adapters, bounded operator modes, LSP/DAP services, tasks, plugins, Academy, and Blueprint views.

## Anonymous Local Agents

AIDE workers are anonymous local roles governed by `agents/manifest.json` and the universal harness. Reasoners read, builders propose, verifiers inspect, operators execute approved allowlisted actions, and archivists record local metadata. No agent receives personal credentials, arbitrary network access, arbitrary shell access, or permission to export private source by default.

## Current Model Strategy

- **Builder:** Qwen2.5-Coder 1.5B Instruct Q4_K_M from the official [Qwen repository](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF). The official model is Apache-2.0 and is intentionally not duplicated here.
- **Coordinator:** AIDE routes research, build, and verification sequentially. It shows a diff and requires approval before applying changes.

## Model Packs

The public pack includes registry entries for three optional Apache-2.0 models: SmolLM2 360M for fast chat/planning, Qwen2.5-Coder 0.5B for autocomplete, and Qwen2.5-Coder 1.5B for primary coding. See `models/PACKS.md`. Unreleased project-specific checkpoints are not exposed as IDE model packs.

## Offline Use

Install Node.js 20+ and run:

```bash
npm install
npm run doctor
npm start
```

Then open `http://127.0.0.1:4173/`. The first-run guide walks through selecting an installed model, starting the local runtime, and sending the first chat message.

The source checkout does not include model weights or `llama-server`. For local
chat, install a matching `llama-server` binary and point AIDE at a verified local
weight file before starting it. PowerShell example:

```powershell
$env:AIDE_LLAMA_SERVER = 'C:\path\to\llama-server.exe'
$env:AIDE_MODEL_PATH = 'C:\path\to\matching-model.gguf'
npm start
```

`npm run doctor` reports the binary and artifact separately. A manifest entry
marked `ready` is only a registry claim; the daemon will show `setup-required`
until both files are present.

See `runtime/README.md` and `models/manifest.json` for the adapter contract and model configuration. AIDE does not apply model-generated patches automatically.

## Desktop Architecture

`daemon/server.mjs` is the first runnable native boundary for workspace and Git operations. It binds to loopback and exposes only bounded read-only endpoints. `desktop/README.md` defines the Tauri shell plan and acceptance gates; no compiled desktop binary is claimed in this pre-production release.

## Universal Harness

`harness/` contains the model-independent closed loop: guard, retrieve, plan, propose, verify, revise, test, review, and learn. The harness does not mutate model weights and never lets a model approve or apply its own changes.

`harness/credo.md` contains AIDE Engineering Standards: evidence over confidence, explicit approvals, reversible changes, and honest capability reporting. It is mandatory harness context for every model role, alongside the role-specific SOP cards in `harness/sops.json`. `harness/veritas.mjs` uses calibrated task thresholds: 90% for ordinary explanation/code-change evidence and 98% for security, publishing, payment, and identity operations. These are evidence gates, not promises of universal model accuracy; failed gates produce abstention.

`npm run veritas` executes the real local gate before a release or verified answer: compile checks, tests, Git whitespace checks, manifest validation, path boundaries, and secret scanning. It is intentionally allowlisted and does not execute arbitrary model-generated commands.

See `docs/VERITAS_HARNESS.md` for the developer credo, evidence classes, CLI
report mode, and the trust-focused product thesis behind Veritas.

The Community Hub provides an offline cache for projects, issues, discussions, and marketplace metadata. Sync remains disabled until an encrypted transport is explicitly configured.

The daemon now owns an allowlisted LSP registry. TypeScript language intelligence is available through `languages/manifest.json`; models remain responsible for proposals, not syntax or semantic truth.

The daemon also owns an allowlisted DAP registry. Python debugging is provided through `debuggers/manifest.json` and `debugpy`; breakpoints, stack inspection, and execution remain outside the model harness.

The Training Room is defined in `training/manifest.json` and `training/README.md`; it is an approval-gated, resume-safe control room for data, tokenizer, training, evaluation, and release jobs. `benchmarks/` contains the common smoke suite for all three public model packs. `desktop/tauri.conf.json` is the reproducible desktop-shell configuration; native compilation remains a platform gate until Rust/Tauri is installed.

`capsules/` adds reproducible offline workspace capsules: portable metadata for the exact model, runtime, Git revision, evidence hashes, tools, and Veritas result without exporting private source by default.

The first live three-pack scorecard is in `benchmarks/live-results-2026-08-10.json`: all three models passed function and planning smoke tasks, while all failed strict unified-diff formatting. AIDE therefore keeps every raw patch behind Veritas and human approval.

The public model packs are optional local adapters. The IDE remains useful with networking disabled and does not expose unfinished project-specific checkpoints as model choices.

The ARM64 Rust desktop binary is compiled and hashed in `release/desktop-build-status.json`. Installer bundles still require a desktop host with a graphical session.

## Status

This is a pre-production engineering release. Several advanced workflows remain behind explicit acceptance gates. The Qwen weight is downloaded separately from its official repository and should be verified before offline use.

## License

The AIDE source and documentation are Apache-2.0 unless a file or dependency states otherwise. Third-party models retain their original licenses and attribution.
