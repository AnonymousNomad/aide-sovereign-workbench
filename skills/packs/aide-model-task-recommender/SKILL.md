---
name: aide-model-task-recommender
description: SOP for AIDE's per-task model recommendation engine — mapping Hugging Face GGUF models to task suitability (coding / planning-chat / utility) using Hub API metadata (pipeline_tag, library=gguf, num_parameters ranges), merging with on-device fit verdicts (M2) and measured benchmarks (llama-bench lane), producing the ranked "recommended for YOUR machine + YOUR task" lists in the hub UI. Use when building the recommender service, designing the task taxonomy, wiring hub starter grids, or debugging recommendation ranking.
---

# Model Task Recommender — "the right model for your task, on your machine"

## What we are doing
When a user opens the hub or asks "what should I use for coding?", AIDE returns a short ranked list of GGUF models that (1) FIT comfortably on their hardware, (2) are SUITED to the task family, (3) ideally have MEASURED tok/s from the benchmark lane. This is the differentiator vs Ollama's flat list and PocketPal's generic size tiers.

## Research base (verified 2026-08-24)
1. HF Hub REST API (huggingface.co/docs/hub/main/en/api + /.well-known/openapi.json): `GET https://huggingface.co/api/models?library=gguf&pipeline_tag=X&sort=downloads&limit=N` — public, no auth; supports `filter` (tags), `author`, `search`, `num_parameters` range syntax (`min:1B,max:8B`), `gated`, `inference_provider`. Model info endpoint with `expand` params; `siblings` = file list (find *.gguf filenames); OpenAPI spec is machine-readable and always current.
2. HF GGUF docs: `hf.co/models?library=gguf` browsing; @huggingface/gguf JS parser can read GGUF metadata from REMOTE URLs (header-only) — lets us pre-validate architecture/params before recommending a download.
3. ToolNeuron reference UX (captured in aide-model-hub-acquisition): recommended-by-use-case starter table (~600MB quick test / ~2.8GB general / ~5.5GB power) + filter chips populated from live HF tags catalog.
4. Our own verified assets: M2 verdict tiers (COMFORTABLE <70% VRAM / TIGHT 70–95% / OVER ≥95%), header-only footprint estimation, nvidia-smi probe cache, benchmark lane (aide-device-benchmark-runner).

## Task taxonomy (locked v1 — keep SMALL)
Three task families matching our role routing:
- `coding` — act-role code generation/editing. Signals: model family reputation for code (Qwen-Coder/DeepSeek-Coder/CodeLlama lineage), pipeline_tag text-generation + name/tags containing coder/code, context length ≥8k preferred for file context.
- `planning` — plan-role reasoning/architecture/chat. Signals: instruct/chat tuning, larger param counts favored, long-context bonus, reasoning-family tags (R1-distill lineage etc).
- `utility` — titles/commit-msgs/quick edits. Signals: small params (<4B), fast tg128, any instruct model.
Curated seed list: hard-coded vetted {repo_id, task_tags[], notes} entries for ~10 known-good models (updated by us, versioned in repo as data file). Live HF search AUGMENTS seeds; seeds guarantee offline-first quality (no network needed for good defaults).

## Design
```
common/contracts/recommend.ts  RecommendRequest {task:'coding'|'planning'|'utility', limit?}
                               RecommendedModel {repo_id, filename?, size_bytes, params_b?, quant?,
                                                 verdict:'COMFORTABLE'|'TIGHT'|'OVER', est_tok_s?,
                                                 measured?:{pp512,tg128}, source:'seed'|'live',
                                                 why:string[]}
                               RecommendResponse {task, device:{gpu,vram_free,vram_total}, models[]}
node/src/services/recommend-service.mjs
  createRecommendService({workspace, hubFetcher(injectable), benchStore, fitModel, hwProbe})
  - score(model) = fitScore(verdict) * taskFit(tags,params,ctx) * speedBonus(measured||est) ; NO hidden weights — constants at top, documented
  - rank: COMFORTABLE always above TIGHT above OVER regardless of other scores (fit gates, never blends)
  - live path: egress journal BEFORE fetch (hub search), cache HF responses 24h in .aide/recommend/cache.json (offline still works from seeds+cache)
routes/recommend.ts GET /api/models/recommend?task=coding&limit=5
```

## Why this way
- Fit-gated ranking implements the M2 skill law ("rank BY THIS VERDICT before popularity"). Popularity/downloads is a tie-breaker ONLY within same verdict tier.
- Seeds make recommendations honest OFFLINE (In-the-Box law) while live search keeps freshness; 24h cache respects No-Phone-Home (no automatic polling — fetch only on explicit user view of recommendations).
- Transparent scoring with named constants = no vibes; every recommendation carries `why[]` strings shown in UI tooltip ("fits in 62% of your VRAM", "coder-tuned lineage", "measured 41 tok/s on your GPU").

## Code guidance specifics
- HF fetch: single query per request combining `library=gguf`, task-relevant `search` terms, `sort=downloads`, limit 20; parse siblings[] for ONE .gguf filename (prefer Q4_K_M in name, else first gguf); NEVER download at recommend time.
- num_parameters filter from device budget: maxB = floor((vram_free*0.7) bytes→params at 4bit≈0.58 bytes/param) — conservative Q4_K_M math, documented constant.
- Params estimate fallback: parse from repo_id/name (`7b-instruct`) when metadata missing; mark `estimated:true`.
- Injected hubFetcher mirrors indexEmbedFn seam pattern → CI tests run fully offline against fixtures.

## Pitfalls / bugs watch-list
1. HF API shape drift: validate responses through zod contract; unknown fields tolerated via passthrough, missing fields degrade gracefully (drop candidate, never crash the panel).
2. Quant-in-filename parsing is heuristic soup (`Q4_K_M`, `q4_k_m`, `IQ4_XS`) — normalize uppercase, maintain regex table, unknown quants → treat as TIGHT unless measured.
3. Context length not visible in list endpoint — do NOT claim ctx fitness from list data alone; only from GGUF header after download/import (fitModel already does this).
4. Stale cache showing uninstalled/removed models — reconcile against local manifests before display.
5. Seeded repos can go dead/gated on HF — seed entries carry `last_verified` date; UI marks stale >90d; verification job manual/opt-in only.
6. GTX 1060-class reality: many "popular" 14B+ Q4s are TIGHT/OVER — recommender must surface the comfortable small models FIRST even if downloads rank lower (this IS the product promise).

## Threat matrix
| Threat | Control |
|---|---|
| Egress creep (auto-refresh calls) | fetch ONLY on explicit user action; journaled; 24h disk cache |
| Malicious repo promoted into seeds | seeds are OUR reviewed commits (PR review gate); live candidates never auto-install — user must click download |
| Prompt-injection via model card text | recommender renders only structured fields (id/size/verdict/why[]) — never raw README/markdown from cards |
| Ranking manipulation (fake-download repos) | fit-gate dominates; downloads only tie-break; seeds outrank live |

## Verification gates
1. Unit (fixture HF JSON + fake bench store): seed-only offline path; verdict gating order (COMFORTABLE beats higher-scoring TIGHT); quant normalization table; cache hit/miss/expiry; traversal-proof model_name handling.
2. Arch route test over HTTP incl. zod envelope + degraded mode when hubFetcher errors (returns seeds only, `source` flags honest).
3. LIVE once: real HF query journaled; screenshot of panel with why[] tooltips; evidence into docs/evidence/.
4. Standard chain: tsc x2, eslint, veritas PASS, CI green, journal entry.
