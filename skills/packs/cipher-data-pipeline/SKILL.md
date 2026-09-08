---
name: cipher-data-pipeline
description: Prepare, tokenize, and shard the FSI Felon Cipher training corpus. Use when building the training data pipeline. Phase 2 of cipher-cloud-training.
---

# Phase 2: Training Data Pipeline

## Purpose
Convert 32,429+ curated docs into tokenized, sharded .pt files for cloud training. CPU-only work done locally.

## Corpus Sources
| Source | Location | Est tokens |
|--------|----------|------------|
| Gold cipher docs | `E:\queen-bee-v5\training_curated\` | ~45M |
| Training SOP docs | `E:\queen-bee-v5\training\` | ~5M |
| Gold corpus (code) | `E:\lab_training_corpus\ferrell_coder\gold_corpus.txt` | ~3.5M |
| Colony teacher traces | `E:\colony_teacher\` | ~75M |
| **Total available** | | **~130M** |

## Step 1: Tokenize
```python
import torch
from tokenizers import Tokenizer
from pathlib import Path

def tokenize_corpus(tokenizer_path, corpus_dirs, output_path, seq_len=2048):
    tokenizer = Tokenizer.from_file(tokenizer_path)
    bos_id = tokenizer.token_to_id("<s>")
    all_ids = []

    for d in corpus_dirs:
        for p in Path(d).rglob("*.txt"):
            text = p.read_text(encoding="utf-8", errors="ignore")
            if len(text) < 50: continue
            enc = tokenizer.encode(text)
            all_ids.append(bos_id)
            all_ids.extend(enc.ids)

    # Pad to seq_len multiple
    remainder = len(all_ids) % seq_len
    if remainder: all_ids.extend([0] * (seq_len - remainder))

    sequences = torch.tensor(all_ids, dtype=torch.long).view(-1, seq_len)

    # Split 95/5
    n = len(sequences)
    perm = torch.randperm(n)
    n_train = int(n * 0.95)

    output_path = Path(output_path)
    output_path.mkdir(exist_ok=True)
    torch.save({"sequences": sequences[perm[:n_train]]}, output_path / "train.pt")
    torch.save({"sequences": sequences[perm[n_train:]]}, output_path / "val.pt")
    print(f"Train: {n_train} seqs, Val: {n-n_train} seqs")
    return n_train

tokenize_corpus(
    "E:\\FSI-FELON\\models\\fsi_felon_cipher\\exports\\tokenizer_v5.json",
    ["E:\\queen-bee-v5\\training_curated", "E:\\queen-bee-v5\\training",
     "E:\\lab_training_corpus\\ferrell_coder"],
    "E:\\cipher_training_data",
    seq_len=2048
)
```

## Step 2: Shard
```python
import hashlib, json

def shard_data(data_path, shard_dir, shards=20):
    data = torch.load(data_path)["sequences"]
    shard_size = len(data) // shards
    shard_dir = Path(shard_dir); shard_dir.mkdir(exist_ok=True)
    manifest = []
    for i in range(shards):
        s, e = i*shard_size, (i+1)*shard_size if i<shards-1 else len(data)
        shard = data[s:e]
        path = shard_dir / f"shard_{i:04d}.pt"
        torch.save({"sequences": shard, "shard_id": i}, path)
        manifest.append({"path": str(path), "n_sequences": len(shard),
                         "checksum": hashlib.sha256(open(path,"rb").read()).hexdigest()})
    json.dump(manifest, open(shard_dir/"manifest.json","w"), indent=2)
    print(f"✓ {shards} shards created")

shard_data("E:\\cipher_training_data\\train.pt", "E:\\cipher_training_data\\shards_train")
shard_data("E:\\cipher_training_data\\val.pt", "E:\\cipher_training_data\\shards_val")
```

## Step 3: Verify
```python
def verify_shards(shard_dir, tokenizer_path):
    tok = Tokenizer.from_file(tokenizer_path)
    manifest = json.load(open(Path(shard_dir)/"manifest.json"))
    for s in manifest:
        d = torch.load(s["path"])
        seqs = d["sequences"]
        assert seqs.dim()==2 and seqs.shape[1]==2048
        assert seqs.min()>=0 and seqs.max()<32768
        decoded = tok.decode(seqs[0][:50].tolist())
        assert len(decoded)>0
    print(f"✓ All {len(manifest)} shards verified")

verify_shards("E:\\cipher_training_data\\shards_train", tokenizer_path)
```

## Upload Size
~8 MB/shard × 20 shards = ~160 MB total. Upload: <1 min.

## What NOT To Do
1. DO NOT tokenize on cloud (CPU work, wastes GPU money)
2. DO NOT skip document separators (model must learn boundaries)
3. DO NOT use variable-length sequences
4. DO NOT forget the manifest.json
5. DO NOT shard into <5 or >100 pieces

## Bugs
| Bug | Fix |
|-----|-----|
| Unicode decode errors | Use errors="ignore" |
| Empty sequences after tokenization | Filter sequences < 10 tokens |
| Tokenizer vocab mismatch | Verify path matches config |
| RNG not seeded | Set torch.manual_seed(42) |
