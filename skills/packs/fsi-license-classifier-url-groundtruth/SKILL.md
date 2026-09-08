---
name: fsi-license-classifier-url-groundtruth
description: Classify dataset-license metadata strings (HuggingFace, Common Pile, custom scrapes) by treating the URL fragment in the license text as the GROUND TRUTH and only falling back to human-readable label regex when no URL is present. Use whenever a corpus-acquisition script must filter documents by license (CC-BY, CC-BY-SA, CC-BY-NC, GFDL, Public Domain, etc.) and the source provides license metadata in a string that may contain a creativecommons.org URL. Triggered by the twice-fail law — apply at the start of any license-filter design, not after the first false drop.
---

# License Classifier — URL is Ground Truth

## Failure pattern

A corpus-acquisition script classifies document license using regex on the human-readable label ("Creative Commons - Attribution - ..."), not the URL fragment ("...creativecommons.org/licenses/by/4.0/"). When the human-readable label has dash-separators between words (e.g., "Creative Commons - Attribution" instead of "Creative Commons Attribution"), the regex `\b(creative\s+commons\s+attribution)\b` fails to match — the `\s+` requires adjacent whitespace, but the actual string has a dash. The result: **CC-BY docs are silently classified as DROP**, keep rate collapses (e.g., 1.2% instead of ~98%), and the corpus is 100x smaller than budgeted.

Same pattern with NC/ND: human-readable label may say "Non-Commercial" or "No Derivatives" or "NC" / "ND" abbreviations, but the URL fragment `by-nc`, `by-nd`, `by-nc-sa`, `by-nc-nd` is exact. The URL never has dash-vs-space ambiguity.

## Law (per R8)

**URL first, label second. Always.** In any license classifier, attempt to match `creativecommons.org/licenses/<type>/` BEFORE attempting to match the human-readable label. The label is a hint, the URL is the contract.

## Implementation pattern

```python
import re

# URL fragments (ground truth — the actual creativecommons.org URL
# encodes the license type exactly)
URL_BY = re.compile(r"creativecommons\.org/licenses/(by|by)/", re.I)
URL_BYSA = re.compile(r"creativecommons\.org/licenses/by-sa/", re.I)
URL_BYNC = re.compile(r"creativecommons\.org/licenses/by-nc(?:-nd|-sa)?(?:-nd)?", re.I)
URL_BYND = re.compile(r"creativecommons\.org/licenses/by-nd", re.I)
URL_GFDL = re.compile(r"gnu\.org/licenses/fdl|gnu\.org/copyleft/fdl", re.I)
URL_PD = re.compile(r"creativecommons\.org/publicdomain", re.I)
URL_CC0 = re.compile(r"creativecommons\.org/publicdomain/zero", re.I)

# Label regex (fallback for rows without a URL)
PD_GOOD = re.compile(r"\b(public\s+domain|pd)\b", re.I)
CC0_GOOD = re.compile(r"\b(cc0|cc\s*0)\b", re.I)
BY_GOOD = re.compile(r"\b(cc[- ]?by|creative\s+commons\s+attribution)\b", re.I)
SA_GOOD = re.compile(r"\b(share[- ]?alike|sa)\b", re.I)
NC_BAD = re.compile(r"\b(non[- ]?commercial|nc)\b", re.I)
ND_BAD = re.compile(r"\b(no[- ]?derivatives|nd)\b", re.I)
GFDL_BAD = re.compile(r"\b(gfdl|gnu\s+free\s+documentation)\b", re.I)

def classify_license(raw: str) -> str:
    if not raw:
        return "DROP"
    t = raw.lower()
    # 1. URL is the ground truth
    if URL_GFDL.search(t):
        return "DROP"
    if URL_BYNC.search(t) or URL_BYND.search(t):
        return "DROP"  # any NC/ND combination is zero-tolerance
    if URL_PD.search(t) or URL_CC0.search(t):
        return "PD"
    if URL_BYSA.search(t):
        return "CC-BY-SA"
    if URL_BY.search(t):
        return "CC-BY"
    # 2. Human-readable label fallback
    if NC_BAD.search(t) or ND_BAD.search(t) or GFDL_BAD.search(t):
        return "DROP"
    is_pd = bool(PD_GOOD.search(t)) or bool(CC0_GOOD.search(t))
    is_by = bool(BY_GOOD.search(t))
    is_sa = bool(SA_GOOD.search(t))
    if is_pd:
        return "PD"
    if is_by and is_sa:
        return "CC-BY-SA"
    if is_by:
        return "CC-BY"
    return "DROP"  # unknown = drop
```

## What went wrong on 2026-09-05

`E:\pip_temp\opencode\acquire_libretexts.py` v1 used label-only classification. Test run on 5000 Common Pile LibreTexts docs:
- 58 PD kept (1.2%)
- 4942 dropped, of which:
  - 3307 CC-BY 4.0 (should have been kept)
  - 1311 CC-BY-SA 4.0 (operator's later directive: also keep)
  - 206 CC-BY 3.0
  - 60 CC-BY-SA 3.0
  - 56 GFDL (correctly dropped)
  - 2 PD (dropped by exact-dup or too-short, not by license filter)

After applying URL-first + label-fallback pattern, the same 5000 docs yielded:
- 4844 kept (96.8%)
- 58 PD, 3458 CC-BY, 1328 CC-BY-SA
- 61 dropped (license or exact-dup), 95 too-short
- 0 GFDL/NC/ND kept

## Verification protocol (per R1 evidence-first)

Before any corpus-acquisition run with a license filter, run a small test (100-1000 docs) and verify:
1. The keep rate is in the expected range (e.g., for LibreTexts Common Pile, expect >90% — the dataset is curated for openness).
2. Spot-check 3-5 dropped docs — confirm the drop reason (license, too-short, exact-dup) is correct.
3. Spot-check 3-5 kept docs — confirm they have the expected license verdict, not a misclassification.
4. If the keep rate is <50%, the filter is wrong. Investigate before scaling up.

## Threat matrix

- **License drift**: Common Pile / HF dataset maintainers occasionally change the license string format. The URL pattern is stable (it's part of the official CC URL scheme). The label can change. The URL-first approach is robust to label drift.
- **Custom licenses**: some books have "All Rights Reserved" or other proprietary terms. The fallback "no CC/PD marker = DROP" handles these correctly.
- **Multiple URLs in one string**: if a license string contains multiple URLs (unusual), the order of checks matters. URL_GFDL / URL_BYNC / URL_BYND are checked first because they are zero-tolerance; URL_PD / URL_BYSA / URL_BY are checked next. If a string has both a CC URL and a GFDL URL, the GFDL check wins (correct — be strict).
- **Non-English labels**: the label fallback only handles English. Non-English labels with no URL will be dropped. For multilingual corpora, extend the label regex set or rely on URL matching.

## Cross-references

- E:\pip_temp\opencode\acquire_libretexts.py (canonical implementation, post-fix)
- PIPELINE-DESIGN-2026-09-05.md §2.1 (locked filter spec: keep PD, CC-BY, CC-BY-SA; drop NC, ND, GFDL, unknown)
- AGENTS.md R8 (Fail Once → Stop → Research → Skill → Act → Verify)
- Project: FSI FELON cipher pretraining (50-150M, GTX 1060, textbook-only)

## R7 process-hygiene (hard rule reference)

Per AGENTS.md R7, before claiming any acquisition is "done", kill and verify dead every spawned process (HF streaming downloader, retry-thread, sub-Python). A stranded downloader can wedge the machine, hold a port, or eat bandwidth. Use Get-Process + 	askkill /F to confirm; the process-hygiene-sop skill has the verified recipe.
