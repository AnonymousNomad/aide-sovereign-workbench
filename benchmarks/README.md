# AIDE Model Benchmarks

Run the common suite with `npm run benchmarks`. Run one installed model at a time by setting `AIDE_BENCH_MODEL`; each model must be served on the endpoint recorded in `models/manifest.json`.

The first live scorecard is `live-results-2026-08-10.json`. It is intentionally small and honest: all three public packs passed function and plan tasks, and all three failed the strict unified-diff task. That failure keeps raw model output behind the patch parser and Veritas gate.
