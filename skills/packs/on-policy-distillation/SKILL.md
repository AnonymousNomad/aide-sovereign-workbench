---
name: on-policy-distillation
description: Implement SOD (Step-wise On-policy Distillation), ATOD (Annealed Turn-aware OPD), and Direct-OPD for small model post-training. Covers step-level divergence reweighting, annealed OPD-RL schedules, turn-level disagreement-uncertainty gating, and weak-to-strong policy shift transfer. Use when running Stage 2 (distillation) of the post-training pipeline, choosing between OPD variants, or implementing the distillation trainer for the 150M rebuild.
---

# On-Policy Distillation — SOD / ATOD / Direct-OPD (2026 SOTA)

## Research Foundations

| Method | Paper | Key Innovation | When to Use |
|--------|-------|----------------|-------------|
| **SOD** | Zhong et al. 2026 (arXiv 2605.07725) | **Step-wise divergence reweighting**: `w_k = (d_{k-1}/d_k)` attenuates distillation when student drifts from teacher; preserves dense guidance in aligned regions | Code/math reasoning with tool-use or multi-step traces; student 0.6B-1.7B |
| **ATOD** | Tan et al. 2026 (arXiv 2606.27814) | **Annealed OPD-RL hybrid**: `κ(s)` decays OPD weight, `ρ(s)` grows RL weight; **Turn-level T-DUR** gates distillation by disagreement+uncertainty per turn | Multi-turn agent tasks (ALFWorld, WebShop); need exploration beyond teacher ceiling |
| **Direct-OPD** | Feng et al. 2026 (arXiv 2607.05394) | **Weak-to-strong**: transfer RL-induced policy shift `Δ_T = log π_T - log π_{T_ref}` as dense implicit reward on student's on-policy states | When you have a small RL-trained teacher pair; want to boost stronger student without re-running RL |

## SOD — Step-wise On-policy Distillation (Core for Stage 2)

### Problem
Uniform OPD overweights corrupted steps where student tool calls cascade errors → teacher supervision becomes unreliable.

### Solution
Adaptive step-level weight: `w_1 = 1`, `w_k = min(1+δ, d_{k-1}/d_k)` where `d_k` = step-level student-teacher divergence (KL or log-prob ratio).

### Algorithm (per iteration)
1. Student generates on-policy trajectories (with tool interactions if applicable)
2. Compute step-level divergence `d_k` for each step against teacher
3. Derive weights `w_k` (attenuate high-divergence steps, restore on recovery)
4. Update with step-wise OPD loss: `L = Σ_k w_k * KL(π_teacher || π_student)_step_k`

### Hyperparameters (from paper)
- `ε = 1e-6` (stability offset in denominator)
- `δ = 0.2` (max amplification bound)
- Teacher: GRPO-optimized Qwen3-4B (or strongest available coder)
- Student: 150M FSI-FELON (our model)

### Implementation Notes
- Divergence `d_k` computable at **zero marginal cost** from OPD forward pass (reuse log-probs)
- For non-agent tasks (code generation without tools): treat each "reasoning block" as a step
- Step boundary = `<mind_spock>` / `<mind_sheldon>` / `<synthesis>` markers in our dual-mind traces

## ATOD — Annealed Turn-aware OPD (for Agent Tasks)

### Problem
Pure OPD saturates at teacher ceiling; pure GRPO has cold-start inefficiency.

### Solution
Hybrid objective with annealed coefficients + Turn-level Disagreement-Uncertainty Reweighting (T-DUR).

### Hybrid Advantage
```
A_t = κ(s) * A_t^OPD + ρ(s) * A_t^GRPO
```
- `κ(s)`: OPD coefficient, annealed from 1.0 → 0.0 over training
- `ρ(s)`: RL coefficient, annealed from 0.0 → 1.0
- `w_k` (T-DUR): only reweights OPD term, per turn `k`

### T-DUR Weight (per turn)
```
w_k = σ(α * disagreement_k + β * uncertainty_k)
```
- `disagreement_k` = KL(teacher || student) averaged over turn tokens
- `uncertainty_k` = student entropy averaged over turn tokens
- Both computed from log-probs already available

### Annealing Schedule (from paper)
- `κ(s) = cos(π * s / (2 * T))` for `s ≤ T`, else 0
- `ρ(s) = sin(π * s / (2 * T))` for `s ≤ T`, else 1
- `T` = total training steps / 2 (OPD dominates first half)

### When to Use ATOD vs SOD
- **SOD**: Single-turn reasoning (code gen, math), no tool interactions
- **ATOD**: Multi-turn agent tasks (web navigation, tool-use loops)
- **Our Stage 2**: SOD is primary (code traces are single-turn); ATOD if we add web-agent traces later

## Direct-OPD — Weak-to-Strong Policy Shift Transfer

### Problem
Vanilla OPD drags stronger student down to weaker teacher's level.

### Solution
Transfer the **RL-induced policy shift**, not the teacher's final policy.

### Teacher Pair Required
- `π_{T_ref}`: Weak model BEFORE RL (e.g., Qwen3-1.7B base)
- `π_T`: Same weak model AFTER RL (e.g., JustRL-1.5B)

### Implicit Reward
```
Δ_T(y|x) = log π_T(y|x) - log π_{T_ref}(y|x) = (1/β_T) * R_teacher(x,y) - log Z_T(x)
```

### Direct-OPD Objective
Student samples own rollouts, scores candidate tokens with `Δ_T` evaluated on student's visited states:
```
L = -E_{π_S} [ Δ_T(a_t|s_t) ] + β * KL(π_S || π_{S_init})
```

### Key Properties
- **Composable**: Policy shifts from different teacher pairs stack sequentially
- **Student can exceed teacher**: Qwen3-1.7B 48.3% → 62.4% AIME24 with JustRL-1.5B shift
- **Cheaper than large-model RL**: 4 hours on 8×A100 vs week on 32×A100

### When to Use
- **After SOD/ATOD**: If we run GRPO on a small model (e.g., 16.9M Trek) and get a policy shift, Direct-OPD can transfer it to 150M
- **Not for initial distillation**: Requires pre-RL + post-RL teacher pair (we don't have yet)

## Implementation for 150M Stage 2 (Distill)

### Teacher Selection (envelope-constrained)
| Teacher | Envelope | Use For |
|---------|----------|---------|
| Qwen3.5-4B (local, `enable_thinking=false`) | Reasoning, code, instruction-following | Primary SOD teacher |
| DeepSeek-Coder (if available) | Code traces only | Code-specific traces |
| **NOT** LFM2.5 | NOT for web/format tasks | — |

### Trace Generation Protocol (SOD)
1. **On-policy generation**: Student generates traces at its level (Phase-7 seeds are starting points)
2. **Verification gate**: Execute/parse/reference check every final answer — keep ONLY verified
3. **Step markers**: Insert `<mind_spock>`, `<mind_sheldon>`, `<synthesis>` in traces
4. **Divergence computation**: Per-step KL between student and teacher log-probs
5. **Weight application**: `w_k = min(1+δ, d_{k-1}/d_k)` applied to CE loss on trace tokens
6. **Answer block weighting**: ×1.5 on answer tokens (per Phase 8 skill)

### Trainer Changes (train_distill_150.py)
- Add `--sod` flag to enable step-wise reweighting
- Add `--atod` flag for annealed hybrid (requires GRPO impl)
- Add `--direct-opd` flag (requires teacher pair checkpoints)
- Divergence computation reuses forward pass logits (no extra teacher forward)
- Balanced plan (W1/T2 interleaving) already exists — keep it

### Gate 2 Criteria (from Phase 8 skill)
- Holdout reasoning probes: final answer passes verifier AND trace non-degenerate (overlap < 0.5 vs teacher output)
- Solve-rate on verified task suite (qwen35 tests + gold probes) ≥ 0.6 baseline → 0.8 target

## Expected Bugs / Issues
- **Teacher prompt residue**: Traces learn to echo "system:" — prompt-erasure filter + assert (Phase 7)
- **Degenerate traces**: Memorized verbatim teacher text passes verifier but teaches nothing — non-degeneracy check separate from verification
- **Long traces overwhelming 150M** (Yin 2025) — Phase-7 length gate (≤384 tokens) is guard; re-check truncation at eval
- **Divergence computation numerical stability** — ε=1e-6 in denominator; clamp weights to [0, 1+δ]
- **Turn detection for ATOD** — not needed for SOD (our traces are single-turn dual-mind)

## Dependencies
- Phase 7: distill_manifest_150.json (verified traces)
- Phase 8: pipeline-phase-8-post-train-runs (stage sequencing, Gate 2)
- Teacher server: Qwen3.5-4B local llama-server (port 8081, `enable_thinking=false`)
- Requires: `verl` backend (for ATOD/Direct-OPD) or custom SOD impl (~200 lines)

## Threat Matrix
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Teacher corruption (GGUF hash mismatch) | HIGH (observed 4/4) | CRITICAL | SHA-256 verify against HF tree json before ANY generation |
| Teacher outside envelope (web tasks) | MEDIUM | HIGH | Envelope rules: Qwen only for reasoning/code/instruction |
| Step boundary detection wrong | MEDIUM | MEDIUM | Explicit markers in traces; unit test divergence computation |
| ATOD anneal schedule wrong | LOW (not used yet) | MEDIUM | Probe on 16.9M first; log κ/ρ per step |
| Direct-OPD without teacher pair | N/A (not ready) | N/A | Only enable when pre-RL + post-RL checkpoints exist |

## When Done
Mark Stage 2 distillation complete in AGENT_NOTES with: teacher used, SOD/ATOD/Direct-OPD variant, divergence stats per step, Gate 2 solve-rate on holdout probes, and promoted checkpoint path.