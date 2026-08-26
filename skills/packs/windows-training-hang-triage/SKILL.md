# Skill: windows-training-hang-triage

# Windows QLoRA/Training Run Stall — Evidence-First Triage & Recovery (THIS machine)

## Problem It Solves

A training process on this GTX 1060 laptop appears "stuck": no log output for tens of
minutes, no checkpoints, yet the process is alive and the GPU reads busy. Acting on
guesses (waiting indefinitely, killing blindly, relaunching without env context)
has cost full days. This skill encodes the measured triage procedure that root-caused
the 2026-08-25 incident in under 40 minutes.

## Incident Anatomy (2026-08-25, fully diagnosed — use as the reference pattern)

| Time | Event | Evidence source |
|---|---|---|
| 8/24 20:56–21:10 | THREE unclean reboots + nvlddmkm ID 153 storm | System event log |
| 8/24 21:39 | Thinking QLoRA launched by launcher cmd | master.log |
| 8/24 23:29 | Second GPU consumer started (`llama-server -ngl 999`, ctx 8192) | process cmdline |
| 8/25 00:45 | Last healthy checkpoint (step 350/399) | trainer_state.json mtime |
| overnight | Step time degraded ~43s → ~21min (VRAM/RAM cohabitation thrash) | log-line timestamps |
| 08:05 | Final log line; forward pass never returns; NO new driver event logged | log mtime vs py-spy |
| 09:12 | Wedged tree killed; linear launcher AUTO-ADVANCED to research slot | master.log 09:11:58 |
| 09:41 | Relaunch WITHOUT `TRIO_RUNTIME` env → resume searched wrong dir → FRESH START at step 0 | stdout banner |
| 10:16 | Fresh-start collided with auto-started research → two NF4 loads on 6GB → 403 s/step thrash | tqdm rate + compute-apps PIDs |
| 10:28 | All killed; corrected single-run launcher with env set; clean resume from 350 | loss lines at epoch 2.71+, LR schedule values identical to original |

## Research Foundations

| Source | Fact | Applied rule |
|---|---|---|
| py-spy dump (measured) | Stack showed thread inside `Trainer._inner_training_loop → training_step → compute_loss → forward` on ONE micro-batch for 60+ min | A live-but-silent run mid-forward = kernel never returning = context-level damage, NOT slow stepping |
| NVIDIA WDDM docs + nvlddmkm 153 class | VRAM oversubscription triggers allocation eviction; evicted CUDA surfaces can hang kernels WITHOUT a logged TDR event | "GPU busy + zero progress + no fresh driver event" is a known silent-damage signature on this machine |
| transformers Trainer resume semantics | `trainer.train()` without `resume_from_checkpoint` restarts from scratch even if checkpoints exist; checkpoints carry model+optimizer+scheduler+RNG | Any relaunch MUST pass resume explicitly AND resolve the correct output dir via env |
| This repo's launcher pattern | Linear `.cmd` chains advance slots when a process dies; no watchdog loop | Killing one training tree can silently start the NEXT heavy job → always kill the LAUNCHER first |
| Windows venv shim behavior (measured) | `venv\Scripts\python.exe` spawns a second real interpreter → every run shows TWO PIDs | Never misread shim-pairs as duplicate launches; match parent-child before killing |

## Triage Procedure (in order — evidence BEFORE action)

### 1. Classify the silence (all read-only)

```
# a) Is it stepping or parked? Ground truth of WHERE it sits:
E:\felon_workspace\venv_trek\Scripts\py-spy.exe dump --pid <REAL_PID>
#    - stack inside training_step/forward = wedged kernel (go to step 2)
#    - stack inside generate()/save = legitimate long phase (WAIT, don't touch)
#    - "Failed to open process" = wrong PID (shim) or dead (check tree)

# b) Last real progress:
Get-Item <logfile> | Select LastWriteTime           # stdout log mtime
Get-ChildItem <ckpt_dir> -Recurse | Sort LastWriteTime -Descending | Select -First 3
# trainer_state.json global_step/max_steps tells exactly how much work remains

# c) Driver/system correlation for the stall window:
Get-WinEvent -FilterHashtable @{LogName='System'; StartTime=(Get-Date).AddHours(-14)} |
  Where-Object { $_.ProviderName -match 'nvlddmkm|Kernel-Power' }
# NOTE: absence of events does NOT clear the WDDM-eviction hypothesis (silent class)
```

Decision: progress files advancing = slow run, optimize env; progress frozen ≥3× the
normal logging interval with py-spy parked in forward/save-anomaly = wedged → step 2.

### 2. Map the process tree BEFORE any kill (shim-pair law)

```
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '<script>' } |
  Select ProcessId, ParentProcessId, Name, CommandLine
# venv shim (parent) + E:\Python310 real interpreter (child) = ONE logical run
```

Also find the CHAIN LAUNCHER (`cmd.exe /c launch_*.cmd`) — killing only the trainer
lets a linear launcher advance to its next slot and start ANOTHER heavy job.

### 3. Recovery kill requires (R2): human approval + complete relaunch context

Relaunch context checklist — ALL of these, verified from the ORIGINAL launcher file,
not memory:
- [ ] Working directory (scripts use relative paths)
- [ ] Environment variables the original launcher set (e.g. `TRIO_RUNTIME` selects
      the checkpoint/output directory — missing it = fresh start in the WRONG dir,
      discovered here the expensive way)
- [ ] Resume flag wired: patched script must glob `checkpoint-*` in the SAME
      resolved dir and pass `trainer.train(resume_from_checkpoint=<latest>)`
- [ ] Output/log redirection targets (append mode, separate stderr file)
- [ ] No OTHER heavy job will auto-start afterward (launcher neutralized first)

### 4. Post-relaunch proof (fresh start masquerading as resume has happened)

Within ~10 min confirm ALL three:
1. Banner + `[pilot] resuming from ...checkpoint-N` line in stdout
2. First loss lines show epoch CONTINUING (> prior checkpoint epoch, not ~0.0x)
3. Learning-rate value matches the original schedule at that step (proves scheduler
   state loaded, not re-warmed)

## Known Failure Modes & Bugs (this machine, measured)

1. **Silent wedge, no traceback, no TDR event**: forward-pass kernel waits forever on
   evicted/damaged context. Only cure: kill + resume from last checkpoint.
2. **Linear launcher auto-advance**: killing a training tree starts the next slot.
   Kill the `cmd.exe /c launch_*.cmd` FIRST.
3. **Env-dependent output dir** (`TRIO_RUNTIME`): bare relaunch silently trains a
   fresh model into the default dir and burns hours. Copy the launcher's `set` lines.
4. **Shim PID pairs**: `venv_trek\Scripts\python.exe` → `E:\Python310\python.exe`;
   two PIDs per run. Verify ParentProcessId before calling something a duplicate.
5. **Missing import bug class**: diagnostics code referencing `re` without
   `import re` crashes AFTER training completes (frontier report had to be salvaged).
   py_compile the training script before ANY relaunch.
6. **Cohabitation slowdown signature**: step time degrading 10–30× while logs still
   advance = VRAM/RAM cohabitation thrash (second trainer OR a resident inference
   server). Fix the neighbor, don't touch the trainer.
7. **py_compile gate**: edits to training scripts are inert until next launch — so
   compile-check them DURING the incident, not after.

## Verification Gates (before declaring recovery)

- [ ] Loss lines advancing at healthy cadence (~30–60 s/optimizer-step on trio jobs;
      >5 min/step = still colliding with something)
- [ ] GPU dedicated memory matches ONE NF4 4B-class load (~4.5–5.5 GB), not two
- [ ] `nvidia-smi --query-compute-apps` shows exactly one python interpreter pair
- [ ] Checkpoints resuming their save cadence (every 50 steps here)
- [ ] Journal entry written (R7) naming: evidence used, approval, kill list, relaunch context

## Dependencies

- py-spy (`pip install py-spy` into the training venv — light, no GPU)
- nvidia-smi; Get-WinEvent; Get-CimInstance (built-in)
- Patched pilot_qlora.py with `--resume` (backup: pilot_qlora.py.pre_resume.bak)
