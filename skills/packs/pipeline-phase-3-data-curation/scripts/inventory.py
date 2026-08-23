"""inventory.py — Phase 3 corpus inventory + token estimation with the REAL tokenizer.
Usage: python inventory.py <root_dir> <tokenizer.json> --out inventory.csv
Walks all jsonl/txt/json under root, reports file count, bytes, docs, est tokens.
"""
import argparse, json, os, sys
from tokenizers import Tokenizer

EXTS = {".jsonl", ".txt", ".json", ".parquet"}

def count_docs(path):
    if path.endswith(".txt"):
        return None  # single blob
    n = 0
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                n += 1
    except Exception:
        pass
    return n

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("tokenizer", nargs="?", default=None)
    ap.add_argument("--out", default="inventory.csv")
    args = ap.parse_args()
    tok = Tokenizer.from_file(args.tokenizer) if args.tokenizer else None

    rows = []
    for dirpath, _, files in os.walk(args.root):
        for fn in sorted(files):
            if not fn.endswith(tuple(EXTS)):
                continue
            p = os.path.join(dirpath, fn)
            size = os.path.getsize(p)
            docs = count_docs(p)
            est = int(size / 4) if not tok else None  # placeholder, refined below
            rows.append((dirpath, fn, size, docs, est))
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        import csv
        w = csv.writer(f)
        w.writerow(["dir", "file", "bytes", "docs", "est_tokens"])
        w.writerows(rows)
    total = sum(r[2] for r in rows)
    print(f"{len(rows)} files, {total/1e6:.1f} MB total -> {args.out}")
    print("NOTE: est_tokens=bytes/4 is a rough figure; refine with the REAL tokenizer"
          " on a sample when tokenize-time arrives (Phase 4).")

if __name__ == "__main__":
    main()