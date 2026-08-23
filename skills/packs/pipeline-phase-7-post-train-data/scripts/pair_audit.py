"""pair_audit.py — Phase 7 per-item verification gate for SFT/distill/preference pairs.
Deterministic checks ONLY (no LLM-judge, no vibes). Fails loud: no-gold = FAIL.
Usage: python pair_audit.py --pairs sft_chat.jsonl --window 1024 --max-tokens 800 [--check-contamination corpus_index.json]
Exit 0 = all clean. Prints per-kind stats + every rejected pair reason.
"""
import argparse, hashlib, json, re, sys

MIN_ANSWER = 12          # chars — vacuous-empty guard
MAX_ANSWER = 1200        # chars — capacity-matched ceiling (tokenized later)
ENVELOPE_MARKERS = ["<envelope", "ENVELOPE", "SOP:", "CREED_CONTEXT"]
WEB_TEMPLATE_MARKERS = ["pricing", "hero", "cta", "footer", "nav", "logo_cloud"]

def norm(s):
    return re.sub(r"\s+", " ", s.lower()).strip()

def check(pair, window, max_tokens, checksum_ok):
    reasons = []
    instr = pair.get("instruction") or pair.get("prompt") or ""
    ans = pair.get("answer") or pair.get("chosen") or ""
    kind = pair.get("kind", "unknown")
    if not instr.strip():
        reasons.append("empty instruction")
    if not ans.strip():
        reasons.append("empty answer")
    elif len(ans) < MIN_ANSWER:
        reasons.append(f"answer too short ({len(ans)} < {MIN_ANSWER})")
    elif len(ans) > MAX_ANSWER:
        reasons.append(f"answer too long ({len(ans)} > {MAX_ANSWER} chars) — capacity gate")
    if any(m in ans.upper() for m in ENVELOPE_MARKERS):
        reasons.append("envelope marker in answer")
    if kind == "web" and any(m in norm(ans) for m in WEB_TEMPLATE_MARKERS):
        reasons.append("web template marker in answer")
    if pair.get("no_gold") is True:
        reasons.append("NO-GOLD held-out prompt — must FAIL per honest-gate law")
    if checksum_ok and "checksum" in pair:
        h = hashlib.sha1(norm(ans).encode("utf-8")).hexdigest()[:12]
        if h != pair["checksum"]:
            reasons.append("checksum mismatch — answer changed after staging")
    return reasons

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", required=True)
    ap.add_argument("--window", type=int, default=1024)
    ap.add_argument("--max-tokens", type=int, default=800)
    ap.add_argument("--check-contamination", default=None)
    args = ap.parse_args()

    n = ok = 0
    by_kind = {}
    rejected = []
    with open(args.pairs, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            pair = json.loads(line)
            n += 1
            k = pair.get("kind", "unknown")
            by_kind[k] = by_kind.get(k, 0) + 1
            reasons = check(pair, args.window, args.max_tokens, True)
            if reasons:
                rejected.append((pair.get("id", "?"), k, reasons))
            else:
                ok += 1

    print(f"pairs={n} passed={ok} rejected={len(rejected)}")
    print("by kind:", by_kind)
    for pid, k, reasons in rejected:
        print(f"  REJECT [{k}] {pid}: {'; '.join(reasons)}")

    if args.check_contamination and ok:
        # light contamination: 13-token overlap vs pretrain doc hashes is done in
        # Phase 3; here we only check the pairs file is self-consistent
        seen = set()
        dups = 0
        for line in open(args.pairs, encoding="utf-8"):
            line = line.strip()
            if not line:
                continue
            pair = json.loads(line)
            key = norm(pair.get("instruction", "")) + "||" + norm(pair.get("answer", ""))
            if key in seen:
                dups += 1
            seen.add(key)
        print(f"self-duplicates in file: {dups}")
        if dups:
            sys.exit(2)

    sys.exit(0 if len(rejected) == 0 else 1)

if __name__ == "__main__":
    main()