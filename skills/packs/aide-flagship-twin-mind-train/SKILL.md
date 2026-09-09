---
name: aide-flagship-twin-mind-train
description: Continue and productionize the CipherV2 twin-mind MoE flagship pretrain (preset local140a50, ~146.5M total, 48 routed experts = 24 Sheldon + 24 Spock + 2 shared, top_k 8, quorum 2/population) on THIS machine GTX 1060 6GB fp32-only Windows. Use whenever resuming/continuing the flagship pretrain, launching the v6 trainer for local140a50, probing VRAM/throughput, running the 6-check twin-mind battery, or deciding batch/seq/curriculum for the flagship run. Verified-shape commands, dependency matrix, threat matrix, and the gate battery included; never guess a flag.
---

# AIDE Flagship Twin-Mind MoE — Pretrain Continuation SOP

## The Mission

Train the in-house AIDE model: a **twin-mind MoE** where the routed expert pool is
split into two typed populations that are structurally forced to disagree
(Sheldon = rule/checklist/adversarial; Spock = probability/synthesis), with a
shared consensus pool and a per-token quorum so BOTH minds act on every token.
This is the committed, user-approved size lane: **~150M total** (fits the 100-150M
hard cap). The architecture already exists and has a parked 300-step checkpoint;
the job is probe -> continue -> gate -> SFT -> serve.

## Verified Reality (this machine, 2026-09-10) — DO NOT RE-VERIFY, DO NOT GUESS

| Fact | Value | Where |
|---|---|---|
| Training Python | `E:\felon_workspace\venv_py310\Scripts\python.exe` → torch 2.7.1+cu118, CUDA True | bash check 2026-09-10 |
| SFT/convert Python (tokenizers) | `E:\felon_workspace\venv_cipher\Scripts\python.exe` (tokenizers 0.23.1) | AGENT_NOTES 2026-09-08 |
| Trainer | `E:\FSI-FELON\models\fsi_felon_cipher\train_v6.py` (presets: local30a12, local140a50, 600a150, 1200a200, sft_local30a12) | train_v6.py |
| Architecture | `cipher_arch.py` `cipher_cfg("local140a50")` | cipher_arch.py |
| Flagship params | 146.5M total; MoE 110M; 16 blocks all-S (zero_attention); MoE on 14/16 | `python cipher_arch.py --preset local140a50` (verified) |
| Flagship expert split | n_routed=48 (24 Sheldon + 24 Spock), n_shared=2, top_k=8, quorum=2/pop, n_micro_router=8, softmax-after-topk, LBL+zloss+xpop | cipher_cfg + NanobotRouter/NanobotMoE |
| Flagship dims | d=512, L=16, n_heads 8, n_kv 2, hd 64, expert_d_ff 96, grad_ckpt=True, vocab 24025 | cipher_cfg |
| Checkpoint | `checkpoints_v6\best_local140a50.pt` = step 300, loss 8.867, full state (model+optimizer+scheduler+cfg), 1646 MB, 390 model keys | torch.load dump 2026-09-10 |
| Measured VRAM | seq 512/batch4 = 3.18 GB, ~378 tok/s; seq 1024 = 4.38 GB; all fp32 | metrics_local140a50.csv |
| Textbook shards | `E:\shards_v6\train_512\` libretexts+gutenberg, max_seq 512, 497,742 train / 62,217 val rows, 318.5M tokens, shard_size 2000 | manifest.json |
| Generalist shards | `E:\shards_v6\generalist_512\` wikipedia+python_code+gutenberg, max_seq 512, 1.71M train / 214K val rows, 877.6M tokens, shard_size 4096 | manifest.json |
| SFT shards (cross-synth) | `E:\shards_v6\sft_cross_1024_fix\` 960 pairs (768/192), max_seq 1024, loss-masked, 516,514 loss tokens, tokenizer v6 | manifest.json |
| No step ckpts for local140a50 | step_local140a50_* were pruned/corrupted (000300/000600 on 9/7); only best+final remain → continuation must use `--base-ckpt` (model-only, fresh optimizer) | checkpoints listing |

## Dependency Matrix (what must be true BEFORE each action)

| Action | Depends on | Gate |
|---|---|---|
| VRAM probe | venv_py310 torch CUDA; no other GPU consumer (nvidia-smi <100MB foreign); AC power; model forward OK | `python cipher_arch.py --preset local140a50` run + preflight |
| Continue pretrain | probe passed <5GB; corpus shards present; `--base-ckpt` opens (strict=False load); first 20 steps finite+decreasing | live first-20-steps watch |
| SFT (phase 8) | pretrain flagship reach Gate 0; sft_cross_1024_fix shards; marker-weight args (5/3/1.0 policy, NEVER 20/20/20 flat) | Gate 1 byte-exact >=80% |
| Close-the-loop | served flagship + trajectory capture + emitted signal | selfimprove wiring (AIDE side) |

## Threat Matrix (failure modes known on THIS machine)

| Threat | Symptom | Guard / Recovery |
|---|---|---|
| VRAM OOM at seq 1024 | CUDA OOM ~step 25-30 (MoE+16-layer SSM activations) | grad_ckpt=True (already in preset); probe first; if OOM, batch 2 at 1024 or seq 768 |
| Checkpoint corruption mid-save | half-written zip (9/7 146.5M run lost step_000300/000600) | atomic save is in train_v6 (`.tmp` + `os.replace`); verify file loads BEFORE trusting |
| Resume-schedule drift | fresh `--base-ckpt` run restarts cosine from step 0 | BY DESIGN here: base-ckpt = model-only + fresh optimizer/cosine. Total `--steps` governs the schedule shape; do not mix with step-ckpt resume |
| NaN loss | loss non-finite | trainer skips (20-skip cap then abort); restore last clean step ckpt |
| Stray processes | stale llama-server/python eats RAM/GPU | preflight + `Get-Process python,llama-server`; kill offenders (R7) |
| Corpus mismatch | class names invented in gen | only `train_512`/`generalist_512`/`sft_cross_1024_fix` exist; never pass any other dir to --shard-dir |
| Marker-attractor loop (SFT) | `<|im_start|>/<|credo|>` repetition, no im_end | marker weights IM=5 CREDO=3 END=1.0 (sft-format-marker-loop skill); never flat 20 |
| Windows bash `ChildProcess.kill` | spurious "Unknown: ChildProcess.kill" noise | verify processes with `Get-Process`/nvidia-smi, not kill return codes (AGENTS R7) |
| Battery | GPU -53% | training only on AC |

## Exact Commands (verified shapes; adjust only steps/seq/batch per probe)

### 1. Preflight (before ANY probe or launch)

```powershell
nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv
Get-Process python -ErrorAction SilentlyContinue | Select-Object Id, CPU, WorkingSet, Path
Get-Process llama-server -ErrorAction SilentlyContinue | Select-Object Id, CPU
```

### 2. VRAM/throughput probe (live, 20 steps on the real corpus)

```powershell
& "E:\felon_workspace\venv_py310\Scripts\python.exe" -u `
  "E:\FSI-FELON\models\fsi_felon_cipher\train_v6.py" `
  --preset local140a50 --fresh `
  --shard-dir E:\shards_v6\generalist_512 `
  --seq 512 --batch 4 --lr 5e-4 --warmup 0 `
  --steps 20 --stop-at 20 --ckpt-every 99999
```
PASS: loss finite at step 1 (~ln(24025)=10.09), decreases by step 5, grad-norm sane,
`vram_gb < 5.0` in every printed row, tok/s reasonable (probe target: fit 2269 tok/s
sweet-spot territory scaled down for MoE; the 9/7 run showed 340-380 tok/s late at
seq 512 — MoE + SSM scan is slower than the dense baseline). If `vram >= 5.0` → batch 2.

### 3. Continue flagship pretrain (verified launch shape)

```powershell
& "E:\felon_workspace\venv_py310\Scripts\python.exe" -u `
  "E:\FSI-FELON\models\fsi_felon_cipher\train_v6.py" `
  --preset local140a50 `
  --base-ckpt E:\FSI-FELON\models\fsi_felon_cipher\checkpoints_v6\best_local140a50.pt `
  --shard-dir E:\shards_v6\generalist_512 `
  --steps 2000 --batch 4 --lr 5e-4 --warmup 200 `
  --eval-every 250 --ckpt-every 500 --best-by-eval
```
Chunked-run pattern (twice-fail law / bash-kill survival): keep `--steps` = full total
(2000 = schedule shape), add `--stop-at N` per chunk (e.g. resume chunk = `--stop-at` the
run's target). Step ckpts auto-resume the optimizer/scheduler when present; base-ckpt only
start once. NEVER `--fresh` on a continuation.

### 4. SFT phase (after Gate 0), marker-safe weights

```powershell
& "E:\felon_workspace\venv_py310\Scripts\python.exe" -u `
  "E:\FSI-FELON\models\fsi_felon_cipher\train_v6.py" `
  --preset sft_local30a12 `
  --base-ckpt <gate-0 flagship or pilot base> `
  --shard-dir E:\shards_v6\sft_cross_1024_fix `
  --target-shard-dir E:\shards_v6\sft_cross_1024_fix `
  --seq 1024 --batch 2 --lr 5e-5 `
  --marker-w-im 5.0 --marker-w-credo 3.0 --marker-w-end 1.0 --best-by-eval
```

## The 6-Check Twin-Mind Gate Battery (claim is MEASURED or FAIL)

Run on a decoded sample set (CRUXEval/HumanEval-style coding solves + dual-mind
traces) AFTER the flagship passes Gate 0, BEFORE promotion to SFT+serve:

1. **Both-population activation floor**: per-layer histograms show >= quorum(2)
   experts from EACH population active on >=95% of tokens. Log during training.
2. **Expert overlap S-vs-K < 0.3**: pairwise activation/Jaccard overlap between
   Sheldon and Spock populations stays below 0.3 after the run (target from
   Advancing Expert Specialization 2505.22323). FAIL –> raise L_xpop weight.
3. **Disagreement rate >= 0.5**: fraction of tokens where S-router and K-router
   top choices differ. Trending to 0 = minds merged = design failure.
4. **Synthesis lift**: samples where both populations voted (quorum-satisfied)
   pass eval at a HIGHER rate than single-population-dominated samples.
5. **Adversarial ablation**: disable ONE population at decode → pass@1 must
   DROP. No drop = typed populations are decoration = FAIL the claim. This is
   the load-bearing test.
6. **Train/serve parity**: same top-k masks + gate outputs at train vs decode
   (batch-invariant routing; no batch-coupled state). The architecture already
   enforces this (stateless per-call state, softmax-after-topk); verify once.

## Rules

- FP32 only, always (Pascal has no Tensor Cores; --no-amp is implicit in v6).
- Never DataLoader(num_workers>0) — the v6 trainer streams shards directly (correct).
- Never run on battery. Preflight before every GPU action.
- Keep `--steps` = full schedule total across chunks; only `--stop-at` varies.
- After any launch/crash: verify the process is dead AND no strays (`Get-Process`)
  before claiming done (AGENTS R7).
- Update `E:\FSI-FELON\AGENT_NOTES.md` after every checkpoint event with step/loss/VRAM.
- Research anchors (fetched): 2505.22323 expert specialization, 2506.02890 fine-grained
  MoE G8, MoE-Bench z-loss, softmax-after-topk; self-consistency (Wang 2022) and debate
  (Irving 2018) for the twin-mind claim; SIMBAL 2506.14038 (router-collapse); Chi 2204.09179.

## Skill Cross-Refs

- Architecture/battery authority: `twin-mind-expert-colony` skill.
- Device constraints (authoritative on physics): `device-training-1060`.
- Marker-loop SFT fix (FAIL if ignored): `sft-format-marker-loop`.
- Persistence: `agent-notes` (append to E:\FSI-FELON\AGENT_NOTES.md).
- Public wording: COGNITIVE TYPES (rule-adversarial vs probabilistic-synthesis),
  never trademarked persons (twin-mind-expert-colony naming rules).