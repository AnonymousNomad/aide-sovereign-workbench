---
name: textbook-quality-data-acquisition
description: The textbook-quality corpus acquisition doctrine for small from-scratch models — buy/donwload/scrape ONLY textbook-grade data (user directive: zero trash data, textbooks only). Verified license matrix (Tier 1 commercial-clean USE / Tier 2 caution / Tier 3 NC-avoid / Tier 4 unknown-avoid), the phi-1/phi-1.5 synthetic textbook recipe (20K topics, diversity constraints, classifier-filtered), Cosmopedia v2 (apache-2.0/odc-by) + FineWeb-Edu + OpenStax + Gutenberg + Standard Ebooks + Saylor + PMC-CC-BY + arXiv-CC-BY acquisition plan, exact download commands (verified 2026-08-20), and the Stage 0 legal lock registry. Use whenever sourcing training data, choosing a corpus source, deciding license questions, building the Phase-3 mix, or defending a data-acquisition decision for the 150M/queen-bee-v5 rebuild.
---

# Textbook-Quality Data Acquisition (zero trash, textbooks only)

User directive (2026-08-16): **only textbook-quality training documents. No trash
data. Download or scrape textbooks — either is fine.** This skill is the
research-verified playbook for acquiring such data legally and at scale, and the
phi-1/phi-1.5 evidence that textbook-quality data is the ENTIRE strategy for a
small model. Research completed and verified live 2026-08-20 (URLs hit, license
fields read, sizes confirmed from live listings).

**DIRECTIVE LOCKED (2026-08-21): TEXTBOOKS ONLY.** No web corpora (FineWeb-Edu
OUT), no code/SO-derived data (tiny-codes OUT), no research abstracts (arXiv/PMC
OUT), no fiction collections (Standard Ebooks OUT). Corpus = real textbooks +
synthetic textbooks (Cosmopedia v2 format=textbook). Anti-collapse law still
applies: keep >=20% real human text in the final mix.

**VERIFIED LICENSE KILL (2026-08-21): OpenStax is FULLY OUT.** The GitHub
`openstax/osbooks-*` repos carry **CC BY-NC-SA 4.0** root LICENSE files
(verified live on osbooks-us-history and enforced across all 25 repos by the
acquisition gate — every one vetoed). The `crumb/openstax-text` legacy mirror
is **404/dead** (verified). Earlier belief that osbooks = legacy CC BY is FALSE.
Do not re-add OpenStax without a new per-book license verification.

**VERIFIED VOLUME REALITY (2026-08-21): Saylor GitHub course repos are SHELLS.**
26 diverse intro courses cloned = 337 markdown files, **4.7 MB total (~1M tok)**
— unit summaries, not full textbook text. Keep as attribution-tracked garnish;
do not count on Saylor for volume. Real-textbook volume must come from
Gutenberg non-fiction (PD) + the LibreTexts PD/CC-BY subset below.

---

## 1. Why textbook quality (the evidence)

- **phi-1 (2306.11644):** a 350M model on 7B filtered tokens beat a 350M model on
  200B unfiltered tokens (17.68% vs 12.19% HumanEval; +synthetic textbooks →
  20.12%). A 1.3B model reached 29%. **Filtering is the entire point.**
- **phi-1.5 (2309.05463):** synthetic-textbook variant beat web-only variants on
  most reasoning benchmarks at the same compute. The report's central claim:
  dataset construction beats raw compute.
- **SmolLM (2502.02737):** 135M/360M trained on FineWeb-Edu + Cosmopedia —
  textbook-quality mix is the proven recipe at our exact scale.
- **Our own documented failure:** the 150M base was trained 95.7% on web-template
  data → format-lock/template-collapse (coherence 0/20). Token VOLUME was never
  the problem; token QUALITY/domain was. Textbook-grade prose is the fix.

---

## 2. THE LICENSE MATRIX (verified 2026-08-20 — print this, never guess)

### TIER 1 — CLEAN COMMERCIAL USE (USE / USE-WITH-ATTRIBUTION)

| Source | URL | License | Size | Verdict |
|---|---|---|---|---|
| **Cosmopedia v0.1/v2** | `hf.co/datasets/HuggingFaceTB/cosmopedia` | **Apache-2.0** (card VERIFIED) | 31M rows · 92 GB · 25B tok; v2 39M rows · 28B tok | ✅ **USE** |
| **SmolLM-Corpus** | `hf.co/datasets/HuggingFaceTB/smollm-corpus` | **ODC-By** (card VERIFIED) | 237M rows: cosmopedia-v2 + fineweb-edu-dedup + python-edu | ✅ **USE** |
| **FineWeb-Edu** | `hf.co/datasets/HuggingFaceFW/fineweb-edu` | ODC-By 1.0 | 1.3T tok (score≥3); keep ≥4 for textbook-grade | ✅ **USE** |
| **FineMath** | `hf.co/datasets/HuggingFaceTB/finemath` | ODC-By 1.0 | 34–54B math tok | ✅ **USE** |
| **Project Gutenberg** | `gutenberg.org` + `common-pile/project_gutenberg` | **PUBLIC DOMAIN** | ~75K books · ~6B tok | ✅ **USE** |
| **Standard Ebooks** | `standardebooks.org` | **CC0** | ~1,100 titles | ✅ **USE** |
| **US Gov works** | NASA · NIH/NLM · NIST · NAP.edu | **PUBLIC DOMAIN** (17 USC §105) | handbooks/textbooks | ✅ **USE** (strip 3rd-party) |
| **Saylor Academy** | `saylor.org/books` + GitHub `saylordotorg` | **CC BY 3.0** | ~100+ textbooks | ✅ **USE-WITH-ATTRIBUTION** |
| **PMC OA commercial** | `ftp.ncbi.nlm.nih.gov/pub/pmc/deprecated/oa_bulk/oa_comm/xml/` | **CC BY / CC0** (filter!) | ~1.4–2M articles · 233 tar.gz | ✅ **USE** (CC BY only) |
| **OpenStax** | `openstax.org/apps/cms/api/books/?format=json` | **CC BY 4.0** (majority) | ~100 live books · 25–40M tok | ✅ **USE-WITH-ATTRIBUTION** (verify per book!) |
| **arXiv abstracts** | `export.arxiv.org` API + OAI-PMH | **CC0 metadata** | 2.5M+ · 3–4B tok | ✅ **USE** (abstracts only) |
| **arXiv CC-BY subset** | via OAI-PMH license field filter | **CC BY** (minority) | 100–200M tok | ⚠️ USE (CC subset only) |
| **bioRxiv CC BY subset** | biorxiv.org | per-article CC BY | 200K+ | ⚠️ USE (CC BY only) |
| **tiny-codes** | `hf.co/datasets/nampdn-ai/tiny-codes` | **MIT** | 1.6M snippets · 980 MB | ✅ **USE** (code reasoning) |

### TIER 2 — CAUTION (resolve before use)

| Source | License | Verdict |
|---|---|---|
| Wikipedia / Simple English / Wikibooks / Wikijunior | **CC BY-SA 4.0** + GFDL | ⚠️ **SA-CONDITIONAL**: commercial training OK; public release of model/outputs must be SA-compatible (CC's 2025 guidance). DECISION REQUIRED (see §7). |
| tiny-strange-textbooks | Apache-2.0 card + gated | ⚠️ read full card for research-only clauses |
| SciPhi textbooks-are-all-you-need-lite | Llama-2 license | ⚠️ commercial OK <700M MAU; self-declared |

### TIER 3 — RESTRICTED (AVOID-NC — hard no for commercial)

| Source | License |
|---|---|
| OpenStax CURRENT (openstax.org/license) | **CC BY-NC-SA 4.0** (changed!) — legacy CC BY via GitHub osbooks/crumb mirror only |
| CK-12 FlexBooks | Custom non-commercial |
| LibreTexts (majority) | **CC BY-NC-SA** (BY/SA/PD sections only OK — see §5) |
| MIT OpenCourseWare | CC BY-NC-SA |
| Khan Academy | CC BY-NC-SA |
| WikiHow | CC BY-NC-SA |
| ACL Anthology / ACL-OCL | CC BY-NC / CC BY-NC-SA |
| medRxiv | CC BY-NC-ND (ND = no training data at all, per CC) |

### TIER 4 — UNLICENSED / UNKNOWN (AVOID — ALWAYS)

| Source | Why |
|---|---|
| `vikp/textbook_quality_programming` | NO license field (VERIFIED). Code MIT, data unlicensed. |
| `open-phi/textbooks` | NO license field (VERIFIED). |
| `nampdn-ai/tiny-textbooks` | apache-2.0 dropdown BUT card says "research purposes only" — contractual risk |
| S2ORC aggregate | ODC-By covers corpus, NOT underlying papers |
| arXiv default-license full text | arXiv distribution license ≠ your redistribution rights |

**Rule:** HF license dropdowns are UI, not legal clearance. **Verify against the
source of record** (the book/author/journal), because >70% of popular datasets
have no license and ~50% of tagged ones are wrong (Data Provenance Initiative).

---

## 3. THE PHI RECIPE (synthetic textbook generation, in detail)

### phi-1 (7B tokens total)
1. Filtered code (~6B tok): The Stack + StackOverflow passed through a
   **language-model quality classifier** (trained to recognize high-quality code).
2. Synthetic textbooks (<1B tok): GPT-3.5 generated Python textbooks with
   **diversity injection** — prompt includes constraint sets on topics + target
   audience + random vocabulary/word constraints (Eldan & Li TinyStories trick)
   so the teacher cannot collapse onto its most-probable paths. **Only ~20% of
   raw candidates kept after filtering.**
3. Exercises (~180M tok): textbook-exercise-like problems + solutions
   (finetune stage; credited for emergent capabilities).

### phi-1.5 (scaling the recipe)
- ~20K carefully selected topics (common-sense, world knowledge, science, daily
  activity, theory of mind).
- **Diversity trick (verbatim):** "In our generation prompts, we use samples from
  web datasets for diversity" — real web snippets injected as seeds.
- 80% synthetic / 20% phi-1 mix. Trained 150B tokens seen, batch 2048, lr 2e-4
  CONSTANT, no warmup, wd 0.1.
- Ablations proved synthetic > web-only on reasoning.

### Cosmopedia (the open replication — apache-2.0, USE)
- Teacher: Mixtral-8x7B-Instruct-v0.1.
- 8 splits: `web_samples_v1/v2` (~75%, topic-clustered → 145 clusters, 35
  discarded, educational score per cluster), `stanford` (course outlines),
  `stories` (UltraChat world-questions + OpenHermes-2.5 seeds), `wikihow`
  (titles only, NOT the NC text), `openstax` (course outlines, NOT the NC text),
  `khanacademy` (outlines), `auto_math_text` (AutoMathText).
- Diversity: per-seed variation across audience (children → researchers) ×
  format (textbook/educational_piece/story/blogpost/wikihow/forum_post).
- Dedup: MinHash → **<1% duplicates**. Decontamination: 10-gram overlap vs
  MMLU/HellaSwag/PIQA/SIQA/Winogrande/OpenBookQA/ARC → discard if
  matched/benchmark_sample > 0.5.
- v2: BISAC book taxonomy (34K topics), audiences rebalanced (40% middle school /
  30% college / 30% mixed), +1B tok Python-code textbooks from AutoMathText.

### Our adaptation for the 150M (on THIS machine)
Teacher available: Qwen3.5-4B (local llama-server, ~3.4 tok/s). Generate
textbook-style docs with: seed prompts per topic (BISAC-style list), audience +
format variation, vocab constraints, ~20% keep rate with a quality gate, MinHash
dedup <1%, 10-gram decontamination. Yield is teacher-bound (~3.4 tok/s → ~300K
tok/hour → 1B tokens ≈ 140 days — NOT viable at scale on this machine; use
DOWNLOADED Cosmopedia/FineWeb-Edu as the volume backbone, and local teacher
generation only for gap-filling domain coverage).

---

## 4. DOWNLOAD RECIPES (verified 2026-08-20 — exact commands)

### A. OpenStax (CC BY, ~100 books, ~30M tokens)
```bash
curl -s "https://openstax.org/apps/cms/api/books/?format=json" -o books.json
jq -r '.[] | select(.book_state=="live") | .pdf_url' books.json > urls.txt
wget -U "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" -c -i urls.txt -P openstax_pdf/
```
NOTE: CloudFront 403s bare curl — browser UA MANDATORY (verified). The old CNX
archive (archive.cnx.org) is DEAD. Structured source = GitHub `openstax/osbooks-*`
repos (per-book LICENSE files). Current-site license is NC — use osbooks or the
crumb/openstax-text legacy mirror (CC BY 4.0 tag), verify per book.

### B. Wikipedia dumps (CC BY-SA — SA decision required first)
```bash
rsync -avP rsync://rsync.wikimedia.org/dumps.wikimedia.org/enwiki/latest/enwiki-latest-pages-articles-multistream.xml.bz2 .
# or
wget -c https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-pages-articles-multistream.xml.bz2   # 24.8 GiB (verified Aug 2026)
# Simple English (excellent small-model floor): 361.6 MB (verified)
wget -c https://dumps.wikimedia.org/simplewiki/latest/simplewiki-latest-pages-articles-multistream.xml.bz2
pip install wikiextractor
python -m wikiextractor.WikiExtractor enwiki-latest-pages-articles-multistream.xml.bz2 -o enwiki_text --json
```

### C. Gutenberg non-fiction (public domain, polite loop)
```bash
pip install gutenberg-books gutenfetchen
curl -s "https://gutendex.com/books?languages=en&copyright=false&sort=ascending" > pg_meta.json
# filter by bookshelves/subjects (Science, Technology, Mathematics...) then:
wget -c "https://www.gutenberg.org/cache/epub/<id>/pg<id>.txt"   # 2-5s sleep between fetches (robot policy)
```
`gutenberg-books` = polite by design (random 5s delays). `gutenfetchen` strips PG
boilerplate headers/footers.

**VERIFIED FALLBACK (2026-08-21): gutendex.com was DOWN (read timeouts on every
topic).** Robust path: `https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv.gz`
(official full catalog, few MB) → filter Type=Text, Language=en, non-fiction
subject keywords → fetch `cache/epub/{id}/pg{id}.txt` with 4s polite delay +
browser UA. This is what acquire_corpus.py uses now.

### D. PMC OA commercial (CC BY, JATS XML)
```bash
wget -c https://ftp.ncbi.nlm.nih.gov/pub/pmc/deprecated/oa_comm_use_file_list.csv   # 617 MB manifest, license column
wget -r -np -nH --cut-dirs=4 -A "*.tar.gz" https://ftp.ncbi.nlm.nih.gov/pub/pmc/deprecated/oa_bulk/oa_comm/xml/
# or S3 (Requester Pays):
aws s3 sync s3://pmc-oa-opendata/oa_comm/xml/all/ pmc_oa_comm/ --request-payer requester --region us-east-1
```
FTP layout note (verified): everything moved under `deprecated/` in 2021 redesign.
Filter to CC BY only via the license column in the file list CSV.

### E. Cosmopedia v2 / SmolLM-Corpus (the volume backbone)
```bash
pip install -U "huggingface_hub[cli]"
hf download HuggingFaceTB/smollm-corpus --repo-type dataset --include "cosmopedia-v2/*" --local-dir cosmopedia_v2
# or selective subsets by column filter in Python:
# datasets.load_dataset("HuggingFaceTB/smollm-corpus","cosmopedia-v2",split="train")
```

### F. arXiv abstracts only (CC0 metadata — the clean part)
```bash
# OAI-PMH for license field + abstracts: http://export.arxiv.org/oai2, verb=ListRecords, metadataPrefix=arXivRaw
# rate limit: 1 request / 3 s, single connection (VERIFIED ToU)
```

---

## 5. The LibreTexts nuance (verified)

Platform default is CC BY-NC-SA, BUT individual sections carry their own licenses
and many are CC BY / CC BY-SA / GFDL / public domain (it remixes OpenStax CC BY
content). The `common-pile/libretexts` HF dataset crawled the catalog and kept
**only sections whose license statement is PD/CC BY/CC BY-SA/GFDL**, exposing
per-doc `metadata.license` — that's the commercially-usable subset. Their
official extractor is GitHub `LibreTexts/shapeshift` (MIT). **Overlap warning:**
LibreTexts remixes OpenStax; Wikibooks shares provenance with Wikipedia — any mix
MUST run cross-source near-dup dedup, not just within-source.

**OUR FILTER (2026-08-21, stricter than common-pile):** stream
`common-pile/libretexts`, keep ONLY docs whose `metadata.license` resolves to
**Public Domain or CC BY (attribution, no NC/ND/SA/GFDL)** — SA excluded for
consistency with the Wikipedia exclusion ruling; NC/ND zero-tolerance; unknown =
veto. Schema verified live: columns id/text/source/added/created/metadata,
sample license "Creative Commons - Attribution - .../by/4.0/". This is now the
primary REAL-textbook volume source.

---

## 6. Acquisition Plan (150M target: ~1.5–3B textbook tokens)

Chinchilla = 20 tok/param → 3B; phi-1 used ~5.4 tok/param and won. Textbook
quality lets you undershoot. Order:

1. **Stage 0 — Legal lock (1 day, ~1 MB):** machine-readable source registry
   (source/url/license_class/commercial_ok/per_doc_license/attribution/veto_reason).
   Veto list pre-seeded: OpenStax-current, CK-12, LibreTexts-default, MIT OCW,
   Khan, WikiHow, ACL, medRxiv, S2ORC-as-is, tiny-textbooks, vikp, open-phi.
   Document the Wikipedia SA decision explicitly.
2. **Stage 1 — Synthetic backbone (download FIRST, largest clean volume):**
   Cosmopedia v2 selected splits (textbook + educational_piece formats,
   middle_school→college audiences — ~3–10 GB for ~1B tok) + FineWeb-Edu score≥4
   (~1–5 GB per 500M tok).
3. **Stage 2 — Real textbooks (the quality lever):** Saylor CC BY (~50–200 MB) +
   Gutenberg non-fiction shelves (~1–2 GB, 200–300M tok) + Standard Ebooks CC0
   (~1 GB) + US Gov handbooks (~100–500 MB) + OpenStax legacy CC BY (159 MB,
   40–60M tok).
4. **Stage 3 — Domain depth (optional):** PMC OA CC BY (~1–2 GB per 300M tok) +
   arXiv CC BY subset (~1–2 GB) + FineMath for math.
5. **Stage 4 — Curation (Phase-3 discipline over everything):** lang → heuristics
   → MinHash dedup (<1%) → DSIR → fineweb-edu-classifier (keep ≥3; score 0–5,
   apache-2.0) → contamination (10-gram vs eval set) → mix.

**LOCKED BLEND (2026-08-21, textbooks-only directive):** ~75-80% synthetic
textbook (Cosmopedia v2 `format=textbook`) · ~20-25% real human textbooks
(LibreTexts PD/CC-BY subset + Gutenberg non-fiction PD + Saylor garnish).
FineWeb-Edu/code/arXiv/PMC buckets REMOVED from the plan. Total target
~1.0-1.5B tokens (quality undershoot per phi doctrine; multi-epoch acceptable
at this scale).

---

## 7. Legal doctrine (the warnings)

1. **BY-SA:** commercial use permitted, but share-alike triggers on public
   release of model/outputs → must release under CC BY-SA. Wikimedia says most
   LLM training on Wikipedia does not comply (attribution + SA + no-downstream
   clauses clash with model EULAs). No binding precedent. **Decision required:
   release weights under CC BY-SA, or exclude Wikipedia. No middle ground.**
2. **NC binds at every stage** — copying, training, serving, distributing. Any NC
   token in a commercial model = per-stage breach. Zero tolerance.
3. **ND (medRxiv):** CC says ND content should NOT be used as training data at
   all. Hard veto.
4. **Unknown = avoid, always.** Verify against source of record, not HF dropdowns.
   Real verified cases: vikp + open-phi have NO license field; tiny-textbooks
   dropdown lies (research-only in body).
5. **License laundering:** permissive compilation license ≠ permissive content.
   Cosmopedia's openstax/khan/wikihow splits are seeded from NC content — the
   generated text is new (apache-2.0), but know what you sample.
6. **Memorization:** even clean licenses — a small model can reproduce passages
   verbatim. Run decontamination (10-gram + SequenceMatcher > 0.5) vs eval set.
7. **Synthetic collapse** (Shumailov, Nature 2024): synthetic-only training
   narrows + memorizes — keep 20–40% real human text in the mix.
8. **Not legal advice.** US litigation ongoing, EU CDSM differs, UK TDM new. A few
   hundred dollars of attorney review of the final registry is the highest-ROI
   spend in this project.

---

## 8. Verification Checklist (acquired corpus ready only when ALL pass)

- [ ] Legal lock registry exists; every source has license_class +
      commercial_ok; veto list enforced (zero NC/ND/unknown tokens in corpus)
- [ ] Attribution manifest per CC BY source (book/page URL lists retained)
- [ ] Download sizes match the estimates in §6; every file verified (size/hash)
- [ ] Cross-source near-dup dedup run (OpenStax↔LibreTexts, Wikibooks↔Wikipedia)
      — <1% duplicates
- [ ] Decontamination: 10-gram overlap vs eval set → 0 retained contaminated docs
- [ ] Quality classifier (fineweb-edu-classifier ≥3 or equivalent) applied;
      kept-rate documented
- [ ] Domain balance matches the mix plan (textbook/edu/prose/code shares)
- [ ] Every staged doc is unique against the global index (zero-dup law)
- [ ] Provenance recorded per doc (source, license, version, dump date)

---

## 9. Dependencies

huggingface_hub[cli], wget/curl/rsync, jq, wikiextractor, gutenberg-books /
gutenfetchen, tokenizers (Phase 2), numpy (dedup), fasttext-langid (Phase 3).
This skill feeds Phase 3 (mix design) and Phase 7 (post-train data) of the
10-phase pipeline — it is the SOURCING layer; curation law is
`pipeline-phase-3-data-curation`, corpus assembly is `pipeline-phase-4-tokenization-cache`.