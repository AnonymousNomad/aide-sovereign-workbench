---
name: pipeline-phase-6-pretrain-run
description: Phase 6 of the from-scratch training pipeline — running pretraining. Launch protocol (mandatory preflight PASS), watchdog + health-ping supervision, loss/grad-norm/spike monitoring with the recovery playbook, resume-parity verification, val-loss + cloze probes on a cadence, best-by-val checkpoint selection, and the Gate-0 exit decision (loss curve sane, coherence/format baseline captured, no silent bugs). Use when launching any pretrain run on the GTX 1060, monitoring a run, diagnosing spikes/plateaus, resuming after a crash, or deciding whether a pretrained base is good enough for Phase 7.
---

# Phase 6 — Pretrain Run

Phase 5 wrote the code and proved it in a smoke test. Phase 6 runs the real
thing — and the real thing on THIS machine (physical ASUS GL703GM laptop —
NOT a VM: Windows 11, TDR watchdog on nvlddmkm.sys, sleep/hibernate kills
runs, battery = -53% GPU, 10x stale llama-server pileup + game = crash) will
crash, spike, and drift. The discipline is: launch right, watch
relentlessly, recover calmly, and exit on evidence. No phase teaches the model;
the run does. Phase 6 just makes sure the run survives long enough to teach it.

Research sources: Google Rules of ML #29/#32/#37, HF Smol Training Playbook,
W&B LLM training white paper, Pythia (2104.00061) eval cadence, training-from-
scratch, device-training-1060 (THIS machine's TDR/suspend reality), Phase 1-5
skills (consumed directly).

---

## 1. Launch Protocol (HARD GATE — nothing trains without this)

### What to do (in order, no skipping)
1. **Preflight PASS**: `pwsh -File
   ...\pipeline-phase-1-foundations\scripts\preflight_check.ps1 -RequiredRamGB 4
   -RequiredGpuMB 3500` → exit 0 ONLY. If FAIL: kill the offender (stale
   llama-server/python/game), re-run. **NEVER override.**
2. Verify NO other GPU job: `nvidia-smi` shows <100MB used by others, and
   `Get-Process python,llama-server,torch*` is empty of foreign processes.
3. A/C power confirmed (preflight checks it).
4. Config frozen: `config.yaml` copied to `runs/<name>/config.yaml` (immutable);
   `config_hash` recorded (Phase-5 checkpoint guard reads it).
5. Launch hidden with logs: `Start-Process` trainer → `logs/stdout.log`,
   `logs/stderr.log`, health-ping enabled (Phase-1 watchdog).
6. First 20 steps observed LIVE in the terminal: loss finite at step 1
   (~ln(vocab)=9.14±0.3), decreasing by step 5, grad-norm pre-clip sane
   (not 0, not exploding), memory flat, throughput reasonable.
7. If any check in (6) fails → kill immediately (it's the smoke-run's job to
   catch this; a real run that fails step 1 has a config/loader bug, not a
   model bug — fix, don't wait).

### Why
- Step 1 is the law (learned 2026-08-20: 10x stale llama-servers + game =
  laptop crash). The preflight is not advisory.
- Config hash freezing prevents the silent config-drift plateau (Phase-5 guard).
- First-20-steps live watch catches loader/offset bugs (Phase-4 manifest
  mismatch) in minutes, not days.

### Expected bugs / issues
- Another process allocates VRAM between preflight and launch (game launched
  after PASS) → re-run preflight at launch instant, and again 60s in.
- A leftover llama-server on port 8081 from the chat-corpus work holds RAM —
  the generator's self-heal now kills old servers first, but verify manually.
- `Start-Process` without `-WindowStyle Hidden` opens a console that steals
  focus/keys — always hidden.

---

## 2. Monitoring (the run's vital signs)

### What to do
Cadence (per step, via the Phase-5 ledger):
- `loss` (raw), `loss_ema` (α=0.99), `grad_norm` (PRE-clip), `clip_fraction`
- `tokens_seen` (global currency), `lr`, `phase` (warmup/stable/decay)
- `throughput_tok_s`, `gpu_mem_peak` (reset per step)
Watch thresholds (alert if violated):
- loss EMA rises for 500 consecutive steps → investigate
- grad_norm > 20× its rolling mean → spike event
- clip_fraction rising trend over 10k steps → LR too high for data phase
- throughput drop >50% sustained → disk/AV/thermal (check clocks)
- gpu_mem_peak creep >5% over 10k steps → leak

Eval cadence (per 1000 steps, from the Phase-5 eval hook):
- **val_loss** on the locked Phase-3 val shards (same split, same order)
- **cloze probes** (5-10 masked-reconstruction prompts from val):
  e.g. "The capital of France is [MASK]." — a sanity signal that learning is
  real, not just curve-fitting
- Record BOTH in `metrics.jsonl` with `tokens_seen` so plots align.

### Why
- Loss EMA smooths noise; grad-norm is the earliest spike warning (Phase-5).
- `tokens_seen` (not step) keeps plots comparable if batch/accum changes.
- Cloze probes are cheap and detect "learning nothing but loss went down" —
  the classic packing/offset bug that makes loss drop while tokens are garbage.

### Expected bugs / issues
- Watching only loss: a plateau in val_loss while train_loss drops = overfit or
  data-leak-in-train (check contamination, Phase 3).
- Throughput measured during an eval step looks like a crash → divide by
  wall-clock EXCLUDING eval (Phase-5 note).
- Thermal throttling on the laptop reads as random 27% utilization — check
  `nvidia-smi` clocks/temp before blaming the model.

---

## 3. Spike Recovery Playbook (in order)

### What to do
On a single loss spike (>5× rolling mean in one step):
1. **Don't panic, don't kill.** Log `spike_event` with step + tokens_seen.
2. Check the NEXT step: normal → continue (single hard batch, recoverable).
3. If 3 consecutive spikes → STOP, dump the offending batch (seed + ids),
   inspect for: contamination (a bad doc slipped through), tokenizer edge case
   (a weird byte sequence), or LR too high.
4. Resume from the last clean checkpoint (Phase-5 atomic save guarantees it
   exists), NOT from the spike step.
5. If spikes recur after resume: halve LR (verified 150M start 5e-4 → 2.5e-4;
   the 16.9M run's 3e-4 → 1.5e-4 if that lineage is used), restart from
   pre-spike checkpoint, log `lr_reduction` event. Max 2 halvings.

### Why
- Spikes are mostly batch noise on a 6GB card; killing a run for one spike
  wastes days. The recovery ladder (observe → batch-check → resume-clean →
  halve LR) matches how small-model runs actually behave (Phase-5 doctrine).

### Expected bugs / issues
- Resuming from the spike step (its optimizer state is poisoned) — always
  resume from the LAST CLEAN checkpoint.
- The "spike" is actually the watchdog restarting mid-step (VM suspend) —
  check `events.jsonl` for a `resume_from` before diagnosing the model.
- NaN loss: if NaN appears, restore the checkpoint immediately (NaN never
  recovers), then investigate (gradient blow-up → clip, or a bad doc).

---

## 4. Resume-Parity Verification (every restart, no exceptions)

### What to do
After ANY restart (crash, suspend, manual), before trusting the run:
1. Load the checkpoint; assert `config_hash` matches the run's frozen config.
2. Assert the saved `tokens_seen` == ledger's last `tokens_seen` (no overlap,
   no gap).
3. **Parity test**: run 10 steps from the checkpoint → loss curve must match
   the pre-crash ledger's next-10 steps (within 1e-3, fp32 determinism).
   Mismatch = RNG/loader drift → STOP, fix, resume from an earlier ckpt.
4. Confirm schedule phase/LR match (WSD resume must land in stable, not re-
   warmup — Phase-5 scheduler test covers this).

### Why
- A resume that silently re-seeds or restarts the schedule trains garbage for
  days before the loss curve reveals it (the classic silent-resume bug).
- Parity is cheap (10 steps) and catches it in minutes.

### Expected bugs / issues
- GPU nondeterminism (cuBLAS workspace not set) breaks parity — the launcher
  MUST set `CUBLAS_WORKSPACE_CONFIG` before process start (Phase 1).
- A partial checkpoint (AV lock) loads but has stale optimizer state — the
  atomic `os.replace` + keep-previous guard (Phase 1) prevents this; verify the
  file hash before load.

---

## 5. Best-by-Val Selection & The Finish

### What to do
- Track `best_val_loss`; save `best.pt` (full checkpoint) whenever val improves
  AND the step was clean (finite loss, grad_norm < clip).
- On finish (or WSD decay end), pick the model by **best_val_loss**, NOT the
  final checkpoint — final checkpoints can be post-decay noise.
- Run the FULL Phase-9 eval battery on the chosen checkpoint for the Gate-0
  record, but the DECISION to continue to Phase 7 is made on:
  **Gate 0 = val_loss trend sane (decreasing to a plateau, no late blowup) +
  cloze probes > 0 (real learning) + no contamination red flags + preflight
  discipline held throughout.**

### Why
- Best-by-val is the standard, but it only works if val is locked (Phase 3) and
  never trained on — otherwise you're fitting the eval (Google Rules of ML #32).
- The Gate-0 record (baseline coherence/format scores) is what Phase 7/8
  compare against — capture it at pretrain-finish, not retroactively.

### Expected bugs / issues
- Saving `best.pt` during a spike (NaN or grad-blowup) poisons it → the clean-
  step guard is mandatory.
- The "best" is the BEST VAL, but the eval set for the product (coherence/
  format/novelty) lives in Phase 9 — Gate 0's job is only to prove the base
  learns; the product gates are later. Don't confuse them.

---

## 6. Verification Checklist (Phase 6 DONE only when ALL pass)

- [ ] Preflight PASS documented at launch (exit 0, RAM/VRAM/power OK)
- [ ] Config frozen + hash recorded before launch; no config drift across
      restarts (every checkpoint load asserts hash match)
- [ ] First 20 steps: loss finite at step 1 (~ln(vocab)), decreasing by step 5,
      grad-norm sane, memory flat
- [ ] Watchdog active (health ping 30s/120s timeout), restart-with-backoff + max
      3 then alert — verified by a deliberate kill test
- [ ] Ledger complete: per-step loss/loss_ema/grad_norm/clip_fraction/tokens_seen/
      lr/phase/throughput/gpu_mem; eval cadence val_loss + cloze every 1000 steps
- [ ] No silent resume: every restart passed the 10-step parity test
- [ ] Spike playbook exercised (at least the observe branch) OR no spikes occurred
      and that fact is documented
- [ ] Best checkpoint selected by best_val_loss with clean-step guard
- [ ] Gate 0 recorded: val curve sane, cloze > 0, contamination audit clean,
      preflight discipline held
- [ ] Base checkpoint + full state exported to Phase-7 (SFT/distill) with config

---

## 7. Dependencies Summary

Everything from Phases 1-5 (preflight script, watchdog, ledger, loader, trainer,
scheduler, atomic checkpoints). Plus `nvidia-smi` for live GPU checks and the
Windows scheduled task for watchdog-on-logon. No new libraries.

---

## 8. When Done

Mark Phase 6 complete in AGENT_NOTES with Gate-0 numbers (val curve shape, cloze
score, best_val_loss, total tokens_seen, runtime), then proceed to Phase 7
(Post-train Data): skill `pipeline-phase-7-post-train-data`.