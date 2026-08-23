# Training Phase B3 — Eval Gates + GGUF Export Loop

## What
Close the training loop with fail-closed evaluation: validation-perplexity curve from the run, a task-eval harness (held-out prompts scored by exact-match/rubric) comparing tuned vs base, a general-capability forgetting probe, then merged-GGUF export at Q4_K_M → existing ingest → instantly chat-testable. Registration into the model manifest is BLOCKED unless the tuned model beats its baseline by the recorded threshold.

## Why
"If you don't measure, you don't know" — every 2026 guide makes eval-before-deploy non-negotiable: perplexity alone is not task performance; evaluate AT deployment quantization (Q4_K_M), and probe for catastrophic forgetting when training on narrow data (mix 5–20% general data / lower lr / fewer epochs are the documented mitigations). Our own Phase-9 doctrine adds the local law: no-vacuous-pass — gates without gold or with degenerate outputs are FAILs.

## Code Plan
- `node/src/services/training-eval.ts`: given job dir + locked B1 split →
  1. **Perplexity**: read trainer eval_loss history from run log (already streamed in B2); report best step vs final.
  2. **Task eval**: render N held-out val prompts through BOTH base GGUF (existing runtime) and exported candidate via llama.cpp `perplexity`/generation endpoints; score exact-match for structured tasks, rubric fields for open ones; record per-item results JSON.
  3. **Forgetting probe**: fixed 30-prompt general battery (reuse academy/cloze-style items); flag if candidate drops >5 pts vs base on it.
- Export: generated python one-shot (`merge_and_export.py`) — adapter merge + `save_pretrained_gguf(..., quantization_method="q4_k_m")`; output staged as `.partial`, sha256 recorded, probeGguf validated, then atomic move into `models/` and registered via ModelRuntime.ingest (same path as Hub installs).
- Gate: `POST /api/training/register {jobId}` computes verdict = beats-baseline threshold (recorded at job start, default ≥15% convention/task metric per researched judge guidance) AND forgetting-probe pass AND non-degenerate outputs → only then ingest+manifest registration; full evidence pack saved to job dir either way.

## Dependencies
B2 artifacts (logs/checkpoints/adapters), model-runtime (base-model serving + ingest + verifyEndpointModel), gguf.ts, events channel, Phase-9 no-vacuous-pass doctrine.

## Threat Matrix
| Threat | Control |
|---|---|
| Self-deception (registering an untested "improvement") | register route refuses without complete evidence pack; threshold fixed before run starts |
| Quantization surprise | candidate evaluated AS Q4_K_M, never pre-quant scores |
| Forgetting shipped silently | forgetting probe is a hard gate, not a warning |
| Degenerate outputs passing exact-match | degeneracy checks (length floor, repetition ratio) = FAIL |
| Disk bloat from adapters+merged+gguf | export cleans intermediates post-success; job dir size cap warn |

## Issues / Bugs Watchlist
- Base-model serving port conflicts during eval — reuse runtime's free-port relocation.
- Judge-free scoring first (exact-match/rubric-by-user); LLM-as-judge optional later, never required for the gate.
