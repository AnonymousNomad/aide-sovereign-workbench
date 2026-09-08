# Skill: cloud-artifact-pack-upload (Phase C1)

# Artifact Pack & Upload — Corpus, Tokenizer, Code, Hashes

## Objective
Build ONE provider-neutral tarball containing everything a cloud box needs to
train from scratch: token shards, tokenizer, training code, config, and a
sha256 manifest. Upload it. Verify the upload byte-for-byte. DONE = remote hash
== local hash for every file in the manifest (round-trip law).

## What goes in the pack (inventory first — NEVER trust old manifests)
Audit loop per pipeline-excellence #2: verify CURRENT truth from disk before
packing:
1. **Token cache** — the Phase-4 uint16 shard set actually used by the last
   good local run. Count bytes; tokens = bytes/2 for uint16. Record measured
   count in the manifest. If corpus changed since tokenize → RE-TOKENIZE first;
   never pack stale shards with fresh code.
2. **Tokenizer** (tokenizer_v5 artifacts) + its checksum.
3. **Training code** — model definition (FSI_Trek/dual-mind modules), train
   script, resume/eval scripts, requirements.txt pin (`torch`, versions) so the
   cloud env is reproducible.
4. **Config lock** — the exact hyperparameters file (LR/warmup/schedule/
   clip/batch/seq) matching training-sop Stage-2 verified numbers.
5. **Held-out sets** — val/cloze suites shipped SEPARATELY inside the pack but
   clearly namespaced `eval/` (decontamination law: they must not be trainable).
6. **NOT included**: checkpoints from other runs (lineage confusion), venvs,
   caches (.git), API keys, AGENT_NOTES.

## Build procedure (run from project root)

```bash
PACK_DIR=E:\cloud_pack\pretrain_v1     # versioned dir, append-only lineage
mkdir -p "$PACK_DIR/staging"

# 1. stage files by COPY (never move — originals untouched)
cp -r <token_shards_dir>  "$PACK_DIR/staging/shards/"
cp -r <tokenizer_dir>     "$PACK_DIR/staging/tokenizer/"
cp -r <training_code>     "$PACK_DIR/staging/code/"
cp    config.lock.json    "$PACK_DIR/staging/code/config.lock.json"

# 2. sha256 manifest BEFORE tar (Windows-safe via WSL or python)
cd "$PACK_DIR/staging" && find . -type f -not -path "./eval/*" -exec sha256sum {} \; | sort > ../SHA256SUMS.pretrain.txt

# 3. tar (deterministic-ish; sort names)
cd "$PACK_DIR" && tar -czf pretrain_v1.tar.gz staging SHA256SUMS.pretrain.txt

# 4. hash the tarball itself
sha256sum pretrain_v1.tar.gz | tee pretrain_v1.tar.gz.sha256
```

## Upload paths (pick one at C0 discovery time)
| Path | When | How |
|---|---|---|
| Direct scp/rsync over SSH | instance already up, pack ≤ ~20GB, single window | `rsync -avP --checksum` (checksum forces post-transfer compare = built-in verification) |
| Object storage bucket | multi-session lane / big pack | provider CLI upload → verify ETag/sha256 → instance pulls URL |

Local upload bandwidth reality check (PC-management skill): assume ~10-30 Mbps
uplink typical residential → ~3GB/hour. If pack >> this, prioritize: shards are
the heavy part; code+tokenizer are KB-MB trivial.

## Verification battery (gate)
1. After upload: re-hash REMOTE copy of tarball; compare vs local `.sha256`.
2. On cloud box before unpack: same.
3. After unpack: run `sha256sum -c SHA256SUMS.pretrain.txt` INSIDE staging →
   must be all OK.
4. Negative control (teeth-check): corrupt one staged byte on purpose in a
   THROWAWAY copy → checker must FAIL. Then delete throwaway. (Proves the
   gate can fail — verification-complete STEP 5.)
5. Token-count assert on cloud box: measured shard bytes/2 == expected tokens
   from local inventory; mismatch ⇒ STOP, do not start training.

## Threat matrix
| Threat | Armor |
|---|---|
| Partial upload reads as valid gzip head | tarball-level + per-file level BOTH checked; `-c` full manifest |
| Old shards trained by new code (silent drift) | tokens-count assert + config.lock.json hashed into manifest |
| Held-out leakage into training inputs | eval/ excluded from SHA256SUMS used by loader; loader unit test asserts no eval/* path resolves |
| Secrets inside pack | grep pre-tar for key patterns (`BEGIN.*PRIVATE KEY`, `AKIA`, token-like strings); fail build |
| Disk space on cloud node exhausted mid-unpack | df -h check before unpack; require free ≥ 2×pack size |

## What NOT to do
- Never rsync without `--checksum` when "verifying" (size/mtime alone lies).
- Never pack .git, venv, logs — bloat + secret surface.
- Never "quickly rebuild shards on the cloud box" — determinism dies (6-RNG
  doctrine); ship the exact cached shards.

## Gate to C2
Remote-side `sha256sum -c` output logged in AGENT_NOTES with ALL OK + token
count matched + negative-control pass recorded.
