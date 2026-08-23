---
name: pipeline-phase-4-tokenization-cache
description: Phase 4 of the from-scratch training pipeline — corpus tokenization and caching. Two-pass uint16 shard build with the Phase-2 tokenizer, Windows-safe I/O (no mmap sharing, num_workers=0, spawn-proof), manifest + per-shard checksums, deterministic split assignment by doc hash, and the coverage/fertility/val verify gates. Use when converting the curated Phase-3 corpus into train-ready token shards, rebuilding after a tokenizer or corpus change, or debugging "cache misses", "shard drift", or OOM-at-load in the dataloader.
---

# Phase 4 — Corpus Tokenization & Cache

The curated corpus (Phase 3) becomes a fixed, verifiable, immutable binary cache.
Tokenizing once and caching means: (1) the trainer never re-tokenizes (the
single biggest small-model time sink), (2) every epoch sees identical tokens
(determinism), (3) the shard manifest + checksums catch any drift or corruption.
This is the boundary between DATA (text) and TRAINING (tokens).

Research sources: nanoGPT prepare.py, Pythia (2104.00061) preprocessed data,
SmolLM2 (2502.02737) tokenization pipeline, HuggingFace datasets memory-map docs,
PyTorch DataLoader notes, tokenizers (BPE) docs.

---

## 1. Output Format (uint16 shards)

### What to do
- Tokenize the ENTIRE curated corpus (Phase 3 output) with the Phase-2 tokenizer.
- Store as **uint16 numpy memmap shards** (`.bin`), one shard per ~100-200MB of
  tokens (or per source file for big files), plus a `.manifest.json`:
  ```json
  {
    "shards": [
      {"path": "shard_000.bin", "n_tokens": 12345678, "sha256": "...",
       "split": "train", "source": "web_general"},
      ...
    ],
    "tokenizer": "sha256-of-tokenizer.json",
    "vocab": 9302,
    "n_total_tokens": 987654321,
    "created": "2026-08-16T00:00:00Z",
    "params": {"seq": 1024, "version": 1}
  }
  ```
- Per-doc boundaries preserved in a companion `.offsets` file IF per-doc masking
  or sampling is needed (else skip: packed streaming is fine for pretrain).

### Why
- uint16 holds vocab 9302 with headroom (max 65535); half the memory of int32.
- A binary cache removes tokenization from the training loop entirely: epochs are
  pure sequential reads — the fastest possible on Windows with `num_workers=0`.
- Manifest + sha256 makes the cache auditable: a corrupted shard is caught before
  it silently trains garbage.
- Memmap lets the trainer load only what it reads; no 2-3GB in-RAM load.

### Expected bugs / issues
- numpy memmap + multiprocessing on Windows: `mmap_mode` shares via the OS pager
  BUT worker spawn re-opens; safest is `num_workers=0` (Phase-1 law) — no shared
  memmap across processes.
- uint16 overflow if a future tokenizer exceeds 65535 vocab — assert in the build
  script (manifest stores vocab; loader asserts <= 65535).
- Tokenizer version drift between build and load → different ids for the same
  text. Manifest stores tokenizer sha256; loader asserts it matches.
- Writing a shard then crashing mid-write → partial shard. Write to `.tmp`, then
  `os.replace` + hash after close (atomic, Phase-1 pattern).
- Text with BOM/encoding issues → tokenizer emits weird ids. Normalize to UTF-8
  in Phase 3; verify with a roundtrip sample in Phase 4.

---

## 2. Two-Pass Build (Windows-safe)

### What to do
**Pass 1 (count):** stream every doc, tokenize (batch, not one-by-one), count
total tokens per shard-slot. Output only counts + per-file token totals. No
writing of tokens yet.
**Pass 2 (fill):** re-stream, tokenize identically, write uint16 tokens into the
pre-allocated shard files at the recorded offsets. Deterministic order — the
exact same iteration order as Pass 1 (this is why we count first: array sizes are
known, no append-mode races).

Rules:
- `num_workers=0`, single process, streaming with `for line in f` (no load-all).
- Batch tokenize with `tokenizer.encode_batch` (fast) but keep the STREAM order.
- `\n` handling: decide once (keep as token or as separator) — encode_batch strips
  control chars; use `add_special_tokens=False` for pretrain shards (BOS/EOS are
  added by the loader, or not at all for packed streaming — pick one and document).
- Every shard write is atomic (tmp + replace) and hashed AFTER close.

### Why
- Two-pass is deterministic and crash-safe: a crash in Pass 2 re-fills from the
  recorded counts without re-counting; a crash in Pass 1 loses nothing but time.
- Pre-allocation avoids the classic Windows append-on-shared-file corruption
  (two writers, interleaved writes).
- Streaming means the build fits in RAM no matter the corpus size (a 3B-token
  corpus is ~6GB on disk, ~600MB in streaming memory).

### Expected bugs / issues
- Pass 1 and Pass 2 must iterate the EXACT same files in the EXACT same order
  (sorted path list, fixed sort key) — a different order shifts offsets and
  corrupts shards silently.
- Re-tokenizing to count then again to fill doubles wall time — acceptable for a
  one-time build; do NOT re-run Pass 1 unless the tokenizer changed.
- If the tokenizer changes AFTER Phase 4 (Phase 2 mistake caught late), the WHOLE
  cache rebuilds — this is why Phase 2 verified the tokenizer before Phase 4.

---

## 3. Split Assignment (deterministic, hash-locked)

### What to do
- Phase 3 produced `splits.json` (doc-hash → train/val/test). Phase 4 must honor
  it EXACTLY: the split assignment is decided by doc hash at the DOC level, and
  the shard manifest carries `"split"` per shard.
- Packing policy: docs stream into shards in split order (train docs into train
  shards etc.). A doc crossing a shard boundary is a soft error — either split
  the doc at the boundary (padding-free) or pad the shard; PICK ONE and encode in
  the manifest (`"doc_policy": "split_at_boundary" | "pad"`).
- Val/test shards are physically separated (val_000.bin, test_000.bin) — a trainer
  bug that samples test is impossible when the path prefix differs.

### Why
- Deterministic split = reproducible metrics. Random-split-at-load silently
  changes the eval set every epoch (Phase-3 law, Google Rules of ML #32).
- Physically separate val/test shards make contamination-by-lazy-loader
  structurally impossible.

### Expected bugs / issues
- Doc-hash split vs file-path split disagreement (same doc in two files) — resolve
  by doc-hash as the single source of truth; the manifest is derived from it.
- A doc longer than a shard-slot (pathological 10MB line) — cap doc size in Phase
  3 (max-bytes gate) so no doc exceeds a shard; assert in Pass 2.
- Test shards accidentally included in the train manifest glob (loader filters by
  manifest "split", never by directory scan).

---

## 4. Coverage & Sanity Verify (before ANY training)

### What to do
After the build, run `verify_cache.py`:
1. **Count parity**: sum(shard n_tokens) == manifest n_total_tokens.
2. **Hash parity**: re-hash every shard; matches manifest sha256.
3. **Roundtrip**: sample 100 random docs → decode tokens → text must match the
   original within whitespace normalization (catch tokenizer drift).
4. **Fertility/utilization on cache**: mean tokens/doc, vocab utilization ≥95%
   (Phase-2 gate, re-checked on the final cache).
5. **Split sanity**: train/val/test token shares within expected bounds
   (e.g. val ≈ 0.1% ± 0.05%, test ≈ 0.1% ± 0.05%).
6. **Max-token check**: no single shard beyond uint16 or seq-multiple surprise
   (loader asserts shard size % (seq*?) == 0 OR manifest says padding allowed).

### Why
- The loader trusts the cache; verify makes the trust earned, not assumed.
- Roundtrip catches the classic "tokenizer version changed silently" drift that
  looks like a mysterious loss plateau.

### Expected bugs / issues
- Whitespace normalization in roundtrip must match the tokenizer's decoder —
  byte-level BPE roundtrips losslessly; subword BPE may differ on spaces. Use the
  tokenizer's own `decode` for the check, not manual joins.
- If roundtrip fails on >1% of samples: tokenizer mismatch → REBUILD the cache
  (never "patch" shards; that breaks hash parity and determinism).

---

## 5. Verification Checklist (Phase 4 DONE only when ALL pass)

- [ ] Manifest exists: every shard has path/n_tokens/sha256/split/source; tokenizer
      sha256 recorded; vocab recorded
- [ ] Pass 1 counts == Pass 2 fill (no silent offset drift)
- [ ] All shard hashes match the manifest (corruption check passed)
- [ ] Roundtrip: ≥99/100 sampled docs decode to original text (within
      tokenizer-normalization)
- [ ] Vocab utilization ≥95% on the final cache; fertility sane
- [ ] Val/test in physically separate shards; train/val/test shares within bounds
- [ ] Atomic writes used everywhere (no partial shard possible)
- [ ] Loader smoke: read 10 random shards end-to-end with the Phase-5 loader
      prototype, first/last token sanity, no OOM at 16GB RAM
- [ ] `n_total_tokens` matches the Phase-3 budget within ±2% (gap documented)

---

## 6. Dependencies Summary

tokenizers 0.20+ (pinned, same as Phase 2), numpy 2.x (uint16 memmap), hashlib
(sha256), jsonl stream I/O. No torch needed for the build (pure CPU). Loader side
(Phase 5) reuses the same manifest schema — the manifest IS the contract between
Phases 4 and 5.

---

## 7. When Done

Mark Phase 4 complete in AGENT_NOTES with manifest stats (n shards, n tokens,
hash parity, roundtrip %, utilization). Then proceed to Phase 5 (Pretrain Code):
skill `pipeline-phase-5-pretrain-code`.