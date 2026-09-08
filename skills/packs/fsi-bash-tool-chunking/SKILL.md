---
name: fsi-bash-tool-chunking
description: When the bash tool environment kills long-running child processes (every command that takes >~5 min gets SIGKILLed at tool return), chunk the work into <5-min subtasks with stateful resume. Use whenever an acquisition, training, or tokenization step would take >5 min and must complete across multiple bash invocations. Triggered by the twice-fail law — apply at the start of any work that needs to survive the bash tool's process-kill behavior, not after the first silent time-out.
---

# Bash Tool Kills Long-Running Children — Chunked Work Pattern

## Failure pattern (2026-09-05, observed in 3 separate work attempts)

The bash tool environment used by this assistant has a process-hygiene policy that kills the entire process group when a bash command returns. This includes child Python processes. Symptom:

1. You launch `python some_script.py` in the foreground.
2. The script takes 3+ minutes to complete (e.g., tokenizing 200M tokens).
3. The bash tool returns (with the script's stdout/stderr captured) — but ONLY if the script finished first.
4. If the script takes >~5 min, the tool returns an "interrupted" error and the Python process is killed mid-run.
5. The output file may exist but is partially written (untrustworthy).
6. Background process launches via `start /B`, `Start-Process`, or `nohup` may survive a few seconds but get killed on the next tool call.

This means: **any single bash command that runs Python for >5 min is unreliable** in this environment.

## Law (per R8)

**For any work that would take >5 min: chunk it into <5-min subtasks, each writing its output to disk, with explicit resume logic if state is needed between chunks.**

## The 3 failure patterns to avoid

### Pattern 1: Big single command
```bash
# BAD: tokenize 200M tokens + write 400MB in one call (5+ min, gets killed)
python build_shards.py --corpus libretexts,gutenberg --seq-len 512
```

### Pattern 2: Detached background
```bash
# BAD: process survives a few seconds, then dies
start /B python train.py
```

### Pattern 3: Hope it finishes
```bash
# BAD: you can't tell if it ran to completion
python convert_shards.py  # 3 min, often killed
```

## The chunked pattern (3 subtasks, each <5 min)

### Subtask 1: Per-source shards (small enough for one tool call)
```python
# build_shard_single.py — operates on ONE file
# Libretexts: ~125M tokens, ~1.5 min tokenize + 0.5 min write
# Gutenberg: ~195M tokens, ~3 min tokenize + 0.5 min write
python build_shard_single.py --corpus X.jsonl --out-bin Y.bin --out-manifest Y.json
```

### Subtask 2: Concat + chunk (the slow step, but write to disk incrementally)
```python
# concat_and_convert.py — concat then write .npy shards
# The .npy writes are fast (300s for 249 train shards) but the tool
# captures the output and returns cleanly. If killed mid-write, the
# partial shards are still loadable (next .npy shards just won't exist).
python concat_and_convert.py --bin1 libre.bin --bin2 gut.bin --out-bin combined.bin
```

### Subtask 3: Training in checkpoints
```python
# Run training in N chunks of 50 steps each, saving checkpoint at end
# of each chunk. Resume from the latest checkpoint in the next call.
# 50 steps * 10s = 500s = 8.3 min — borderline. Use 30 steps to be safe.
# At step 30, save ckpt. Next call: resume from ckpt, run 30 more.
# 2000 steps = 67 chunks * 5 min = 5.5 hours spread over 67 bash calls.
```

## State management

For each chunk:
1. Write the result to a known disk path (`E:\shards_v6\libre.bin`, `E:\shards_v6\gut.bin`, etc.)
2. Include a manifest with sha256 + n_tokens + size
3. On the next call, CHECK the manifest first. If it exists, skip the chunk. If not, re-do.
4. The next chunk's script reads the manifest, not re-runs the work.

```bash
# Before each chunk, verify the previous chunk's output exists and is valid
if [ -f E:\shards_v6\libre.manifest.json ]; then
    echo "Libretexts shard already built, skipping"
else
    python build_shard_single.py --corpus libretexts.jsonl --out-bin libre.bin ...
fi
```

## What the bash tool CAN do reliably (<5 min each)

- Tokenize one source corpus (~1.5-3 min for 100-200M tokens)
- Concat two uint16 bins + chunk to .npy + 80/10/10 split (~3 min for 200M tokens)
- Train 30-50 steps of a 50M model (~3-5 min)
- Save + reload a checkpoint (~1 sec)
- Run 11-step smoke test (~30 sec)
- Run any test battery on fixtures (~5-30 sec)

## What the bash tool CANNOT do (>5 min)

- Full corpus tokenization in one call (the 1.2GB corpus takes 5+ min to load + 4 min to tokenize + 1 min to write = >10 min total)
- Full training run (2000 steps * 10s = 5.5 hours, way over)
- Long polite web crawls (Gutenberg crawl was 4 hours)
- Anything that hits a network rate-limit timeout

## Cross-references

- E:\pip_temp\opencode\build_shard_single.py (canonical chunked shard builder)
- E:\pip_temp\opencode\concat_and_convert.py (canonical concat + .npy converter)
- AGENTS.md R8 (Fail Once → Stop → Research → Skill → Act → Verify)
- Project: FSI FELON cipher pretraining (50-150M, GTX 1060, textbook + code)
