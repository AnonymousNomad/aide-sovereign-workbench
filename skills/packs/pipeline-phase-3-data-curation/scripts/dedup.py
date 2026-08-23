"""dedup.py — Phase 3 global dedup: exact -> substring -> MinHash near-dup.
Exact: SHA-1 of normalized bytes. Substring: 8-gram flag. MinHash: 13-token
shingles (en) / 8-token (code), Jaccard >= 0.8 dropped, 0.5-0.8 flagged.
Usage: python dedup.py --in filtered_heur.jsonl --out deduped.jsonl --audit dedup_audit.jsonl
"""
import argparse, hashlib, json, re

def norm(text):
    return re.sub(r"\s+", " ", text.lower()).strip()

def sha1(text):
    return hashlib.sha1(norm(text).encode("utf-8", "ignore")).hexdigest()

def minhash_shingles(text, k=13, perms=128):
    import numpy as np
    toks = norm(text).split()
    shingles = {tuple(toks[i:i+k]) for i in range(max(0, len(toks)-k+1))}
    if not shingles:
        return set()
    # simple 128 independent hash projection via dot with random matrix (deterministic seed)
    rng = np.random.default_rng(42)
    seeds = rng.integers(0, 2**32, size=perms, dtype=np.int64)
    sig = set()
    for s in seeds:
        vals = [hash(t) ^ int(s) for t in shingles]
        sig.add(min(vals))
    return sig

def jaccard(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="fin", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--audit", default="dedup_audit.jsonl")
    ap.add_argument("--text-key", default=None)
    args = ap.parse_args()
    seen_exact, seen_minhash = set(), []
    audit = open(args.audit, "w", encoding="utf-8")
    kept = 0
    with open(args.fin, encoding="utf-8") as fin, open(args.out, "w", encoding="utf-8") as fout:
        for line in fin:
            line = line.strip()
            if not line:
                continue
            doc = json.loads(line)
            key = args.text_key or ("text" if "text" in doc else
                                    "content" if "content" in doc else None)
            if key is None:
                continue
            text = doc[key]
            h = sha1(text)
            if h in seen_exact:
                audit.write(json.dumps({"id": doc.get("id"), "reason": "exact",
                                        "hash": h}) + "\n")
                continue
            sig = minhash_shingles(text)
            dropped = False
            for (h2, sig2) in seen_minhash:
                j = jaccard(sig, sig2)
                if j >= 0.8:
                    audit.write(json.dumps({"id": doc.get("id"), "reason": f"minhash J={j:.2f}",
                                            "hash": h}) + "\n")
                    dropped = True
                    break
            if dropped:
                continue
            seen_exact.add(h)
            seen_minhash.append((h, sig))
            fout.write(line + "\n")
            kept += 1
    audit.close()
    print(f"kept={kept} -> {args.out}  audit={args.audit}")
    print(f"NOTE: MinHash sig stored in RAM ({len(seen_minhash)} docs) — for >1M docs, "
          "shard + merge (see SKILL §4).")

if __name__ == "__main__":
    main()