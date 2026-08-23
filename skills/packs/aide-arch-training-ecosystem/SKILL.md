---
name: aide-arch-training-ecosystem
description: Phase 10 SOP for the AIDE offline-first IDE rebuild — the training arena + tutor + community as contract services: training job manager (job config JSON, spawn via task runner, WS log stream, poll status, graceful-then-tree-kill stop, checkpoint-first), Academy/tutor (course catalog, lesson sessions, deterministic gates, server-gated completion credentials), and the local community hub (feed/projects/issues/discussions/marketplace CRUD, zero cloud). Use whenever wiring RUN VERITAS JOB / STOP TRAINING JOB, lesson check/complete, or community CRUD. Research-grounded in the verified machine reality (GTX 1060 6GB Pascal FP32-only, py -3.10 -E, RAM doctrine) and the existing aide-phase5/6/7 skills.
---

# AIDE Architecture — Phase 10: Training Arena + Tutor + Community

## Doctrine

- **Jobs are typed, stoppable, and visible.** A training job = a validated config JSON → task-runner spawn → live log stream (WS) → status events → clean stop (graceful-then-tree-kill, checkpoint-first). The old training-manager.mjs is PORTED (verified), not redesigned.
- **Machine honesty.** This machine: GTX 1060 6GB Pascal (FP32 only, no Tensor Cores), i7-8750H, 16GB RAM. The arena surfaces the RAM doctrine (Phase 6) and refuses starts that would kill model servers or the machine. It never pretends a job can run when the GPU/RAM is owned by someone else (the user's own fsi-anomaly jobs).
- **Deterministic gates before AI claims.** Tutor lesson checks run deterministic verifiers FIRST; AI-grade evaluation only where the check genuinely needs it — a lesson is NEVER "complete" on a model's say-so.
- **Local-first community.** Feed/projects/issues/discussions/marketplace are local files (community-store CRUD). Zero cloud by default; any future sync is opt-in (Phase 4 egress flag).
- Verify before claiming: a real (tiny) training job runs → streams → stops cleanly; a lesson gate passes/fails deterministically; community CRUD round-trips.

## What

Phase 10 delivers three verified pillars as contract services:

- **Training arena** (`node/src/services/training.ts`, port of training-manager.mjs):
  - `JobConfig` (common/contracts/training.ts, zod strict): name, python, script, args[], cwd, env, gpu (boolean), stopAfterMs?, checkpointEveryMs?.
  - Run: validate config (python exists per Phase 6 discovery chain; script inside workspace — containment; gpu requested → freeMemory + model-server-ports check) → spawn via the task runner (Phase 8) or direct spawn (training needs no PTY) → stream `training:<id>:output` + `training:<id>:status` (running/checkpoint/succeeded/failed/stopped, exit code).
  - Poll status: `GET /api/training/<id>/status` → { status, startedAt, lastCheckpoint, exitCode, outputTail } (daemon keeps the tail, cap 2000 lines, Phase 8 rule).
  - Stop: graceful (send SIGTERM; training scripts should checkpoint on SIGTERM — the VERITAS discipline) → 5s → tree kill → status=stopped. Never `-Force` style kills (orphan doctrine, Phase 6).
  - Checkpoint-first: the arena UI marks checkpoints (job emits "checkpoint saved" lines or the manager polls for checkpoint files) so a stopped job resumes from the last checkpoint, not from zero.
- **Tutor/Academy** (`node/src/services/tutor.ts`, port of the verified academy flow):
  - Catalog: courses → lessons (id, title, gates). Gates are DETERMINISTIC: file-exists, content-regex, test-run (spawn a test command, parse exit code), config-parse. Each gate = { kind, params, timeoutMs }.
  - `POST /api/tutor/lessons/<id>/check` → runs gates in order, first failure stops, returns { passed, results: [{ gate, passed, message }] }.
  - `POST /api/tutor/lessons/<id>/complete` → SERVER-GATED: re-runs the deterministic gates (complete is only granted when check passed) → writes a local completion credential (digest of lesson id + user + date + a local secret; the verified digest+limitation scheme) → returns { credential, certificate? } (certificate = local HTML/PDF the user can print).
  - Credentials verify endpoint: `GET /api/tutor/credentials/<digest>` → { valid, issuedAt } (server re-derives the digest — no stored secrets beyond the local secret file in the daemon data dir).
- **Community hub** (`node/src/services/community.ts`, port of community-store CRUD):
  - Entities: feed posts, projects, issues, discussions, marketplace items. CRUD: create/read/update/delete with zod schemas; stored as JSON files under `community/` (one dir per entity type; one file per item).
  - Contracts (common/contracts/community.ts): typed entities with timestamps + author (local profile); soft-delete (deleted flag) to keep feed ordering sane.
  - Zero cloud: the ONLY network touchpoint is an opt-in future sync; the egress audit (Phase 4) proves no hidden calls.

## How

### 1. Training spawn (machine-true)

- Python resolution: Phase 6 discovery chain (AIDE_PYTHON → py -3.10 -E → …). Never hardcode; the job config can pin a python but defaults to the chain.
- Pre-flight (fail with NOT_READY + message): freeMemory ≥ 3GB if gpu:true (RAM doctrine — training + model servers + Windows = tight on 16GB); if any model server is running and gpu:true → warn (shared VRAM: 6GB card, training will likely evict the model — surface the choice, don't decide silently).
- FP32-only reality: no AMP/TF32 flags in job defaults; jobs that request them get a warning (Pascal has no Tensor Cores; the flag silently does nothing or crashes).
- Spawn env: strip NODE_OPTIONS/remote vars; pass AIDE_WORKSPACE, AIDE_MODELS_DIR; never pass secrets.
- Concurrency: ONE training job at a time (CONFLICT if running) — the machine can't do two; also protects model servers.

### 2. Log stream + tail

- Output events capped (Phase 4: 256KB per event with truncated flag); daemon keeps tail (2000 lines) per job; the RUN view renders the tail live (terminal-style, ANSI passthrough) and the status.
- Job rotation: finished jobs keep their tail + exit code in a jobs.json index (last N=20) so history survives restart.

### 3. Tutor gates (deterministic first)

- Gate kinds: `fileExists(path)`, `fileMatches(path, regex)`, `runTest(command, args[], timeoutMs, expectExitCode)`, `configParse(path, schema-hash)`. Each returns { passed, message } with the message being the USER-FACING hint (write hints like a teacher: what to look for, never the answer).
- Order: cheap gates first (fileExists before runTest — a missing file shouldn't spawn a test).
- Gate results are LOGGED (anonymized) so the closed-loop (post-training) can find lessons nobody passes.
- Complete = re-run check + write credential. The credential digest: sha256(lessonId | userId | issuedDate | localSecret). The localSecret lives in the daemon data dir, created on first tutor use (chmod/ACL: default Windows per-user dirs are fine).

### 4. Community CRUD

- Store: `community/{feed,projects,issues,discussions,marketplace}/*.json`; index rebuilt from dirs on boot (no separate index file to corrupt).
- Schemas strict; timestamps from the daemon clock; author = local profile (name stored in config, editable).
- Marketplace items: { id, title, kind, artifactPath (workspace-relative, containment-checked at read), sha256, installHint } — installs are just instructions to the Phase 9 extension manager where applicable.

## Why (research grounding)

- Verified machine facts: the training-manager (spawn/stream/poll/graceful-then-kill-tree, checkpoint-first) was built against THIS machine's reality (GTX 1060 6GB, py -3.10 -E) and verified — port it.
- RAM/GPU doctrine (Phase 6, verified 2026-08-16): <2GB free → MapViewOfFile failures; model servers and training contend on 16GB — the arena's pre-flight is the UI of that doctrine.
- Deterministic-first grading: the verified academy flow gates on real artifacts (file/test/config) before any completion credential; AI-judged gates are an opt-in extension, never the default path (credential integrity).
- Offline-first: community is local files by design; the egress audit (Phase 4) is the proof.

## Dependencies

Phase 1 process manager (spawn/tree-kill/timeout), Phase 6 python discovery + RAM doctrine, Phase 8 task runner (optional: jobs via task runner get terminal visibility; direct spawn keeps it simple — use direct spawn, stream via WS, render in the RUN view), Phase 4 WS channels + contracts, Phase 2 store/UI, existing aide-phase5-training-arena + aide-phase6-tutor-mode + aide-phase7-community-hub skills as operational references.

## Known issues / bugs (watch these)

- **SIGTERM on Windows**: child.kill('SIGTERM') is emulated (TerminateProcess — no signal handling); training scripts CANNOT catch it. So "graceful stop" = the manager writes a stop-request file the script polls, OR sends Ctrl+C-like via... reality: on Windows, graceful = stop-request file + script cooperation; otherwise tree-kill. Document per-job: cooperative scripts get graceful, others get killed — the UI says "stopping (force)" when no grace is possible. (This corrects naive POSIX assumptions — verify the training scripts' cooperation.)
- **Checkpoint detection**: checkpointEveryMs polling the filesystem (glob for *.ckpt/*.pt mtime) is simple + robust; don't rely on parsing script output.
- **Log floods**: loss spikes printing per-step → event cap + tail cap prevent browser death, but the daemon should also rate-limit per-source (e.g. 2000 events/min) with a "log rate limited" notice.
- **Job vs user jobs**: the user's OWN fsi-anomaly training may hold GPU/RAM; pre-flight checks current free memory but can't see their intent — surface freeMemoryMB + "GPU may be busy" in the arena UI; never silently queue.
- **Credential replay**: the digest binds lesson+user+date; re-running complete() the same day is idempotent (same digest); dates rotate daily. Keep the secret out of logs and out of the frontend (it never leaves the daemon).
- **Community file corruption**: a half-written JSON (crash mid-write) breaks one entity — write temp+rename (atomic), validate on read, skip corrupt with a log + quarantine copy.
- **Path containment in community artifactPath**: items referencing files are read via the file contract — containment applies (Phase 1) or a crafted item exfiltrates workspace files to the viewer.

## Phase 10 audit checklist (applied to the existing training/tutor/community code)

1. training-manager ported: JobConfig zod, spawn via discovery-chain python, WS stream + status, tail cap, stop = graceful-then-tree (Windows-realistic: stop-request file for cooperative scripts, else tree-kill with "stopping (force)" UX), checkpoint detection, one-job concurrency + pre-flight (RAM/GPU).
2. Live: tiny real job (e.g. a 2-minute fine-tune or a script that checkpoints) runs → streams → stops → resumes from checkpoint.
3. Tutor: catalog + gates (fileExists/fileMatches/runTest/configParse) deterministic; complete() re-runs gates then writes the digest credential; verify endpoint re-derives.
4. Community: CRUD round-trip on all 5 entities; atomic writes; corrupt-file quarantine; containment on artifact reads.
5. All under contracts + fixtures both sides; `npm run check` green.