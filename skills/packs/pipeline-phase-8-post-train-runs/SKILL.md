---
name: pipeline-phase-8-post-train-runs
description: Phase 8 of the from-scratch training pipeline — running the post-training stages (SFT, distillation, preference). The sequencing doctrine (SFT -> distill -> DPO/GRPO), per-stage recipes with THIS card's verified numbers (SFT one epoch at 5e-5 full-FT with replay mix, distill on-policy verifier-gated, DPO beta 0.1 lr 5e-7, GRPO exact-verifier-only), per-stage gates (Gate 1 format, Gate 2 reasoning, Gate 3 preference), and the retention/regression doctrine between stages (web/env floors must hold — this project's collapse precedents). Use when deciding the next post-train stage, launching an SFT/distill/DPO/GRPO run, or gate-checking a post-train checkpoint on the 150M rebuild.
---

# Phase 8 — Post-train Runs

Phase 7 built the data. Phase 8 runs the stages: SFT → distill → preference.
Every stage has a verified-safe recipe for THIS card (GTX 1060, FP32, 6GB, 16GB
RAM), a gate that must pass before the next stage, and retention floors that
protect the formats the model already has. This project's own failures define
the guardrails: 242-pair SFT disproven at 5e-5 (honest 0/20), env collapse
0.87→0.33 and web 1.00→0.87 when SFT ran without replay, DPO failed-at-data on
13 low-margin pairs, human-safe gates stuck at 0.25.

Research sources: LLaMA2 SFT (2307.09288), Orca-2 (2311.11045), phi-1 (2306.11644),
DPO (2305.18290), GRPO (2402.03300), Yin et al 2025, LIMA (2305.11206),
post-training-sft/-distill/-preference, multi-format-retention-repair,
verification-complete.

---

## 1. Stage Sequencing (the doctrine)

```
Gate 0 (Phase 6) base passes
  -> STAGE 1: SFT (instruction format + behavior)
  -> Gate 1: format check (byte-exact formats parse, honest chat gate passes)
  -> STAGE 2: DISTILL (reasoning transfer, verifier-gated traces)
  -> Gate 2: reasoning check (holdout reasoning probes pass)
  -> STAGE 3: PREFERENCE (DPO for alignment, GRPO for verifiable tasks)
  -> Gate 3: final eval (full Phase-9 battery)
```
NEVER skip a stage (SFT directly to DPO without distill = preference on a model
that can't reason the task — the 2026-08-11 DPO failed-at-data root cause).
Each stage trains from the PREVIOUS stage's best checkpoint (lineage is
recorded; a stage that fails its gate does NOT poison the lineage — you re-run
from the last gate-passing checkpoint, never from a gated-out one).

### Why
- Gates prevent compounding: a format-broken model reasoning "correctly" is
  still a broken product (envelope is byte-hair-trigger — one drift breaks the
  gate).
- Lineage isolation means a failed stage is a re-run, not a restart.

### Expected bugs / issues
- Re-training from a gated-out checkpoint (lineage poison) — enforce via the
  checkpoint manifest: every run records `parent_gate_passed: true|false`.
- Skipping distill for speed → DPO optimizes formats, not reasoning (the model
  gets "politely wrong").

---

## 2. Stage 1 — SFT (recipe for THIS card)

### What to do
- **Data**: Phase-7 SFT dataset (1-3K pairs, kind-tagged, ≥20% replay mix).
- **Epochs**: 1 epoch (LLaMA2/SmolLM precedent). 2 epochs MAX if Gate 1 fails
  on a no-replay run (and then fix the DATA, not the epochs).
- **LR**: 5e-5 full-FT (VERIFIED-SAFE on this card — 1e-4 damaged the envelope
  in probes; 5e-5 preserved env 0.87 and web v3 1.00 while teaching chat).
  Distill stage uses 3e-5 (gentler, later in lineage).
- **Optimizer**: AdamW (0.9, 0.95) eps 1e-5 **wd 0.01 — VERIFIED REALITY
  (2026-08-16 audit: ALL post-train trainers — sft/distill/dpo — use
  WEIGHT_DECAY 0.01, NOT the Phase-5 pretrain's 0.1)**; clip 1.0.
- **Batch**: batch 2 × accum 24 (eff 48) — VERIFIED in train_sft_150.py
  (BATCH_SIZE 2, GRAD_ACCUM 24).
- **Loss**: causal CE on the ANSWER tokens only (mask the instruction —
  padding-free packing, loss mask per pair).
- **Run length**: eval every 3 steps (small datasets; the 21-step chat SFT
  precedent showed trajectory detail matters), save best by Gate-1 composite.
- **The composite gate** (this project's canonical): 
  `gate = 0.5*chat + 0.25*env + 0.25*web` with floors `env >= 0.8 AND web >= 0.6`.
  Chat = honest overlap gate (Jaccard ≥ 0.15 + non-degenerate), env = strict
  envelope parse, web = verified web scorer. NO-GOLD eval prompts FAIL (law).

### Why
- 5e-5 + replay is the verified-safe operating point on this card (probe
  history). Higher LR without replay = format collapse (documented twice).
- Answer-only loss: the model shouldn't memorize instructions; it should learn
  to respond (LLaMA2 SFT practice).

### Expected bugs / issues
- Eval cadence too sparse (every 10+) on a 20-30-step run misses the best
  checkpoint (the step-1-best precedent: best gate was step 1).
- Replay pairs counted as "chat" in the gate → retention looks better than it
  is; gate by KIND, not by aggregate.
- LoRA keys leaking into a full-FT checkpoint save (save-filter bug precedent)
  → the strict-load assert catches it at Phase 9.

---

## 3. Stage 2 — Distill (recipe for THIS card)

### What to do
- **Data**: Phase-7 trace set (short verified, prompt-erased, ≤384 tokens).
- **Teacher**: Qwen3.5-4B local, `enable_thinking=false` (MANDATORY — empty
  content otherwise), within its verified envelope (NOT for web/format tasks).
- **On-policy generation**: generate traces with the CURRENT student (the
  Phase-7 set is seeds; the distill set is generated at the student's level),
  verify every final answer (execute/parse/reference), keep only verified.
- **LR**: 3e-5 is the skill's conservative target; VERIFIED REALITY
  (2026-08-16 audit): train_distill_150.py probes 1e-4 vs 5e-5, chosen by
  held-out verifier pass rate — pick the probe winner, 3e-5 if a gentler third
  option is needed. 1-2 epochs, **batch 1 × accum 48 (VERIFIED — VRAM: batch 1
  at 1600-token sequences on the 6GB card; eff 48 samples/step matches SFT)**,
  clip 1.0, wd 0.01.
- **Loss**: CE on the full trace (reasoning is the target, not just the answer),
  with the answer block weighted ×1.5 (answer correctness matters most).
- **Balanced plan** (VERIFIED in train_distill_150.py): draw_balanced_plan
  interleaves W1 (web) and T2 (teacher-trace) rows so no optimizer step is
  starved of either — retention + reasoning in every step.
- **Gate 2**: holdout reasoning probes (5-10 per family): the final answer
  passes the verifier AND the trace is non-degenerate (not memorized verbatim
  teacher text — check overlap < 0.5 vs teacher output).

### Why
- On-policy + verified: the student learns what IT can produce, verified —
  the closed-loop generate→verify→self-correct doctrine.
- Weighting the answer block: the trace teaches the path, the answer teaches
  the destination; both must be right.

### Expected bugs / issues
- Teacher prompt residue in traces (learns to echo "system:") — prompt-erasure
  filter + assert (Phase 7).
- Degenerate traces (memorized verbatim) pass the verifier but teach nothing —
  the non-degeneracy check is separate from verification.
- Long traces overwhelming the 150M (Yin 2025) — the Phase-7 length gate is the
  guard; re-check student truncation at eval.

---

## 4. Stage 3 — Preference (DPO/GRPO)

### What to do
- **DPO**: beta 0.1 (VERIFIED: BETA=0.1 in train_dpo_150.py), lr 5e-7..1e-5 —
  VERIFIED REALITY: the trainer probes 1e-5; if probes destabilize, drop toward
  5e-7 (START LOW — DPO is fragile on small models), 1 epoch, batch 1 (VERIFIED)
  × accum 24. Data: Phase-7 pairs with margin
  ≥ 0.01 (never re-use the failed 13-pair set).
- **GRPO**: ONLY exact-verifier tasks (code passes tests, math known-answer).
  Group size 4-8, clip range ~0.2, 1 epoch.
- **Gate 3**: the full Phase-9 battery — the composite gate + novelty +
  coherence + safety + fresh regression. DPO that improves a score while
  collapsing another (envelope/web) FAILS (the 2026-08-11 DPO precedent: probe A
  envelope 1.00→0.00 = instant fail).

### Why
- Small models + DPO = high variance; low LR + high-margin pairs + 1 epoch is
  the safe envelope (this project's DPO probes: low-margin pairs failed,
  high-margin needed).
- GRPO without an exact verifier = reward hacking on the scorer (never).

### Expected bugs / issues
- Margin computed with a buggy normalizer (logo_cloud/contact precedent flipped
  17 false-fails + 7 false-passes) — always recompute margins with the CURRENT
  verified scorer before pairing.
- DPO beta too high (0.3+) → mode collapse to the reference; 0.1 is the safe
  start.
- Preference run that improves chat but drops env below the floor → REJECT the
  run, not the floor (floors are the law; runs are expendable).

---

## 5. Run Supervision (Phase 6 machinery, reused)

- Preflight PASS before every stage launch (law).
- Watchdog + health ping + JSONL ledger + monitor.py (Phase 6).
- Checkpoint: full state + `parent_gate_passed` + `stage` + `dataset_manifest`
  version. Atomic save (Phase 1).
- Resume parity test on every restart (Phase 6 §4).
- Spike recovery ladder (Phase 6 §3) — post-train runs are short; a single
  spike usually means a DATA bug (Phase 7), not a model bug — stop early.

---

## 6. Verification Checklist (Phase 8 DONE only when ALL pass)

- [ ] Stage order respected: SFT → (Gate 1) → distill → (Gate 2) → preference →
      (Gate 3); no skipped stages
- [ ] Gate 1: byte-exact formats parse (env strict + web 40/40 + chat honest
      gate) — no-gold FAILS; floors env ≥ 0.8 AND web ≥ 0.6 held
- [ ] Gate 2: holdout reasoning probes pass verifier; traces non-degenerate
      (overlap < 0.5 vs teacher)
- [ ] Gate 3: full Phase-9 battery — composite gate, novelty, coherence, safety,
      fresh regression all pass; no score collapsed (compare vs stage-parent
      checkpoint, not vs historical baselines measured with old normalizers)
- [ ] LR discipline: 5e-5 SFT, probe-winner or 3e-5 distill (verified probes:
      1e-4 vs 5e-5), 1e-5→5e-7 DPO; no LR escalation without
      a documented data change
- [ ] Lineage: every stage trained from the previous gate-passing checkpoint;
      gated-out runs never enter the lineage
- [ ] Every launch had preflight PASS; watchdog + monitor active; resume parity
      tests passed
- [ ] Best checkpoint per stage saved with full state + manifest (parent gate,
      stage, dataset version)
- [ ] Gate-3 checkpoint promoted as the post-train final → Phase 9/10

---

## 7. Dependencies Summary

Phase 7 datasets (manifest-versioned), Phase 5 trainer (reused for SFT/distill;
preference needs the DPO/GRPO objective module), Phase 6 monitoring, Phase 9
gates (defined next — the evaluators consumed here), teacher server for
on-policy distill. No new libraries (DPO/GRPO objectives are ~100 lines each).

---

## 8. When Done

Mark Phase 8 complete in AGENT_NOTES with each gate's numbers (Gate 1/2/3),
stage lineage, and the promoted checkpoint path, then proceed to Phase 9
(Eval & Gate Verification): skill `pipeline-phase-9-eval-gates`.