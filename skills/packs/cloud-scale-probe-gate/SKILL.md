# Skill: cloud-scale-probe-gate (Phase C2)

# Scale Probe & Token-Budget Lock — Measure, Then Commit

## Objective
Provision the instance, verify numerics, measure REAL tokens/sec of OUR
dual-mind arch at 139.7M on the rented GPU, then compute and LOCK the token
budget for the run window. DONE = probe numbers + locked budget recorded in
AGENT_NOTES and written into config.lock.json on the cloud box.

## Why (doctrine)
model-scaling law: "Probe on the GPU before committing any config… Never trust
paper estimates." Cloud expectations (45–160K tok/s band from MFU extrapolation)
are HYPOTHESES until this phase's prints land. Our arch is novel (dual-path
attention + debate gate + memory modules) — custom op mix means stock benchmarks
over- or under-state reality in unknown directions.

## Procedure

### Step 1 — Provision (smallest possible burn)
```bash
brev create c2probe -n 1          # name; confirm class matches C0 choice
brev ls                            # wait RUNNING; note instance id + time STARTED
```
Billing clock starts here — everything in this skill is scripted to finish
inside ~20 minutes. Idle = burned credits.

### Step 2 — Env reproducibility (from C1 requirements.txt)
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r code/requirements.txt   # pinned versions ONLY
nvidia-smi && python -c "import torch; print(torch.__version__, torch.cuda.get_device_name(0), torch.cuda.device_capability())"
```
Assert: CC ≥ 8.0 (Ampere) → bf16 legal per master-skill precision split.

### Step 3 — Unpack + hash gate (C1 battery) BEFORE any run.

### Step 4 — Numerics sanity (teeth for the bf16 switch)
Run 200 steps at seq 512 twice: fp32 and bf16, seed-identical.
Accept if: bf16 loss curve tracks fp32 within ~±0.05 absolute by step 200 and
no NaN/spike either lane. Diverges ⇒ precision bug in a module (look for manual
reductions lacking autocast guards) ⇒ fix on LOCAL copy first, re-upload.
(Pascal FP32-only law stays valid at home; do not "fix" by forcing fp32 cloud.)

### Step 5 — Throughput sweep (the actual point)
Three configs mirroring local sweet-spot logic, 60s each after 10-step warmup:
| Probe | micro-B | seq | expect |
|---|---|---|---|
| P1 | 16 | 512 | small-batch baseline |
| P2 | 64 | 512 | likely sweet spot |
| P3 | 32 | 1024 | long-ctx alternative |
Capture: tok/s = B×L×steps/wall, peak VRAM (torch.cuda.max_memory_allocated),
grad-norm stability. Record ALL THREE even if first looks great — one data
point is a vibe, three is a shape. Pick argmax throughput within <80% VRAM
(headroom for allocator spikes; the 5GB-spill lesson generalizes: past ~85%
VRAM, paging/expansion tanks wall-clock).

```bash
for cfg in P1 P2 P3; do python code/probe.py --cfg $cfg --steps 60 2>&1 | tee probe_$cfg.log; done
```

### Step 6 — LOCK the budget (arithmetic, in the log, before touching config)
```
productive_hours = window_hours − (startup+pack+eval reserve ≈ 0.75h)
budget_tokens    = best_tok_s × productive_hours × 3600 × 0.85
total_steps      = budget_tokens / (B×L)
```
Checkpoints every 500 steps must fit: est ckpt size ≈ model bytes ×3.5
(params+grads+2 Adam states at chosen dtype); disk free asserted ≥ 6 × ckpt size.
Write `{"locked_budget_tokens": …, "best_cfg": …, "tok_s": …}` into
config.lock.json; sha256 it; tar+upload updated file? NO — edit remotely but
append its hash to AGENT_NOTES so lineage is auditable.

## Instance disposition at phase end
If continuing straight into C3 on the same box: keep running, SKIP nothing in
C3 preflight. If pausing >30 min: `brev stop` (or delete if provider bills
stopped nodes) — logged with timestamp. Process hygiene applies to wallets too.

## Threat matrix
| Threat | Armor |
|---|---|
| bf15/bf16 numerics masking real divergence later | Step-4 fp32 twin run is mandatory teeth |
| First-config bias ("looks fast enough") | Three-point sweep required; log all |
| VRAM near-capacity hides spill cliff | 80% headroom rule + max_memory assert |
| Forgotten running instance burns credits overnight | Disposition step is part of gate, not optional |
| Probe passes but full-run OOMs at eval batches | Eval batch ≥ train batch included in best-cfg probe run once |

## Gate to C3
AG entry contains: tok/s (all 3 probes) · chosen cfg · peak VRAM · fp32-twin
delta · locked token count + total_steps · ckpt cadence + disk math. Missing
any line = not gated.
