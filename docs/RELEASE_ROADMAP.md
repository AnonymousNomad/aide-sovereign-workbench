# AIDE Release Roadmap

This roadmap converts external feedback into measurable release work. AIDE is
not presented as a finished IDE until the gates below pass on a clean install.

## Gate 1: Daily-Driver Workbench

- Real workspace files, tabs, dirty state, undo, save, and session recovery.
- Search, command palette, terminal, task profiles, Problems, LSP, DAP, and Git.
- Model Ask, Plan, and Agent modes with context preview, approval, diff review,
  test execution, checkpoint, revert, cancellation, and audit trace.
- Unified-diff acceptance benchmark across real multi-file tasks.

## Gate 2: Desktop Distribution

- Tauri binary builds on supported Linux, macOS, and Windows hosts.
- Install, launch, upgrade, uninstall, and crash recovery are tested.
- Desktop daemon lifecycle is owned by the shell; no orphaned runtimes remain.
- Checksums, release assets, dependency advisories, and known limitations are
  published with every release.

## Gate 3: Ecosystem

- Plugin manifests, capability declarations, trust prompts, isolated execution,
  lazy activation, timeout, disable, and failure containment.
- LSP/DAP adapters and model runtimes remain replaceable through manifests.
- Contributors have clear documentation, security reporting, issue templates,
  CI, and reproducible local tests.

## Gate 4: Evidence And Adoption

- Benchmark real repository tasks with public prompts, exact environment, raw
  outputs, latency, memory, patch acceptance, test pass rate, and failures.
- Provide screenshots or recordings of verified workflows, not decorative mockups.
- Keep README claims limited to what the current release proves.
- Ship a desktop installer before asking non-technical users to adopt AIDE.

## Deferred Separate Work

- Website-builder model product validation.
- Journalist source credibility weighting and evidence provenance.
- Additional model training and post-training.

These projects must use the same harness contract when integrated, but they do
not change AIDE's current IDE release gates or interrupt active training.
