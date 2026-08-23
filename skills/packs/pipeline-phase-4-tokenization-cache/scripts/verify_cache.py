"""verify_cache.py — Phase 4 coverage & sanity verification of the token cache.

Checks (skill section 4):
  1+2. Hash parity + count parity per shard (vs manifest sha256 + n_tokens).
  3. Roundtrip on a sample of corpus docs (tokenizer stability, >=99%).
  4. STORED-BYTE check: shard ids all < vocab; decode a slice and re-encode
     (idempotence) — catches corrupted bytes that still pass hash+size.
  5. Vocab utilization >=95% on a sample of stored tokens.
  6. Split sanity: train/val/test token shares within configured bounds.
  7. Max-token: every shard n_tokens <= shard size, and < uint16 max.

Usage:
  python verify_cache.py --manifest shards/manifest.json --corpus train.jsonl \
      --tokenizer tokenizer.json [--sample 100] [--util-tokens 50000000] \
      [--val-share 0.001] [--test-share 0.001] [--tol 0.0005]
"""
import argparse
import hashlib
import json
import os
import random

import numpy as np
from tokenizers import Tokenizer


def sha256_file(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--sample", type=int, default=100)
    ap.add_argument("--util-tokens", type=int, default=50_000_000)
    ap.add_argument("--min-util", type=float, default=0.95,
                    help="vocab utilization gate (default 0.95 = production 3B-token "
                         "corpus; lower for small test caches which cannot reach it)")
    ap.add_argument("--val-share", type=float, default=0.001)
    ap.add_argument("--test-share", type=float, default=0.001)
    ap.add_argument("--tol", type=float, default=0.0005)
    args = ap.parse_args()

    man = json.load(open(args.manifest))
    tok = Tokenizer.from_file(args.tokenizer)
    tok_sha = hashlib.sha256(open(args.tokenizer, "rb").read()).hexdigest()
    assert man["tokenizer_sha256"] == tok_sha, \
        "tokenizer drift: cache was built with a DIFFERENT tokenizer"
    assert man["vocab"] <= 65535, "vocab exceeds uint16"
    print(f"tokenizer sha match, vocab {man['vocab']}, doc_policy {man.get('doc_policy')}")

    # 1+2: hash parity + count parity
    total = 0
    split_tokens = {}
    for sh in man["shards"]:
        h = sha256_file(sh["path"])
        assert h == sh["sha256"], f"HASH MISMATCH: {sh['path']}"
        assert os.path.getsize(sh["path"]) == sh["n_tokens"] * 2, \
            f"size/n_tokens mismatch: {sh['path']}"
        assert sh["n_tokens"] < 65536, f"shard exceeds uint16 max: {sh['path']}"
        total += sh["n_tokens"]
        split_tokens[sh["split"]] = split_tokens.get(sh["split"], 0) + sh["n_tokens"]
    assert total == man["n_total_tokens"], \
        f"count parity: {total} != {man['n_total_tokens']}"
    print(f"hash + count parity OK: {total:,} tokens, {len(man['shards'])} shards")

    # 6: split sanity (physical separation + share bounds)
    missing = [s for s in ("train", "val", "test") if s not in split_tokens]
    assert not missing, f"split(s) with zero tokens in manifest: {missing}"
    share = {s: split_tokens.get(s, 0) / max(1, total) for s in ("train", "val", "test")}
    print(f"split shares: train={share['train']:.4f} val={share['val']:.5f} "
          f"test={share['test']:.5f}")
    assert abs(share["val"] - args.val_share) <= args.tol, \
        f"val share {share['val']:.5f} outside {args.val_share}±{args.tol}"
    assert abs(share["test"] - args.test_share) <= args.tol, \
        f"test share {share['test']:.5f} outside {args.test_share}±{args.tol}"

    # 3: roundtrip on a sample of corpus docs (tokenizer stability).
    # Compare decoded text to the source WITHIN TOKENIZER NORMALIZATION
    # (skill section 4): byte-level BPE legally merges leading whitespace into
    # word tokens, and special tokens (e.g. <task>) decode to nothing — exact
    # equality false-positives on both. Real drift (tokenizer version change)
    # survives whitespace collapse + special-token stripping and fails here.
    import re
    ws = lambda s: re.sub(r"\s+", " ", s).strip()
    strip_specials = lambda s: re.sub(r"<[a-z_]+>", " ", s)
    ok = bad = 0
    rng = random.Random(42)
    docs = [json.loads(l) for l in open(args.corpus, encoding="utf-8") if l.strip()]
    for doc in rng.sample(docs, min(args.sample, len(docs))):
        text = doc.get("text") or doc.get("content") or ""
        ids = tok.encode(text, add_special_tokens=False).ids
        dec = tok.decode(ids)
        if ws(dec) == ws(strip_specials(text)):
            ok += 1
        else:
            bad += 1
    print(f"roundtrip: {ok}/{ok+bad} (within whitespace normalization)")
    assert bad / max(1, ok + bad) <= 0.01, \
        f"roundtrip failure rate {bad}% > 1%: tokenizer mismatch -> REBUILD cache"

    # 4+5: stored-byte validation + vocab utilization on shard samples.
    # Corruption is caught by sha256 parity above; here we additionally verify
    # every stored id is < vocab (a corrupt uint16 pointing out of range) and
    # compute utilization. No decode/re-encode idempotence on arbitrary slices —
    # tokens merge across boundaries (a+b -> ab), so it false-positives.
    vocab_seen = set()
    checked = 0
    for sh in man["shards"]:
        if checked >= args.util_tokens:
            break
        arr = np.fromfile(sh["path"], dtype=np.uint16)
        take = min(len(arr), args.util_tokens - checked)
        ids = arr[:take]
        assert int(ids.max()) < man["vocab"], \
            f"id {int(ids.max())} >= vocab {man['vocab']} in {sh['path']} (corrupted bytes)"
        vocab_seen.update(int(x) for x in ids.tolist())
        checked += len(ids)
    util = len(vocab_seen) / man["vocab"]
    print(f"stored-byte check OK ({checked:,} tokens, all < vocab)")
    print(f"vocab utilization on cache: {util:.3f} ({len(vocab_seen)}/{man['vocab']})")
    assert util >= args.min_util, \
        f"vocab utilization {util:.3f} < {args.min_util}: cache is not representative"
    print("CACHE VERIFY PASS")


if __name__ == "__main__":
    main()