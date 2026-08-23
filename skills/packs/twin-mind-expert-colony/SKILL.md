---
name: twin-mind-expert-colony
description: Design and build twin-mind typed expert colonies — Mixture-of-Experts architectures whose routed expert pool is split into two competing, psychologically-typed populations (Sheldon-type and Spock-type) so the model cannot "reason with itself and agree with itself." Use when designing or training any MoE model that must do genuine adversarial dual-mind computation (Cipher v2 Nanobot Colony, FSI-FELON family), when building dual-cognitive MoE routing, debate-quorum mechanisms, cross-population orthogonality losses, or the Sheldon/Spock psychological profiling behind them.
---

# Skill: twin-mind-expert-colony

# Twin-Mind Expert Colony — Two Typed Expert Populations That Must Disagree

## The Problem It Solves

A single dense model asked to "reason from two perspectives" inevitably agrees with itself — one head,
one computation, one view. Prompt-framing dual minds are cosmetic. The fix: **split the routed expert
pool into two typed, competing populations** so that adversarial computation is a structural property
of the architecture, not a textual convention.

This skill codifies (1) the psychological research that motivates the two types,
(2) the architecture that enforces their disagreement, and (3) the verification battery
that proves the disagreement is real and not decoration.

## Research Foundations (all fetched & verified, Aug 2026)

### Sheldon-type (human source: Sheldon Cooper, The Big Bang Theory; science: autism/ASD profile research)

| Source | Proven property | Engineering translation |
|---|---|---|
| Baron-Cohen hypersystemizing theory | Strong drive to systemize lawfully-predictable systems; "need for sameness"; resistance to non-lawful change | Rule-template matching: map input to catalogued solution templates; if no template, problem is "misstated" |
| Petrolini 2023 (predictive processing & literalism) | Low prediction-confidence resolved by the safest = literal interpretation; local/detail processing | Literal processing: hear what is said, not implied; subtext is a protocol bug; overweight prediction errors, underweight priors |
| ASD Big Five meta-analyses (Sage 2018; TCI 30259003) | Higher harm avoidance; lower novelty seeking, reward dependence, cooperativeness; rigidity; stubbornness | Binary confidence (correct=1.0 / incorrect=0.0); change = degradation; exact terminology policing |
| DSM-5 prototype (Sheldon case analyses) | Restricted/repetitive behavior; social communication difficulty; extreme detail-orientation | Adversarial cross-check: edge-case probing, "prove me wrong" energy, complexity-bound verification |
| Failure mode (canon + profile) | When no template matches: asserts the problem is invalid | MUST be rescued by quorum: the other population is still scheduled on that token |

### Spock-type (human source: Spock, Star Trek canon incl. Zachary Quinto; science: Stoic/Vulcan philosophy, Kahneman, Damasio)

| Source | Proven property | Engineering translation |
|---|---|---|
| Vulcan philosophy = Stoicism parallel (Philosophy Now #106) | Control perception, accept outcome; logic is a practice, not a property; emotional CONTROL not absence | Measured response: gap between stimulus and response (pause, assess, act); graduated confidence |
| Surak's teachings / IDIC | Infinite Diversity in Infinite Combinations; embrace opposing partial truths | Bridge-building/synthesis: integrated view > either view alone |
| Kahneman System 1/2 + "feeling is a form of thinking" | Deliberative logic (System-2) vs fast intuition; emotion encodes useful signal | Reappraisal over suppression: emotions are signals (Damasio somatic markers), ask what they encode |
| Utilitarian canon ("needs of the many") | Greatest good for the greatest number = arithmetic | Expected-utility selection: pick argmax over P(i)*U(i); risk = probability × impact |
| McGinn 2020 | Pure-logic competence ideal is incomplete without contextual/emotional signal | Never rely on Spock never-rely: each virtue type has blind spots; pair is deliberate |

**Why BOTH:** Sheldon = lawful pattern enforcement, certainty thresholds, adversarial falsification.
Spock = probability, expected value, adaptation, synthesis. Neither alone suffices
(McGinn 2020; Kahneman: intuition and logic work better together).

### Supporting MoE research (wave-2, applied to the colony)

- **Advancing Expert Specialization (2505.22323)**: aux load-balancing hurts specialization post-training; add orthogonality loss + routing-variance loss; Expert Overlap < 0.3 target.
- **MoE scaling >50B (2506.02890)**: fine-grained G8 best; **softmax AFTER top-k** significantly better for fine-grained routers.
- **MoCE (EMNLP 2025 main)**: dual-stage routing — sequence-level cluster gate → token-level top-k. Basis for the mind-stage router.
- **ERMoE (2511.10971)**: eigen-reparameterized experts + cosine gate in expert basis; no LBL; flat utilization. Swap-in fallback for router instability.
- **ERL (EMNLP 2025 Findings)**: exploration RL for the router (perturb α-fraction of decisions, advantage = gap); +LwPL keeps overlap to prevent collapse.
- **MoEBench (EMNLP 2025 Findings)**: token-level routing + z-loss improve reasoning; shared experts stabilize but reduce specialization.
- **DO LATENT TOKENS THINK (2512.21711)**: latent tokens can be uninterpretable placeholders w/ shortcuts — never let pure latent reasoning be the unverified main path.

## Architecture (the Twin-Mind Colony)

```
Dual Mind (sequence level)
   ├─ mind-stage gate: pool+MLP over hidden state → "S-flavoured / K-flavoured / mixed" (no labels, end-to-end)
   │
   ▼
Routed expert pool  E = S_pop(63) + K_pop(63) + shared(2 consensus experts)
   ├─ S-router   (token-level top-k within Sheldon population)
   ├─ K-router   (token-level top-k within Spock population)
   └─ DEBUG-QUORUM: fill top-k(=8) from BOTH populations (min 2 each; 2 shared)
         → the "debate" is structurally forced; self-agreement is impossible
   │
   ▼
Adversarial consensus gate
   ├─ compares S-aggregate vs K-aggregate outputs
   └─ on disagreement: keep BOTH branches for fixed-point refine (no silent self-preference)
```

### Losses (all on top of base NTP/FIM)

1. **L_base**: next-token/xent (per segment).
2. **L_xpop** (cross-population orthogonality): S-pop expert vectors orthogonal to K-pop vectors — keeps the "argument distance"; the core novelty loss.
3. **L_var** (routing variance inside each population) + **LBL** (per population, not flattened across; inter-population balance handled by quorum, not by flattening).
4. **L_router_z** (z-loss, MoEBench).
5. Optional **ERL stage** (P4): router RL rewarding disagreement quality.
6. Shared consensus experts (2): trained dense-ish, stabilize training, deliberately NEVER part of the S-vs-K split.

### Router details

- Softmax after top-k (G8-verified win) — inside each population, then cross-population normalization.
- Each routed token gets BOTH populations scored; quorum ensures ≥2 experts per population per token.
- Mind-stage gate provides the sequence-level prior (MoCE-style clustering → "which mind drives this segment").

## Training Doctrine (tie-in: dual-mind-reasoning-traces skill)

- Every distill/SFT trace teaches the FULL cycle: Spock induction → Sheldon adversarial cross-check → synthesis, WITH recorded disagreement (what Sheldon rejected, what Spock corrected, where they converged). The disagreement is the training signal, not the final code.
- Failure-mode traces: include (a) novel problems where Sheldon's template-matching fails — the model must learn the quorum rescues via Spock population; (b) deadline problems where Spock's deliberation fails — Sheldon's binary decisiveness must rescue.
- All traces byte-exact per dual-mind format, execution-verified, prompt-erased (SOL-VER/Magicoder gates).
- Corpus doctrine (comprehension-engineering): near-dup audits, paraphrase-robust evals — disagreement must generalize, not memorize.

## Verification Battery (the claim must be MEASURED, not asserted)

1. **Both-population activation rate** ≥ quorum floor per token (log per-layer histograms in training).
2. **Expert Overlap (S-pop vs K-pop)** must land < 0.3 after P1; else raise L_xpop weight.
3. **Disagreement rate**: fraction of tokens where S-router and K-router top choices differ ≥ 0.5 through training; dropping toward 0 = minds merged = design failure.
4. **Synthesis quality**: samples where both populations voted ≥2/token must pass eval more often than one-population-dominated samples (paired eval on CRUXEval/HumanEval).
5. **Adversarial ablation**: disable one population at decode → measured pass@1 drop. No drop = typed populations are decoration = FAIL the claim.
6. **Train-serve consistency**: same forward pass yields same top-k masks & gate at train vs decode (no batch-coupled state).

## Naming / Public-Facing Rules (Creed-safe)

- The two populations describe COGNITIVE TYPES (rule-adversarial vs probabilistic-synthesis), not trademarked persons.
- Public artifacts (README, docs, prompts, corpus) may speak of "twin reasoning engines" / "adversarial expert colonies" — original wording only. NEVER use Mandalorian/Mandalore/Mando'a/Beskar.
- The Creed (sop_book.CREED, verify-before-claim, train-is-serve, format-exactness) applies to every trained prompt, every corpus document, every gate.

## Where This Lives

- **Design spec**: `E:\FSI-FELON\models\fsi_felon_cipher\CIPHER_V2_DESIGN.md` §16 (Twin-Mind Expert Colony).
- **Psychology profiles (code-embodied)**: `E:\FSI-FELON\models\fsi_felon_cipher\cognitive_profiles.py` (SHELDON/SPOCK blocks — these ARE the type definitions; pair them with argument-disagreement traces).
- **Trace format**: `dual-mind-reasoning-traces` skill (byte-exact trace layout) — extend with explicit Disagreement + Failure-Mode blocks.
- **v1 source (fix targets)**: `E:\FSI-FELON\models\fsi_felon_cipher\src\nanobot_swarm.py`, `src\dual_mind.py`, `src\liquid_time.py`.