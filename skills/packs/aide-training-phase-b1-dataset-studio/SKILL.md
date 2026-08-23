# Training Phase B1 — Dataset Studio

## What
A local dataset manager for fine-tuning: import/export ChatML-format JSONL, dedup (exact-hash then normalized), length filtering (tokenized 95th-percentile guidance), chat-template render preview (5-sample eyeball rule), and a locked train/validation split that cannot be silently mutated after eval artifacts exist.

## Why
2026 consensus across all researched guides: dataset quality beats hyperparameter tuning; silent format failures and template drift are the top run-killers; contamination between train and eval invalidates every claim a run makes. The 5-sample render preview catches malformed roles before a multi-hour job, not after.

## Code Plan
- `daemon/dataset-store.mjs` (or node/src service): datasets live under `<workspace>/.aide/datasets/<id>/` — `data.jsonl`, `meta.json` {schema_version, format:'chatml', counts, sha256 of each file, split_seed, split_ratios, locked:boolean}.
- Operations: `import(jsonlPath)` validates every line against ChatML message schema (roles, non-empty content); dedup by exact sha256 of rendered text, then lowercase/whitespace-normalized second pass; length stats via tokenizer chars/4 heuristic (consistent with existing estimateTokens); `split(seed)` writes `train.jsonl`/`val.jsonl` + hashes; `preview(n=5)` renders through the target model's real GGUF chat template (reuse probeGguf template extraction) so what you see is what trains.
- Lock rule: once any eval artifact references the split hashes, meta.locked=true → mutation rejected with explicit error. Unlock requires deleting dependent artifacts (auditable).
- Routes: `/api/datasets/*` CRUD + preview + split; UI view reusing hub-style list/detail patterns. Contracts regen.

## Dependencies
gguf.ts (template extraction), estimateTokens, file containment pattern, contracts/OpenAPI drift gate.
Doctrine: anti-trash-data rules (dedup, validation, no unverified docs) apply to user data too.

## Threat Matrix
| Threat | Control |
|---|---|
| Train/eval contamination | split written once with recorded seed+hashes; lock enforced on dependent artifacts |
| Silent format failure | import-time per-line schema validation + mandatory template preview before a job can reference the dataset |
| Oversized/path-traversal imports | size cap (e.g., 200MB), basename sanitization, workspace containment |
| Duplicate-heavy data inflating metrics | exact + normalized dedup pass with reported removal counts |
| Privacy | local-only storage; export is explicit user action |

## Issues / Bugs Watchlist
- Very long single lines: stream-parse JSONL, don't readFile whole file for validation.
- Template mismatch warnings must name BOTH formats when base model template ≠ dataset rendering assumption.
