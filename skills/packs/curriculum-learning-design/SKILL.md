---
name: curriculum-learning-design
description: Design and implement curriculum learning for small from-scratch LLM pretraining. Covers difficulty metrics (compression ratio, MTLD, Flesch Reading Ease, code complexity), curriculum strategies (vanilla, pacing-based, interleaved), pacing functions (linear, concave, convex), and CL-as-warmup. Use when designing the pretraining data ordering for the 150M rebuild, choosing difficulty signals, or debugging curriculum-related training instability.
---

# Curriculum Learning Design — 2026 Research-Grounded

## Research Foundations (what actually works for small models)

| Source | Proven Principle | Applied As |
|--------|------------------|------------|
| EACL 2026 (Zhang et al., 2026.eacl-long.271) | **Curriculum learning consistently accelerates convergence 18-45% fewer steps**; compression ratio, MTLD, and Flesch Reading Ease are the most effective difficulty signals; CL-as-warmup yields sustained +3.5% improvement | Our 3-level curriculum (simple/medium/complex) uses compression ratio + token count + FRE; warmup before random sampling |
| Readability-driven CL (MDPI 2025) | **Flesch Reading Ease at sentence/group level** with 3 subsets (easy/medium/hard) yields +19.83% on BLiMP; 10 epochs per stage | FRE scoring integrated into Phase 3 filter pipeline; stage boundaries at FRE tertiles |
| Curriculum Learning Dynamics (arXiv 2601.21698) | Curricula **reduce gradient noise scale (GNS)** for models 14M-160M; **reverse-order loses gains**; shared latent phases, curricula change phase occupancy | Validate GNS reduction on 150M; never use descending difficulty; monitor phase transitions via HMM |
| Code CL (ACL 2024, 2407.10194) | **Hybrid CL schedule** (easy → hardest-easy+medium → hardest-easy+medium+hard) achieves 74.04% code execution accuracy vs 61.78% baseline; **sequential loses overall accuracy** | Code corpus uses Hybrid schedule; reset LR+optimizer per stage; 20k/30k/70k iterations per stage |
| OpenLanguageModel (arXiv 2607.16669) | **Readable, composable pretraining** with curriculum built into data pipeline; AutoTrainer configures hardware | Phase 4 cache build embeds curriculum splits; trainer reads curriculum_stage from shard manifest |

## The Curriculum Design (for 150M FSI-FELON)

### Difficulty Signals (validated on this corpus)
1. **Compression Ratio** (gzip/zstd ratio) — correlates with information density; highest correlation with downstream gains (EACL 2026)
2. **Flesch Reading Ease (FRE)** — sentence/group level; cognitively grounded; +19.83% BLiMP (MDPI 2025)
3. **MTLD (Measure of Textual Lexical Diversity)** — lexical richness; EACL 2026 top signal
4. **Code Complexity (OM metric)** — cyclomatic complexity + nesting depth + token count (ACL 2024)
5. **Token Count** — proxy for sequence length; simple length binning

### Three-Level Curriculum (verified in train_150.py)
| Level | Data | FRE Range | Comp Ratio | Code OM | Tokens | Steps | LR Schedule |
|-------|------|-----------|------------|---------|--------|-------|-------------|
| P1 Simple | Textbooks, docs, simple code | ≥60 | ≤1.5 | ≤10 | 512 | 30% | Cosine warmup |
| P2 Medium | General web, moderate code | 30-60 | 1.5-2.5 | 10-25 | 512 | 40% | Cosine |
| P3 Complex | Complex code, math, reasoning | <30 | >2.5 | >25 | 512 | 30% | Cosine decay to 1e-5 |

### Pacing Functions (EACL 2026)
- **Linear** (vanilla CL): `q(t) = t` — early batches from low-score, late from high-score
- **Concave** (`q(t) = sqrt(t)`): reaches higher-score windows earlier — faster exposure
- **Convex** (`q(t) = t^2`): stays longer in lower-score — more foundation time
- **Quadratic pacing on FRE** showed best warmup transfer (EACL 2026 Appendix G)

**Our choice**: Linear pacing for main run; **CL-as-warmup** with quadratic FRE pacing for first 10% of tokens, then random sampling — matches EACL 2026 sustained +3.5% finding.

### Curriculum-as-Warmup Protocol
1. **Phase 1 (CL warmup)**: Train on curriculum-ordered data for 10% of total tokens (300M of 3B)
2. **Transition**: Save checkpoint, reset dataloader to random sampling
3. **Phase 2 (Random)**: Continue training on randomly shuffled data from same corpus
4. **Gate**: Compare val loss trajectories; warmup must show lower val loss at transition point

### Expected Bugs / Issues
- **Curriculum leakage**: Val set sampled from same ordered array → memorization metric (OBSERVED 8/3). Fix: separate held-out val, fixed seed 42, decontamination law.
- **Stage transition spikes**: LR reset at stage boundary can cause loss spikes. Fix: cosine schedule continuous across stages, or brief warmup at transition.
- **Complex bucket memorization**: Complex train loss ~0.35 while val PPL 15 (OBSERVED 8/6) — capacity gap, not exposure gap. Fix: complex gap fix belongs in SFT+distillation (production-readiness skill), NOT more pretraining.
- **FRE computation cost**: Sentence-level FRE on 3B tokens is expensive. Fix: precompute FRE during Phase 3 filter, store in inventory.csv.
- **Code OM metric**: Requires AST parsing. Fix: use `ast` module + radon for cyclomatic; cache results.

## Implementation Checklist
- [ ] Phase 3 inventory.csv includes `flesch_reading_ease`, `compression_ratio`, `mtld`, `code_om` columns
- [ ] Phase 4 build_cache.py reads `curriculum_stage` from splits.json, writes `curriculum_stage` to shard manifest
- [ ] train_150.py curriculum schedule matches table above (30/40/30 split, cosine per stage)
- [ ] CL-as-warmup variant implemented as `--cl-warmup` flag (quadratic FRE pacing, 10% tokens, then random)
- [ ] GNS monitoring hook in trainer (log every 500 steps for 14M-160M scale validation)
- [ ] Ablation: Random vs Linear CL vs CL-warmup on 16.9M probe before 150M commit

## Dependencies
- Phase 3: corpus-curation (filter pipeline computes difficulty signals)
- Phase 4: pipeline-phase-4-tokenization-cache (cache build embeds curriculum_stage)
- Phase 5: pipeline-phase-5-pretrain-code (trainer reads curriculum_stage, implements schedule)
- Requires: `radon` (code complexity), `textstat` (FRE, MTLD), `zstandard` (compression ratio)

## Threat Matrix
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Val leak from curriculum ordering | HIGH (observed) | CRITICAL | Separate held-out val, fixed seed, contamination scan |
| Complex bucket memorization | HIGH (observed) | HIGH | Don't extend pretraining on complex; fix in SFT+distill |
| FRE/MTLD compute bottleneck | MEDIUM | MEDIUM | Precompute in Phase 3, cache in inventory |
| Pacing function wrong for 150M | LOW | MEDIUM | Probe on 16.9M first (CL-as-warmup vs linear vs random) |
| Stage transition loss spikes | MEDIUM | MEDIUM | Continuous cosine, brief transition warmup |

## When Done
Mark curriculum design complete in AGENT_NOTES with: difficulty signal correlations on corpus sample, curriculum split token counts, pacing function choice, warmup protocol, and 16.9M probe results.