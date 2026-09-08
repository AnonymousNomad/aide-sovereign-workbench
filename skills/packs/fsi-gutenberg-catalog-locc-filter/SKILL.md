---
name: fsi-gutenberg-catalog-locc-filter
description: Acquire non-fiction Public Domain books from Project Gutenberg using the official pg_catalog.csv.gz with a LoCC-aware, fiction-exclusion filter. Use whenever corpus acquisition needs Public Domain textbook-style content and the source is Project Gutenberg. Triggered by the twice-fail law — apply at the start of any Gutenberg-based corpus design, not after the first silent zero-yield run.
---

# Project Gutenberg Catalog Acquisition — LoCC + Fiction Exclusion

## Failure pattern (two distinct bugs, both found in 2026-09-05 test runs)

### Bug 1: Wrong ID column name
The script assumed the catalog's ID column was `Id`, but the real PG catalog uses `Text#`. Every row's `row.get("Id")` returned empty string, the `pg_id.isdigit()` check failed silently, and the script `continue`d past every fetch. Result: `kept: 0, failed: 0, dropped: 0` (the no-op "complete" state).

### Bug 2: Subject-only non-fiction filter is insufficient
The first version of `is_nonfiction()` matched on subject keywords like "science", "math", "philosophy". The book "The warlord of Mars" (PG#68) has the Bookshelf "Science fiction" — which matches "science" via the keyword regex but is actually a novel. Result: 50/50 "non-fiction" books were mostly fiction (Martian novels, fantasy, adventure).

## Law (per R8)

**Use the actual PG catalog column names. Use LoCC as a primary non-fiction signal. Use a fiction-exclusion regex on Subjects AND Bookshelves.**

## Verified implementation

```python
# PG catalog columns (verified 2026-09-05 against the live catalog):
#   Text#, Type, Issued, Title, Language, Authors, Subjects, LoCC, Bookshelves
PG_ID_COL = "Text#"  # NOT "Id" — silent failure if you use the wrong name

# LoCC (Library of Congress Classification) — single letter or letter+digit
# Per the LoCC system, class "P" = Language & Literature (fiction, poetry,
# drama). Everything else is non-fiction: A (general), B (philosophy),
# C-F (history), G (geography), H (social sciences), J (political science),
# K (law), L (education), M (music), N (fine arts), Q (science), R (medicine),
# S (agriculture), T (technology), U (military), V (naval), Z (bibliography).
LOCC_NONFICTION = re.compile(r"^[A-OQ-Z]", re.I)  # any LoCC except 'P' = non-fiction

# Fiction/poetry/drama exclusion (regex on Subjects + Bookshelves)
FICTION_BAD = re.compile(
    r"\b(fiction|fantasy|novel|poetry|drama|plays?|verse|fairy\s+tales?|"
    r"short\s+stor(y|ies)|adventure|mystery|western|romance|horror|"
    r"juvenile\s+fiction|young\s+adult\s+fiction|children's?\s+fiction|"
    r"humor(?:ous)?|satire|fable)s?\b",
    re.I,
)

def is_nonfiction(subjects: str, locc: str = "") -> bool:
    if not subjects and not locc:
        return False
    # Fiction/poetry/drama exclusion always wins — drops "Science fiction" etc.
    if FICTION_BAD.search(subjects or ""):
        return False
    if FICTION_BAD.search(locc or ""):
        return False
    # Strong signal: non-P LoCC class is a textbook
    if locc and LOCC_NONFICTION.search(locc.strip()):
        return True
    # Fallback: subject keyword match
    if SCI_RE.search(subjects or ""):
        return True
    return False
```

## Verification protocol (per R1)

Before any production run, do a 50-book test (`--max-books 50`). Verify:
1. The kept titles are real non-fiction (open the first 5 with `head` and check).
2. The dropped counts are sane (typically 1-5 short/dup, 0-2 http failures).
3. The catalog row count is reasonable (50 books typically requires iterating 100-300 catalog rows; if it's <50, the filter is dropping everything).
4. The `failed (http): 0` count is not 0 ONLY if the script is silently failing (Bug 1 symptom).

If `kept: 0` and `failed: 0` and `dropped: 0`, the script is silently no-oping. Check the catalog column names (Text# not Id).

## Polite crawl parameters (per PG robots)

- 4s delay between fetches
- Browser User-Agent required
- Exponential backoff on 429/500/502/503/504 (start 4s, double up to 60s, 4 retries)
- Single connection, no parallel fetches
- Strip PG header (`*** START OF ... ***`) and footer (`*** END OF ... ***`)

## Threat matrix

- **Catalog format drift**: PG has changed the catalog column names historically. Always probe the live catalog with the probe_catalog.py utility before any run.
- **LoCC missing**: some early books have no LoCC value. The fallback to SCI_RE on Subjects handles this (slightly weaker — may let a few fiction books through, but the fiction-exclusion regex catches most).
- **Mislabeled books**: even with LoCC-aware filter, PG's metadata is human-edited and imperfect. For 50,000+ book runs, expect 1-3% noise. Run a post-acquisition classifier (length + char-distribution check) if purity matters.
- **PG servers are slow**: polite 4s delay assumes PG is healthy. If you see >50% HTTP failures, increase delay to 8-10s.

## Cross-references

- E:\pip_temp\opencode\acquire_gutenberg.py (canonical implementation, post-fix)
- E:\pip_temp\opencode\probe_catalog.py (catalog column probe utility)
- PIPELINE-DESIGN-2026-09-05.md §3.1 (locked Gutenberg budget)
- AGENTS.md R8 (Fail Once → Stop → Research → Skill → Act → Verify)
- Project: FSI FELON cipher pretraining (50-150M, GTX 1060, textbook-only)

## R7 process-hygiene (hard rule reference)

Per AGENTS.md R7, before claiming any acquisition is "done", kill and verify dead every spawned process (HTTP polite-crawler, retry-thread, sub-Python). A stranded crawler can wedge the machine, hold a port, or burn PG's bandwidth. Use Get-Process + 	askkill /F to confirm; the process-hygiene-sop skill has the verified recipe.
