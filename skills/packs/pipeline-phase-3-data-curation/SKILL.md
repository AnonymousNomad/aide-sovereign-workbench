---
name: pipeline-phase-3-data-curation
description: Phase 3 of the from-scratch training pipeline — data acquisition and curation. The ordered filtering pipeline (language -> URL/metadata -> cheap heuristics -> exact/substring/MinHash dedup -> DSIR/importance resampling -> quality classifier), per-source grading and inventory, contamination scan (8-13 n-gram overlap), mix design and budgeting for a small model (~150M, ~3B tokens), and val/test holdout discipline with lock-box discipline. Enforces the anti-trash-data-doctrine and zero-dup-high-quality standing laws: NO duplicate/near-duplicate docs, NO low-quality docs, every doc verified unique against the index before staging. Use when inventorying, grading, filtering, deduplicating, mixing, or budgeting training data, or when deciding what enters or leaves the corpus.
---

# Phase 3 — Data Acquisition & Curation

Data is the entire strategy for a small model. The 150M model cannot out-compute
big labs; it must out-quality them per token. This phase is the standing law:
**zero-trash in, zero-dup, zero-low-quality**. Phases 1-2 proved machine and model;
Phase 3 builds the corpus the model is allowed to see.

Research sources: OpenAI GPT-3 (2005.14165) filter ordering + dedup (13-grams),
Meta Llama 3 data recipe (2407.21783), Microsoft phi-1 (2306.11644) textbook
quality, SmolLM2 (2502.02737) 600B-token mix, FineWeb (2406.17557) dedup tradeoffs,
Dolma (2402.00159), SlimPajama (2309.10818), AI2 DSIR (2302.03169), Stanford DSIR,
The Pile (2101.00027), Muennighoff repeat ceiling (2311.17016), MiniCPM (2404.06395).

---

## 1. Standing Laws (this project — non-negotiable, outrank all)

1. **ZERO duplicate or near-duplicate training docs.** Every new doc is verified
   unique against the corpus index BEFORE staging. MinHash + exact + substring
   dedup, parameters below.
2. **NO document ships unless it is the absolute highest quality.** Verified,
   executable, measured, byte-exact format, zero filler. Applies to ALL models
   (trek, felon, Sopher, 150M web-builder), ALL phases (pretraining corpus, SFT,
   distill, preference, synthetic), ALL generators, ALL sources.
3. **Synthetic docs pass the SAME gates as scraped docs.** A teacher/LLM-generated
   doc is not auto-trusted; it is graded, deduped, contamination-scanned, and
   quality-classified identically.
4. **Contamination zero-tolerance:** any doc sharing 8+ n-grams (GPT-3/lm-eval
   standard) with a val/test/benchmark sample is EXCLUDED from train and flagged.

---

## 2. Inventory & Grading (before any filtering)

### What to do
1. Inventory every source directory: path, file count, bytes, line/doc count,
   format (jsonl/txt/json), and an ESTIMATED token count (chars/4 for English).
   Write `data/inventory.csv`.
2. Grade each source A/B/C/D/F:
   - **A**: verified high-quality, in-domain, non-contaminated (e.g. ferrell_coder
     A-grade bug-journals/design-decisions)
   - **B**: good general text, needs filtering (swarm_neci, colony_teacher coding)
   - **C**: mixed, heavy filtering required (nanocoder — mostly C/F, exclude)
   - **D/F**: reject outright (dirty, dup, non-target-language)
3. Record the mix math: current on-disk reality (this machine): ~600M tokens but
   95.7% web-template + code — NOT usable for coherence. The corpus for the 150M
   rebuild needs a GENERAL-LANGUAGE block (web/doc/chat/prose) because the 
   documented blocker is domain-mix, not volume.
4. Estimate a budget: Chinchilla-optimal ≈ 20 tokens/param → 139.7M ≈ **2.5-3B
   tokens** (can run under-optimal at ~1B if GPU-time-bounded, but quality-first
   means aim for the real budget). Never budget "as many tokens as we can grab".

### Why
- Inventory before filtering prevents "we thought we had X tokens" surprises.
- Grading is a human-checkable decision record: every source has a stated grade
  and a reason, so a bad-source admission is traceable.
- The domain-mix lesson (0.3% conversation → coherence blocker) is THE canonical
  example: token count was never the problem; category coverage was.

### Expected bugs / issues
- Counting tokens by naive char/4 undercounts code (chars/token ≈ 3.5) and
  overcounts English (chars/token ≈ 4.2). Use the ACTUAL Phase-2 tokenizer for the
  final budget.
- A "clean" source still contains near-dups (ferrell mega_corpus is 506MB of
  evolved variants — dedup needed even within source).
- Zip/parquet sources hide their true count until expanded.

---

## 3. The Ordered Filtering Pipeline (cheap → expensive, exact order)

Run in this order — each stage is cheaper than the next and protects it:

1. **Language filter** (fasttext-langid / `fasttext` lid.176): keep target lang
   (en) only; drop low-confidence.
2. **URL/metadata filter** (for web-scraped sources): known-bad domains (spam,
   hate, machine-gen), low-quality path markers, boilerplate pages.
3. **Cheap heuristics** (FastText/Dolma-style): mean word length 3-12, ratio of
   symbol-to-word chars < 0.4, ≥50% alphabetic chars, ≥5 words, no raw HTML/JS/CSS,
   ≤3 consecutive line breaks, balanced brackets/quotes, no null bytes.
4. **Dedup** (see §4) — exact → substring → MinHash near-dup.
5. **DSIR / importance resampling** (2302.03169): reweight the surviving docs to a
   target distribution (web/chat/prose/code) so the model sees the RIGHT mix, not
   the raw source ratios. This is what makes a 95.7%-web pile become a balanced
   pile.
6. **Quality classifier** (trained on graded A docs as positive, filtered as
   negative): score every doc; keep above threshold (per-source thresholds, not
   one global number).

### Why
- Order matters: language/URL are O(1) per doc; the classifier is the most
  expensive. Running the classifier first wastes compute on docs that cheap
  filters would have dropped.
- Each stage's output is a JSONL checkpoint (`filter_1_lang.jsonl` etc.) — a crash
  resumes from the last stage, never from scratch.

### Expected bugs / issues
- Heuristics tuned on one source fail another (web vs chat vs code) — keep the
  heuristics SOURCE-AWARE (separate config per source).
- A single doc that is 10MB (dumped SQL) passes "≥5 words" but destroys a batch —
  enforce a max-doc-bytes cap.
- Failing to checkpoint per stage = re-running 4 hours of filtering on any crash.

---

## 4. Deduplication (the zero-dup law, concretely)

### What to do
1. **Exact dedup**: SHA-1 of normalized bytes (lowercase, collapse whitespace).
   This is mandatory FIRST — everything else is over it.
2. **Substring dedup** (Dolma-style, document level): a doc sharing an 8-gram with
   another is flagged; inspect before keeping.
3. **MinHash near-dup** (SlimPajama/Dolma parameters):
   - shingles: 13-token (English) / 8-token (code) — 13 is the GPT-3/lm-eval
     contamination standard, 8 is standard for code
   - hash functions: 128 permutations (or 256 for lower memory)
   - bands/rows: 20 bands × 5 rows (Jaccard threshold ≈ 0.8) — near-dups
   - threshold: drop pairs with Jaccard ≥ 0.8; flag 0.5-0.8 for human review
4. **Per-source dedup, then cross-source dedup** — the index is global.
5. Log EVERY dropped doc with reason + (hash, source) → `dedup_audit.jsonl`.

### Why
- Repeat-data ceiling: Muennighoff (2311.17016) — after 4-5 epochs the model only
  memorizes; more repeats ≠ more learning. Dedup is what makes each epoch count.
- 13-token overlap is THE benchmark-contamination line (GPT-3 used 13-grams; lm-eval
  normalizes on 13). Using it in dedup keeps train/val/test separated by the same
  standard the benchmarks will apply later.

### Expected bugs / issues
- MinHash memory: 256 perms × 500k docs × 8B ≈ 1GB — fine on 16GB RAM, but compute
  it in shards and merge shard fingerprints.
- Python `multiprocessing` dedup is slow on Windows spawn — use `num_workers=0` or
  a single process with the shingling vectorized (numpy/numexpr).
- Lowercasing before hashing over-merges (loses case distinction); hash BOTH
  normalized and raw, dedup on raw with normalized as a tiebreak.
- Near-dup threshold too low (0.5) keeps near-dups; too high (0.95) rejects
  legitimate variants (our 403-seed teacher rotation is a documented near-dup
  generator — the 0.85 threshold caught it).

---

## 5. Contamination Scan (train vs val/test/benchmark)

### What to do
1. Build the protected set: val split, test split, and every benchmark we will
   measure against (web/chat/format/cloze/coherence probes, future GSM-style).
2. For every TRAIN doc: extract 13-grams, compare against the protected set's
   13-gram index; ANY overlap ≥ 8 consecutive 13-grams (≈ a sentence) →
   **EXCLUDE from train, flag for review**.
3. Verify the val/test sets themselves are contamination-free vs each other and
   vs the raw sources (a leaked benchmark in val inflates "improvement").

### Why
- Retro-holdout research (2410.09247) showed leaked eval data inflates scores by
  ~16pp (TruthfulQA) — a 150M model cannot afford fake gains.
- This is the SAME gate the anti-trash doctrine applies to generated docs.

### Expected bugs / issues
- 13-gram at train-time vs 13-gram at eval-time can differ if tokenizer changes —
  run contamination on RAW TEXT n-grams, not tokenized.
- Contamination scan is O(train×val) naively — build a single 13-gram set and
  intersect per train doc (hash-set lookup, not pairwise).

---

## 6. Mix Design & Budget

### What to do
Build the final mix JSON (data/mix.yaml) with per-source per-category weights:
```
sources:
  web_general:     {tokens: 1.2e9, filter: [lang, url, heuristics, dedup, dsir, qclf]}
  web_builder:     {tokens: 6.0e8, filter: [lang, url, heuristics, dedup, dsir, qclf], domain: web-builder}
  code:            {tokens: 6.0e8, filter: [lang, url, heuristics, dedup, dsir, qclf]}
  chat_prose:      {tokens: 5.0e8, filter: [lang, heuristics, dedup, dsir, qclf], domain: chat/NLP}
  synthetic_gold:  {tokens: 1.0e8, filter: [heuristics, dedup, contamination, qclf]}
```
Reference mixes: SmolLM2 = 70% FineWeb-Edu / 15% Cosmopedia / 8% OpenWebMath /
5% StarCoder / 2% StackOverflow (vocab 49k). TinyLlama = SlimPajama:StarCoder 7:3.
phi-1 = synthetic textbook-quality only. The 150M rebuild wants a **coherence-heavy**
mix (this machine's documented gap): web-builder + code + real chat/prose/general.

Curricula (optional but recommended for small models): domain order web→code→chat
or dataset-proportion curricula (EACL 2026). Only after the base mix is fixed.

### Why
- Mix is a LEVER: two models with identical architecture differ by mix. The
  documented 95.7%-web failure is the proof.
- Budgetting by category (not "download everything") makes the model's competence
  envelope match the product (web-builder + general language).

### Expected bugs / issues
- Mix proportions measured in docs vs tokens — always budget in TOKENS, convert
  with the real tokenizer.
- A category with great per-doc quality but tiny size (chat_prose) can be
  over-upweighted into repetition — enforce a per-source max share (e.g. ≤20%).
- Changing the mix mid-pretraining changes the loss curve — freeze mix.yaml at
  launch (immutable copy in the run dir, Phase 5).

---

## 7. Val / Test Holdout Discipline

### What to do
- Lock the val/test SPLIT by hash (doc-id → split assignment committed in
  `data/splits.json`). Never random-split at load time.
- Val: ~0.1% of corpus, stratified across categories. Test: ~0.1%, STRICTLY never
  touched during training or model selection.
- Both are excluded from ALL training stages (pretrain AND post-train — an SFT
  pair that quotes a val doc is contamination).
- Every split member is registered in the contamination protected set (§5).

### Why
- A held-out that is randomly re-split per epoch is not held out.
- Model selection on the test set = fitting the test set (the classic small-lab
  silent error; Google Rules of ML #32).

### Expected bugs / issues
- val/test doc appears in a synthetic teacher round (teacher "learned" it) — scan
  generated docs against the protected set too.
- Splits stored per-path break when files move — store by doc hash.

---

## 8. Verification Checklist (Phase 3 DONE only when ALL pass)

- [ ] `inventory.csv` complete: every source graded A-F with reason, token estimate
      computed with the REAL Phase-2 tokenizer
- [ ] Filter pipeline runs in the documented order with per-stage JSONL checkpoints
      (crash-resumable)
- [ ] Zero-dup law enforced: exact + substring + MinHash(Jaccard≥0.8 drop) run
      globally; `dedup_audit.jsonl` lists every dropped doc with hash + reason
- [ ] Contamination scan: no train doc shares ≥8 13-grams with val/test/benchmarks;
      protected set includes all val/test + benchmark samples
- [ ] Mix design in TOKENS with per-category filters and per-source max share;
      chat/prose coherence block present (this machine's documented gap)
- [ ] Val/test split locked by hash in `splits.json`; excluded from ALL stages;
      never re-split at load
- [ ] Synthetic/generated docs passed the SAME 5-gate pipeline as scraped docs
- [ ] Every doc in the staged corpus is unique against the global index
- [ ] Budget math documented: target tokens/param, actual tokens staged, gap noted

---

## 9. Dependencies Summary

fasttext-langid (language), numpy (dedup/DSIR), tokenizers 0.20+ (token counting),
pyyaml (mix config), hashlib/xxhash (dedup hashes), jsonl I/O only. NO downloading
of pre-built corpora is required (this project uses its own sources + teacher
synthesis), but if a public corpus is used it still passes this whole pipeline.

---

## 10. When Done

Mark Phase 3 complete in AGENT_NOTES with the final mix (category → tokens),
grading table, dedup stats, contamination result. Then proceed to Phase 4
(Corpus Tokenization & Cache): skill `pipeline-phase-4-tokenization-cache`.