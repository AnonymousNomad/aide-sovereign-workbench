# Skill: cloud-pretrain-window-execution (Phase C3)

# Pretraining Window Execution — One Shot, No Losses

## Objective
Run pretraining inside the locked window with zero silent failure modes:
every-step logging, spike playbook armed, checkpointing that survives a crash
or the quota wall, and disciplined shutdown. DONE = ckpt_latest + ckpt_best +
full loss/val log retrieved, hash-verified, and run summary in AGENT_NOTES.

## Launch checklist (all green before `python train …` executes)
1. C2 gate line present in notes (tok/s, budget, steps locked).
2. tmux/screen session named (survives SSH drops): `tmux new -s pretrain`.
3. Log tee active: `… 2>&1 | tee -a runs/pretrain_$(date +%m%d_%H%M).log`.
4. Determinism env set: seeds fixed; `CUBLAS_WORKSPACE_CONFIG=:4096:8` for CUDA
   determinism (6-RNG doctrine carries over — note bf16 reduces bit-exactness,
   keep rng deterministic anyway for resume parity).
5. Watchdog awareness: provider boxes lack our local watchdog script — use
   `timeout`-free plain run + EXTERNAL alarm instead (Step Shutdown below).
6. Resume path dry-tested once locally-packaged: `-r ckpt_latest.pt
   --start-step N` reruns without re-seen samples.

## In-run discipline
- **Every-step log line** (step/loss/lr/grad/cur/speed/MEM) — same as Stage-2.
- **Val every 500 steps** on shipped held-out shards; cloze probes same cadence.
- **Spike detector rolling W=100**, flag > μ+5σ_watched → do NOT trust autopilot:
  pause at next ckpt, inspect last-500 grads (grad-spike-before-loss ⇒ optimizer
  story vs data batch), resume from best with LR −10–20% only if pattern was real.
- **NaN**: skip save at NaN step (never persist poisoned state), rollback latest
  clean ckpt, halve LR probe. If repeats ≥3 ⇒ STOP window; analysis beats burn.
- **Checkpoint cadence**: every 500 steps AND every 10 wall-min, whichever first
  (fast tok/s means 10 min ≫ 500 steps? then time rule binds — obey both).

## Quota armor (the unique cloud killer)
```
T-0 = session start (billing). Window from C2 reserve math.
T+H−1h00 : status ping + progress vs plan (tokens done / budget)
T+H−0h30 : FREEZE point — finish current ckpt interval, no new schedule pieces
T+H−0h15 : FINAL ckpt + upload to storage/another box regardless of state
T+H      : shutdown instance (provider CLI), verify billing stops
```
Set phone/OS alarms AND a remote-side `shutdown -h +<mins>` as belt-and-braces.
A finished-but-unretrieved checkpoint = zero (round-trip law).

## Retrieval within phase (hash-bound)
```bash
sha256sum ckpt_latest.pt ckpt_best.pt runs/*.log > RETRIEVE.SUMS
rsync -avP --checksum <box>:$OUT local_cloud_retrieval/
sha256sum -c RETRIEVE.SUMS           # on LOCAL machine after pull
```
Then (and only then): stop instance, record exact runtime × rate for audit.

## Post-run acceptance (Gate 0' — pretrain finalize, cloud edition)
- best-by-val (retrospective pick, NOT last step) named in summary.
- Loss curve: monotone-ish descent, spikes accounted, no val leak possible
  (eval/* namespace never touched by loader — assert printed at startup).
- Cloze trend non-decreasing late-run.
- Comparison anchor: loss-vs-tokens overlay vs the 16.9M/819M precedent curve
  shape (same axes) stored in retrieval dir for honest judgement later.

## Threat matrix
| Threat | Armor |
|---|---|
| SSH drop kills training | tmux mandatory; reattach and verify step counter still advancing |
| Crash mid-interval loses ≤1 interval | dual-cadence checkpointing above |
| Silent stall (GPU hang, dataloader deadlock) | speed column watchdog: no movement 5 min ⇒ alert tone + core-dump env already set (`TORCH_CUDA_LAUNCH_BLOCKING=0`, py-spy dump script staged) |
| Bill drift past credits | shutdown -h + external alarms + T-minus ladder |
| Data corruption mid-run | per-shard sha512 checked by loader at mmap-open; mismatch ⇒ halt loud |
| Warmup/LR schedule bug only visible in cloud LR column | every-step lr print is REQUIRED parsing target; any deviation from schedule table = abort early |

## Gate to C4
RETRIEVE.SUMS verified on local disk + AG entry with runtime, $burn equivalent,
final losses (last-100-step μ±σ), val trajectory tail, best ckpt filename.
