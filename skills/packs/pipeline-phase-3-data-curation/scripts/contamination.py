"""contamination.py — Phase 3 train-vs-protected 13-gram contamination scan.
Protected set = val/test splits + benchmark samples (any text that will be
measured). ANY train doc sharing >=8 13-grams with protected -> EXCLUDED.
Usage: python contamination.py --train filtered.jsonl --protected protected.txt --out clean_train.jsonl
"""
import argparse, json, re

def ngrams(text, n=13):
    toks = re.findall(r"\w+", text.lower())
    return {tuple(toks[i:i+n]) for i in range(max(0, len(toks)-n+1))}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", required=True)
    ap.add_argument("--protected", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--min-overlap", type=int, default=8)
    args = ap.parse_args()
    with open(args.protected, encoding="utf-8") as f:
        prot_text = f.read()
    prot_ng = ngrams(prot_text)
    print(f"protected 13-grams: {len(prot_ng)}")
    kept = flagged = 0
    with open(args.train, encoding="utf-8") as fin, open(args.out, "w", encoding="utf-8") as fout:
        for line in fin:
            line = line.strip()
            if not line:
                continue
            doc = json.loads(line)
            text = doc.get("text") or doc.get("content") or ""
            ov = len(ngrams(text) & prot_ng)
            if ov >= args.min_overlap:
                flagged += 1
                continue
            fout.write(line + "\n")
            kept += 1
    print(f"kept={kept} flagged={flagged} (>= {args.min_overlap} shared 13-grams) -> {args.out}")

if __name__ == "__main__":
    main()