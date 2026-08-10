# AIDE Packaging Recommendation

## Core

Ship the IDE without model weights. Include the editor, project explorer, terminal, Git surfaces, task runner, diagnostics, patch review, model registry, offline controls, and adapter interfaces. This is the smallest download and avoids upstream model-license and hardware problems.

## Liquid Thinking Pack

Do not ship the unfinished TinyLiquid training artifact. When the user's Liquid AI LFM2.5 Thinking checkpoint is confirmed and licensed for redistribution, offer it as a separate research/verifier pack. Use it for reasoning, requirements, architecture, test planning, and verification, not coding patch generation. Include a **Training Lab** panel that shows:

- training stages and dates
- parameter count and architecture
- device and runtime
- dataset categories, not private raw data
- evaluation probes and exact scores
- generation-speed measurements
- known failures and limitations
- what is experimental versus release-ready

This turns the project into an honest demonstration of how the owner's models are trained, evaluated, and integrated without presenting an unfinished checkpoint as a public demo.

## Coding Local

Do not bundle a third-party coding model into the main installer. Offer an import/download card for a small model, with license, file size, quantization, context, memory estimate, and measured coding-probe results shown before installation.

Recommended starting order:

1. Qwen2.5-Coder 1.5B Instruct Q4_K_M for the smallest useful coding pack.
2. DeepSeek-Coder 1.3B Instruct as a benchmarked alternative.
3. Qwen2.5-Coder 3B Instruct as an optional higher-quality pack.

The IDE should download or import only the user-selected pack, record its exact revision and SHA-256, and keep it replaceable. Never claim a model is "ready" because it loads; require patch, compile, test, and destructive-command refusal probes.

## Research Lab

Use this profile to demonstrate the full project lifecycle: import a checkpoint, inspect its manifest, run local probes, compare quantizations, observe training history, route it through research/build/verify lanes, review a patch, and generate a release bundle. The lab should expose real metrics and failures instead of a simulated progress animation.

## Why This Split

Users can install and use AIDE without downloading large weights. The TinyLiquid demo remains small and distinctive. Coding users can choose a model appropriate for their hardware. Future trained models become new model packs, not breaking application updates.
