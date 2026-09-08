# Skill: nvidia-cloud-training-master

# NVIDIA Cloud Training Mission — Master Router (Brev Credits Lane)

## Mission
Use NVIDIA cloud GPU credits (~7-8 GPU-hours) to train the from-scratch model
(139.7M, user cap: NEVER >150M) at full token budget in one evening instead of
~15 days on the GTX 1060. Sovereignty law UNCHANGED: the *product* never calls
cloud; training artifacts come home and serve locally via llama.cpp. Cloud is
the compute kitchen, not the restaurant.

## Research Base (verified 2026-08-27, sources named)
1. **Platform = NVIDIA Brev** (`brev.nvidia.com`): on-demand GPU instances on
   cloud providers, CLI-first (`brev login`, `brev create <name>`, `brev ls`),
   Windows support via WSL2 only. Source: brevdev/brev-cli README (GitHub primary).
   The CLI even ships an agent-skill installer (`brev agent-skill`).
2. **Market rates (value-of-credits reference, Lambda pricing page)**:
   A100-40GB ≈ $1.99/hr · A100-80GB SXM ≈ $2.79/hr · H100-SXM 80GB single ≈
   $3.29–4.29/hr · V100-16GB ≈ $0.79/hr. Brev resells similar clouds.
3. **Scale anchor (HF SmolLM2-135M card)**: Big Tech used **2T tokens on 64×H100
   bf16** for 135M. We deliberately do NOT replicate volume; Phi-1/quality-over-
   volume doctrine + Chinchilla band (~20 tok/param ⇒ ~2.8B optimal for 139.7M)
   govern our budget.
4. **Throughput expectation** (bounded, NOT trusted): local measured 139.7M fp32
   = 2,269 tok/s @ ~1.9 effective TFLOPS (~40% of 1060 peak). Scaling that MFU to
   A100/H100 bf16 gives a conservative band of 45–60K tok/s (A100) → ~1B tokens
   in a safe window; 110–160K (H100) → ~2.4–3.4B. These are EXPECTATIONS;
   Phase C2 measures reality before any budget is locked. Never skip C2.

## Constitution additions for this lane (extends pipeline-excellence)
- **Probe-before-budget law**: token budget = measured_tok_s × productive_hours ×
  0.85 safety factor, computed AFTER the C2 probe. No probe, no run.
- **Quota armor**: checkpoint every 500 steps AND wall-clock every 10 min; instance
  auto-shutdown at T-minus-15-min before quota exhaustion; worst sin = burning the
  window and losing weights because shutdown was forgotten.
- **Round-trip law**: a cloud run "finished" means hashes of retrieved checkpoints
  verified locally, GGUF converts, identity + parity probes pass, engine serves.
  Until then it's only "uploaded parts happened".
- **Precision law split**: FP32-only applies to the GTX 1060 (Pascal). Cloud
  Ampere/Hopper tensor cores REQUIRE bf16/fp16 for speed — this is not a violation,
  it is a different device class. Gate: loss curve must be compared against fp32
  short-probe expectations (no divergence from numerics).

## Phase Map (what loads what)

| # | Phase | Skill | Gate to advance |
|---|---|---|---|
| C0 | Access wiring | nvidia-brev-cloud-access | `brev ls` returns real instances + credits visible |
| C1 | Artifact pack & upload | cloud-artifact-pack-upload | sha256 manifest uploaded+verified round-trip |
| C2 | Scale probe gate | cloud-scale-probe-gate | measured tok/s recorded; token budget LOCKED |
| C3 | Pretrain window | cloud-pretrain-window-execution | ckpt_final retrieved, hash-matched, losses logged |
| C4 | Retrieval→home deploy | cloud-checkpoint-retrieval | GGUF serves locally via :8091-class port; gates rerun |
| (opt) C5 | Post-train window | reuses C1-C4 skills with post-train config | Gates 1-3 as per project-governance §3 |

## Decision already locked (log: AGENT_NOTES 2026-08-27)
- Size stays ≤150M — cloud changes token feasibility, NOT the size cap.
- Precision on cloud = bf16 (tensor-core devices), unlike Pascal lane.
- Training-from-scratch only; no pretrained weights enter lineage (NECI rules).
- R9 sovereignty preserved: zero cloud at inference/product runtime.

## Threat Matrix (lane-level)
| Threat | Mitigation |
|---|---|
| Credits exhausted mid-run by forgot-to-stop instance | C3 hard shutdown script + T-15min alarm |
| Data upload corrupted (silent bitrot) | sha256 manifest generated pre-upload, verified post-upload + again post-download |
| Secrets (SSH keys/API tokens) leaked into repo or logs | Keys live ONLY under WSL ~/.ssh + env; .gitignore audit before any commit |
| Wrong GPU class rented (burns credits on idle 8-GPU node) | C0 lists smallest-count instance; confirm count=1 BEFORE create |
| Vendor lock/regional unavailable → wasted prep time | C0 verifies availability FIRST; all packs are provider-neutral tarballs |
| Numerics differ from local fp32 runs silently | C2 includes 200-step fp32-vs-bf16 loss comparison before accepting |

## Non-negotiable order
C0 → C1 → C2 → C3 → C4. Skipping C2 re-introduces guessing; skipping C1's hash
verification forfeits round-trip law. No phase starts while the previous gate
is red.

## Session protocol
Start every cloud-lane session here; log phase transitions in AGENT_NOTES with
timestamps, measured numbers, and instance IDs.
