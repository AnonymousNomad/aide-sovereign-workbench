"""build_cache.py — Phase 4 two-pass uint16 shard build (Windows-safe).

Pass 1: count tokens per shard-slot per split, write pass1_counts.json.
Pass 2: fill pre-allocated buffers, atomic shard writes, manifest with sha256.
Resume: a crash in Pass 2 re-fills from pass1_counts.json without re-counting.

Split discipline (skill section 3): splits.json maps doc-id -> train|val|test.
Shards are physically separated by prefix (train_0000.bin, val_0000.bin,
test_0000.bin) so a loader cannot accidentally sample test. Per-split slot
counters keep keys monotonic and unique; a key never receives tokens after it
is flushed. The same per-split arithmetic runs in both passes, and Pass 2
CROSS-CHECKS every key's written offset against the Pass 1 count.

Usage:
  python build_cache.py --corpus train.jsonl --tokenizer tokenizer.json --out shards/
                        [--shard-tokens 100000000] [--splits splits.json] [--pass1-only]
"""
import argparse
import hashlib
import json
import os
import time

import numpy as np
from tokenizers import Tokenizer

SPLITS = ("train", "val", "test")
PREFIX = {"train": "train_", "val": "val_", "test": "test_"}


def sha256_file(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def doc_id(doc):
    if doc.get("id"):
        return str(doc["id"])
    text = doc.get("text") or doc.get("content") or ""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def iter_docs(corpus_path):
    with open(corpus_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", required=True, help="jsonl of curated docs")
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--shard-tokens", type=int, default=100_000_000)
    ap.add_argument("--splits", default=None, help="splits.json: doc-id -> train|val|test")
    ap.add_argument("--pass1-only", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    tok = Tokenizer.from_file(args.tokenizer)
    tok_sha = hashlib.sha256(open(args.tokenizer, "rb").read()).hexdigest()

    splits = None
    if args.splits:
        splits = json.load(open(args.splits))
        assert set(splits.values()) <= set(SPLITS), "split values must be train|val|test"

    counts_path = os.path.join(args.out, "pass1_counts.json")

    # ---------------- Pass 1: count ----------------
    if os.path.exists(counts_path) and not args.pass1_only:
        counts = json.load(open(counts_path))
        print(f"Resume: pass1 counts loaded ({len(counts)} slots, no re-count)")
    else:
        counts = {}
        fills = {s: 0 for s in SPLITS}
        slots = {s: 0 for s in SPLITS}
        for doc in iter_docs(args.corpus):
            split = "train"
            if splits is not None:
                split = splits.get(doc_id(doc), "train")
            ids = tok.encode(doc.get("text") or doc.get("content") or "",
                             add_special_tokens=False).ids
            n = len(ids)
            if n >= args.shard_tokens:
                raise RuntimeError(
                    f"doc exceeds shard size: {n} tokens (max {args.shard_tokens}) "
                    f"— Phase 3 max-bytes gate violated")
            if fills[split] + n > args.shard_tokens:
                slots[split] += 1
                fills[split] = n
            else:
                fills[split] += n
            key = f"{PREFIX[split]}{slots[split]:04d}"
            counts[key] = counts.get(key, 0) + n
        json.dump(counts, open(counts_path, "w"), indent=2)
        per_split = {s: sum(v for k, v in counts.items() if k.startswith(PREFIX[s]))
                     for s in SPLITS}
        print("Pass 1:", ", ".join(f"{s}={per_split[s]:,}" for s in SPLITS),
              f"across {len(counts)} slots -> {counts_path}")
        if args.pass1_only:
            return

    # ---------------- Pass 2: fill (EXACT same order/arithmetic) ----------------
    totals = {s: 0 for s in SPLITS}
    fills = {s: 0 for s in SPLITS}
    slots = {s: 0 for s in SPLITS}
    bufs, offs, sources, written = {}, {}, {}, {}
    manifest = {"shards": [], "tokenizer_sha256": tok_sha, "vocab": tok.get_vocab_size(),
                "n_total_tokens": 0, "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "doc_policy": "split_at_boundary", "params": {"version": 1}}

    def flush(key):
        path = os.path.join(args.out, key + ".bin")
        tmp = path + ".tmp"
        bufs[key][:offs[key]].tofile(tmp)
        os.replace(tmp, path)
        manifest["shards"].append({"path": path, "n_tokens": offs[key],
                                   "sha256": sha256_file(path), "split": key.split("_")[0],
                                   "source": sources[key]})
        written[key] = offs[key]
        del bufs[key], offs[key]

    for doc in iter_docs(args.corpus):
        split = "train"
        if splits is not None:
            split = splits.get(doc_id(doc), "train")
        ids = tok.encode(doc.get("text") or doc.get("content") or "",
                         add_special_tokens=False).ids
        n = len(ids)
        if fills[split] + n > args.shard_tokens:
            slots[split] += 1
            fills[split] = n
            prev = f"{PREFIX[split]}{slots[split] - 1:04d}"
            if prev in bufs:
                flush(prev)
        else:
            fills[split] += n
        key = f"{PREFIX[split]}{slots[split]:04d}"
        if key not in bufs:
            bufs[key] = np.zeros(args.shard_tokens, dtype=np.uint16)
            offs[key] = 0
            sources[key] = doc.get("source") or doc.get("domain") or "unknown"
        bufs[key][offs[key]:offs[key] + n] = np.asarray(ids, dtype=np.uint16)
        offs[key] += n
        totals[split] += n
    for key in list(bufs):
        flush(key)

    # Pass 1 counts == Pass 2 fill (skill checklist item 2)
    assert set(counts) == set(written), \
        f"slot set drift: pass1 {set(counts)} vs written {set(written)}"
    for key in counts:
        assert counts[key] == written[key], \
            f"count mismatch {key}: pass1 {counts[key]} != written {written[key]}"
    n_total = sum(written.values())
    assert n_total == sum(totals.values())

    manifest["n_total_tokens"] = n_total
    manifest_path = os.path.join(args.out, "manifest.json")
    json.dump(manifest, open(manifest_path, "w"), indent=2)
    print("Pass 2:", ", ".join(f"{s}={totals[s]:,}" for s in SPLITS),
          f"| {len(manifest['shards'])} shards | cross-check OK")
    print(f"manifest: {manifest_path}  total={n_total:,}")


if __name__ == "__main__":
    main()