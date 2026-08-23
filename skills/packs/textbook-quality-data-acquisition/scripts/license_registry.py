"""license_registry.py — Stage 0 legal lock: the machine-readable source registry.
Every source must be registered with a license class + commercial verdict BEFORE
any download. This file is the single source of truth for what may enter the corpus.
Usage: python license_registry.py --check  (validates the registry, prints veto violations)
"""
import json, sys

REGISTRY = {
    "cosmopedia_v2":      {"license": "apache-2.0",          "commercial": True,  "attribution": False, "source_of_record": "HuggingFaceTB/cosmopedia card", "veto_reason": None},
    "smollm_corpus":      {"license": "odc-by",              "commercial": True,  "attribution": True,  "source_of_record": "HuggingFaceTB/smollm-corpus card", "veto_reason": None},
    "fineweb_edu":        {"license": "odc-by",              "commercial": True,  "attribution": True,  "source_of_record": "HuggingFaceFW/fineweb-edu card", "veto_reason": None},
    "finemath":           {"license": "odc-by",              "commercial": True,  "attribution": True,  "source_of_record": "HuggingFaceTB/finemath card", "veto_reason": None},
    "gutenberg":          {"license": "public-domain",       "commercial": True,  "attribution": False, "source_of_record": "gutenberg.org (US PD)", "veto_reason": None},
    "standard_ebooks":    {"license": "cc0",                 "commercial": True,  "attribution": False, "source_of_record": "standardebooks.org", "veto_reason": None},
    "us_gov":             {"license": "public-domain",       "commercial": True,  "attribution": False, "source_of_record": "17 USC 105", "veto_reason": "strip 3rd-party embedded content"},
    "saylor":             {"license": "cc-by-3.0",           "commercial": True,  "attribution": True,  "source_of_record": "saylor.org/books", "veto_reason": None},
    "pmc_oa_comm_ccby":   {"license": "cc-by",               "commercial": True,  "attribution": True,  "source_of_record": "NLM file list license column", "veto_reason": "filter to CC BY only"},
    "openstax_legacy":    {"license": "cc-by-4.0",           "commercial": True,  "attribution": True,  "source_of_record": "osbooks repo LICENSE / crumb/openstax-text", "veto_reason": "verify PER BOOK (current site is NC)"},
    "arxiv_abstracts":    {"license": "cc0-metadata",        "commercial": True,  "attribution": False, "source_of_record": "arXiv API CC0 metadata", "veto_reason": None},
    "arxiv_ccby_full":    {"license": "cc-by",               "commercial": True,  "attribution": True,  "source_of_record": "OAI-PMH license field", "veto_reason": "CC-licensed subset ONLY"},
    "tiny_codes":         {"license": "mit",                 "commercial": True,  "attribution": True,  "source_of_record": "nampdn-ai/tiny-codes card", "veto_reason": None},
    # TIER 2 — SA conditional (decision required)
    "wikipedia":          {"license": "cc-by-sa-4.0",        "commercial": "SA-CONDITIONAL", "attribution": True, "source_of_record": "dumps.wikimedia.org", "veto_reason": "requires SA-compatible public release — DECISION REQUIRED"},
    # TIER 3 — vetoed (NC/ND)
    "openstax_current":   {"license": "cc-by-nc-sa-4.0",     "commercial": False, "attribution": False, "source_of_record": "openstax.org/license", "veto_reason": "NC"},
    "ck12":               {"license": "custom-nc",           "commercial": False, "attribution": False, "source_of_record": "ck12.org", "veto_reason": "NC"},
    "libretexts_default": {"license": "cc-by-nc-sa",         "commercial": False, "attribution": False, "source_of_record": "libretexts.org", "veto_reason": "NC (BY/SA/PD pages only via common-pile subset)"},
    "mit_ocw":            {"license": "cc-by-nc-sa-4.0",     "commercial": False, "attribution": False, "source_of_record": "ocw.mit.edu", "veto_reason": "NC"},
    "khan_academy":       {"license": "cc-by-nc-sa",         "commercial": False, "attribution": False, "source_of_record": "khanacademy.org", "veto_reason": "NC"},
    "wikihow":            {"license": "cc-by-nc-sa",         "commercial": False, "attribution": False, "source_of_record": "wikihow.com", "veto_reason": "NC"},
    "acl_anthology":      {"license": "cc-by-nc",            "commercial": False, "attribution": False, "source_of_record": "aclanthology.org", "veto_reason": "NC"},
    "medrxiv":            {"license": "cc-by-nc-nd",         "commercial": False, "attribution": False, "source_of_record": "medrxiv.org", "veto_reason": "NC-ND — no training data per CC"},
    # TIER 4 — unknown (vetoed)
    "vikp_textbook_quality": {"license": "UNKNOWN",          "commercial": False, "attribution": False, "source_of_record": "vikp/textbook_quality_programming — no license field", "veto_reason": "UNKNOWN"},
    "open_phi_textbooks": {"license": "UNKNOWN",             "commercial": False, "attribution": False, "source_of_record": "open-phi/textbooks — no license field", "veto_reason": "UNKNOWN"},
    "tiny_textbooks":     {"license": "apache-2.0-dialog",   "commercial": False, "attribution": False, "source_of_record": "nampdn-ai/tiny-textbooks — 'research purposes only' in card", "veto_reason": "contractual risk"},
}

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        violations = []
        for name, info in REGISTRY.items():
            if info["commercial"] is False:
                violations.append(f"VETOED: {name} ({info['veto_reason']})")
            elif info["commercial"] == "SA-CONDITIONAL":
                violations.append(f"SA-CONDITIONAL: {name} — decision required before use")
        print(f"registry: {len(REGISTRY)} sources")
        if violations:
            print("\n".join(violations))
        else:
            print("no veto violations — all registered sources commercially clean")
    else:
        print(json.dumps(REGISTRY, indent=2))

if __name__ == "__main__":
    main()