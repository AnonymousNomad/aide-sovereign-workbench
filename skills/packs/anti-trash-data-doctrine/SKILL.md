---
name: anti-trash-data-doctrine
description: The Big Tech data-quality doctrine — zero-tolerance "no trash" rules for building high-quality training corpora, researched from primary sources (OpenAI GPT-3, Meta Llama 3, Microsoft phi-1, DeepSeek, HF FineWeb, Ai2 Dolma 3, Stanford DSIR, perplexity pruning). Covers the ordered filtering pipeline (cheap heuristics -> dedup -> classifiers), dedup granularity (exact -> MinHash -> substring), quality scoring (classifiers, reference-model perplexity, importance resampling), contamination removal, and the gates that generated/synthetic docs must pass identically to scraped ones. Use whenever curating, filtering, grading, deduplicating, or generating ANY data for the shared ~1B corpus, when deciding what enters or leaves the corpus, or when defending a data-acceptance decision.
---

# Anti-Trash Data Doctrine — What Big Tech Actually Does

One line: for small models, data quality is the entire strategy; every token must be earned (proven: phi-1 1.3B + 6B textbook tokens beat 10x-larger web-trained models; LIMA 1,000 curated beat 65K uncurated). "No trash" is not an aspiration — it is an ordered pipeline with gates, and the order matters.

## Research Basis (primary sources, condensed to the applied rule)

| Source | What they actually did | Applied rule |
|---|---|---|
| GPT-3 (OpenAI, 2020) | Classifier (logistic regression, HashingTF features) trained on WebText/Wikipedia/books vs raw Common Crawl; Pareto resampling alpha=9; MinHashLSH fuzzy dedup (10 hashes, ~10% removed); 13-gram benchmark-contamination removal | (1) Train a classifier on curated-positive vs raw-negative to SCORE documents; resample by score. (2) Fuzzy dedup before training. (3) Remove benchmark-overlapping n-grams + 200-char windows; drop docs split into >10 contaminated pieces. |
| Llama 3 (Meta, 2024) | Multi-layer pipeline: heuristic filters + NSFW filters + semantic dedup + text-quality classifiers; the classifiers were LABELED BY LLAMA 2 (previous-gen model judges new data); final-stage "annealing" on small high-quality code | Use the previous/current model generation as the LABELER for quality classifiers (self-escalating quality labeling). Filter in layers: cheap heuristics first, classifiers after. Dedup semantically, not just byte-wise. |
| phi-1/1.5 (Microsoft, 2023) | "Textbook quality" data: GPT-4 filtered The Stack for educational content; GPT-3.5 generated textbooks + exercises; diversity via RANDOM CONSTRAINTS (topic x audience x style) not repetition; "clear, self-contained, instructive, balanced" | Synthetic must be filtered by an LLM judge, and diversity comes from constrained generation seeds (topic/audience/angle), never N copies of one template. Generated docs must be textbook-grade: self-contained, balanced, instructive. |
| DeepSeek (2023-25) | cc_cleaner pipeline: dedup (document + string level, MinHashLSH) -> filter (heuristic + model) -> remix; explicitly PRESERVES low-resource/niche knowledge even from lower-quality sources; iterative data refinement driven by scaling-law feedback | Dedup and filter, then REMIX for balance. Never over-purge niche/high-value content on quality scores alone. Iterate: measure, adjust mix, repeat. |
| FineWeb (HF, 2024) | 50+ candidate heuristic filters narrowed by measuring stats on high- vs low-quality sets; then MinHash dedup (5-grams, 112 hashes, 14x8 bands, ~75% similarity, transitive clustering, keep 1 doc); found GLOBAL dedup can up-sample low-quality content in the LAST crawl | Design heuristics from measured statistics (not vibes). Dedup PER-SOURCE and beware global-dedup interactions. MinHash params: 5-grams, 8-14 buckets x 8-11 hashes, threshold ~0.75-0.8 Jaccard. |
| Dolma 3 (Ai2, 2025) | Three-round dedup: exact (byte hash) -> MinHash fuzzy (5-grams, 26x11 hashes, 0.8 Jaccard, keep ONE per cluster) -> suffix-array SUBSTRING dedup (repeated substrings >= 500 bytes removed, keep one copy); heuristics removed ~64% of pool; quality/topic classifiers partition into buckets for fine-grained mixing | Dedup in granularity order: exact FIRST (cheap), then fuzzy, then substring. Cheap filters before expensive ones (filters are commutative — run cheap first). After quality: bucket by (category, quality quintile) for mixing. |
| Small-model perplexity pruning (2024, Marion/Penedo et al.) | Train a small reference model on a subset; prune the big dataset by perplexity band; best = MEDIUM-perplexity half (Dolma) or HIGH (Pile); gains up to +2 pts downstream; upstream test-PPL is a POOR judge | Quality is not monotone — the middle band often wins. ALWAYS measure data interventions on downstream evals, never on upstream perplexity. |
| DSIR (Stanford, 2023) | Importance resampling on hashed n-gram features to match a target distribution (e.g. Wikipedia/books); KL-reduction correlates r=0.82 with downstream accuracy; matches expert curation | For selection not covered by classifiers: resample toward a curated target corpus via hashed n-gram importance weights. Heuristic classification alone can behave like random selection — use a real target distribution. |
| EMNLP "Data, Data Everywhere" (2024) | 2T-token ablations: dedup + quality filtering both improve accuracy; on dedup conflicts keep the OLDER/established source; KenLM perplexity over high-quality sources + heuristics; DSIR as cheap selection | Dedup conflict rule: prefer the source with provenance/verification history. Keep documented evidence that every curation step earned its place. |

## The Ordered Anti-Trash Pipeline (cheap first — order is part of the method)

1. **Heuristic filters** (cheapest, largest volume cut). Length bands (drop < ~40 chars and bloated docs), alphanumeric ratio, stopword/token stats, bad-words lists, navigation/boilerplate patterns, ratio of punctuated lines, pipe-delimited lines ratio < 0.3. Dolma 3 cut ~64% of its pool here. Design thresholds from stats on known high- vs low-quality samples (FineWeb method).
2. **Language + PII**. fastText lid (>= ~0.65 confidence), anonymize emails/URLs/IPs. Cheap before expensive.
3. **Dedup in three rounds** (Dolma 3 order):
   - Exact: byte-hash content, keep one per hash (subsumed by MinHash but worth doing first for compute).
   - Fuzzy: MinHash 5-grams, ~14x8 hashes (FineWeb) or 26x11 (Dolma3), Jaccard ~0.75-0.8, transitive clustering, keep ONE per cluster — prefer the doc with provenance/verification.
   - Substring: suffix array; any repeated substring >= 500 bytes is boilerplate — remove, keep one copy. (DeepSeek also does string-level dedup; this is what kills template scaffolding.)
4. **Quality scoring & selection.** In order of sophistication: (a) trained classifier labeled by your previous-gen model (Llama 3 / GPT-3 recipe — we use our verified gold corpus + F-grade list as label sources); (b) perplexity bands from a small reference model (start with MEDIUM band at 50% selection rate, verify on downstream evals); (c) DSIR importance resampling when a target distribution is known. All scores are inputs — the final decision is a gate, not a soft ranking.
5. **Contamination removal.** N-gram overlap against every held-out eval/benchmark (GPT-3: 13-gram, remove colliding gram + 200-char window, drop docs split into >10 pieces; ignore grams matching >10 docs = common phrases). Our SFT/distill held-out exclusion is this doctrine applied.
6. **Remixing** (DeepSeek's third stage). Upsample underrepresented domains and quality-quintile buckets; protect low-resource/niche content from over-filtering; keep any single synthetic source <= 5% of mix.

## Hard Rules ("no trash" — zero tolerance)

1. **Every doc passes every gate.** Any doc — scraped OR generated — failing length, verification, dedup, structure, or quality fails the batch. No partial credit.
2. **Generated data is not exempt.** Synthetic/textbook output must clear the SAME gates as scraped data (DCLM lesson). LLM-judge-filter the synthetic before it even reaches the corpus (GPT-4-filtered-The-Stack lesson). Unverified model output is F-grade, period (STaR lesson).
3. **Cheap filters before expensive ones.** Filters are commutative; process in cost order.
4. **Dedup before quality scoring.** Scores computed on a deduplicated corpus are the ones that transfer (FineWeb: global dedup changes the retained distribution — score after, or re-score).
5. **Judge quality on downstream evals, never on upstream perplexity.** A "better" training-set perplexity can be worse for the model.
6. **Dedup conflicts favor provenance.** Between near-identical docs keep the one with verification history / older established source (EMNLP ablation).
7. **No single source dominates.** Synthetic capped at ~5%; one template family is not diversity — constraint-space coverage is (phi / Cosmopedia / fastweb "100 types x 10 styles" lesson).
8. **Never ship a doc whose numbers were not executed.** A doc with invented verification is worse than garbage — it is fake garbage.
9. **Contamination is removed before training, always** (GPT-3 13-gram recipe), and held-out sets are carved out at the source.

## What "Trash" Is (concrete, usable as a check-list)

- Template filler: same skeleton, varied values; repeated scaffolding; `[variant N]` placeholders.
- Fabricated verification: "solutions" with fake outputs, hardcoded results, generic stubs.
- Machine noise: training logs, progress bars, checkpoints, .log/.err, token-id arrays.
- Near-identical duplicates (MinHash cluster) and repeated boilerplate (>= 500-byte repeated substrings).
- Scraped garbage: tiny fragments, < 40 chars, no terminal punctuation, low alphanumeric ratio, stopword floods, boilerplate-heavy pages.
- Toxic/PII/NSFW content (Llama 3 filters), benchmark-contaminated items (n-gram overlap).
- Docs with unseen-token storms (KL/quality filters) — EXCEPT judged niche/low-resource knowledge, which is preserved deliberately (DeepSeek).

## Mapping to Our Corpus

- F-grade list in the corpus-curation skill IS this doctrine's trash list (verified on this machine).
- The curation pipeline to build for the raw blocks (ferrell-coder 505.9MB, colony_teacher 96MB, swarm-neci 1.4GB, lab 13.5MB, gold 45.5M tok) MUST run the ordered pipeline: heuristics -> lid/PII -> exact -> MinHash -> substring dedup -> quality scoring -> contamination -> remix.
- Our gold docs already satisfy textbook-quality rules (execute-then-write, byte-exact format, single topic, constraint-seeded diversity, 5 gates). Keep using gold-training-docs + kd-corpus-production for GENERATION; this skill governs FILTERING/ACCEPTANCE of everything that enters the corpus.

## When to Trigger

- ANY data enters, leaves, or is graded in the shared corpus (any block, shard, or generated batch)
- Designing or running curation/filtering/dedup scripts
- Deciding whether model output or synthetic output may enter training data
- Defending "why did this doc/block fail" decisions

## Reference the skill from AGENT_NOTES

Every curation/filtering decision entry must name this skill (e.g. `via skill: anti-trash-data-doctrine`).