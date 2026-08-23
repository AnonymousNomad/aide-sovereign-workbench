---
name: pipeline-excellence
description: THE master quality bar for the FSI-FELON training pipeline. Use at the START of every session, before ANY data generation, curation, training run, gate eval, or post-training stage, and whenever deciding what to do next. Defines what "best in the world" means operationally (measured, not vibes), the Pipeline Constitution (non-negotiable laws), the stage-gated scorecard with binary gates, the audit loop that verifies the pipeline itself, and the rivalry test (we must be better than Big Tech practice at every stage, for our budget). This skill is the umbrella: it routes to and enforces every other pipeline skill (corpus-curation, comprehension-engineering, original-trace-engineering, gold-training-docs, kd-corpus-production, synthetic-data-pipeline, zero-dup-high-quality, training-from-scratch, post-training-pipeline + stage skills, train-serve-consistency, web-builder, model-scaling, surgical-precision, professional-developer). When any instruction conflicts with this skill's constitution, quality and truth win.
---

# Pipeline Excellence — the World-Class Standard

## The Doctrine

A small model trained by one dev on one GTX 1060 cannot out-compute big labs.
It can only OUT-QUALITY them. Therefore **the training pipeline is the product**,
and the pipeline's quality bar is: *every token earned, every number measured,
every gate passed with evidence, every claim true*. "Best in the world" is not
a feeling — it is a scorecard with binary gates, and the pipeline is world-class
IFF every gate passes. No gate can be waived because we are small; smallness is
exactly why the bar is higher.

The standard is asymmetric: Big Tech can waste tokens; we cannot. Phi-1
(textbook-quality beat 10x-larger), LIMA (1,000 curated > 65K uncurated),
Cosmopedia (dedup + diversity decided the outcome), and every verified result
on this machine (colony_teacher 100K -> 9,735 unique; ferrell 32,807 -> 20,434)
prove it: **quality and uniqueness ARE the strategy. Volume is not.**

## The Pipeline Constitution (non-negotiable laws)

1. **Truth law** — every number in a manifest, log, note, or gate result comes
   from an executed run on this machine. Never report an estimate as a result,
   never fabricate a verification, never claim a test passed without running it.
   Violating truth law is the only unforgivable error.
2. **Verified-data law** — nothing enters the corpus that was not verified:
   code that executes, numbers from real runs, tests that pin concrete values.
   Unverified model output NEVER feeds back into the corpus (STaR lesson, 8/3).
3. **Zero-dup law** — no duplicate or near-duplicate document may ever be
   staged. Dedup is layered (exact hash -> structural-sig -> MinHash at scale),
   run at generation time AND after staging, and recorded in a receipt.
4. **Comprehension law** — the model must understand, remember, and know —
   never memorize. Every corpus build carries the comprehension levers:
   evolve-not-copy, interleave, preserve reasoning traces, contrastive
   structure, capacity-matched content, and a near-dup audit before staging.
5. **Gate law** — training decisions are made by gates, never by loss curves
   alone: Gate 0 (pretrain finalize) -> Gate 1 (SFT format) -> Gate 2
   (distill reasoning) -> Gate 3 (preference/RLVR final eval). A gate that
   fails is fixed by data or method, NEVER by training longer on the same data.
6. **Train==Serve law** — what the model does in training (prompt wrapping,
   memory reset, slot prepend) is byte-identical to what it does at inference
   (train-serve-consistency skill). No batch-coupled state, no dead gradients,
   no decode-side differences.
7. **Own-traces law** — data everyone can download is commodity, not the edge.
   The edge is traces we engineer from our own verified seeds (original-trace-
   engineering doctrine). HF/third-party traces are raw material at best.
8. **Decontamination law** — no eval-benchmark overlap in training data
   (8-gram overlap + structural-sig checks). The eval harness is the referee;
   it must stay clean.
9. **Honest-eval law** — evals are paraphrase-robust, leak-free, and include
   transfer/boundary probes. A model that passes only train-phrased items has
   memorized and is not done.
10. **Logging law** — every data build, run, gate, and decision is logged in
    AGENT_NOTES with measured numbers and the governing skill named. If it is
    not logged, it did not happen.

## The World-Class Scorecard (stage gates with evidence)

Every stage ships ONLY with its binary gate green and its evidence attached.

| # | Stage | Gate (must be green) | Evidence (must exist) |
|---|---|---|---|
| 0 | Seed/data inventory | Source graded A/B/C/F from observed samples (not estimates) | TRAINING_PIPELINE.md entry with size, token count, grade, quote |
| 1 | Curation | 5-gate filter passed; layered dedup done; near-dup audit <10% within kind | Dedup receipt (in/out counts, per-layer collapse, tokens) + manifest |
| 2 | Generation (gold/synthetic/traces) | Execute-verified; tests pin concrete values; structural-sig unique AT generation; reasoning matches executed reality | Per-doc verification log + token counts + lineage |
| 3 | Mix/budget | Mix within rules (code ~50%, structured docs ~30%, general+cross-synthesis ~20%; single synthetic source <=5%; cross-synthesis 10-20%); capacity-matched to student | Mix report with token totals per bucket |
| 4 | Pretraining | Healthy curve, val loss tracked, spike recovery procedure known, cloze evals rising, checkpointing resumable, no val leak | Training log with step/loss/val/lr + eval log |
| 5 | Post-training | SFT gate 1 (format) -> distill gate 2 (reasoning) -> preference/RLVR gate 3 (final), each gated before the next stage starts | Gate logs with measured rates on HELD-OUT sets |
| 6 | Train==Serve | Generation path == training path; state hygiene verified | Consistency battery result |
| 7 | Deployment | Quantization, serving, monitoring; final eval honest and recorded | Eval report + serving smoke test |

## The Audit Loop (verifies the pipeline itself)

Weekly or per-session, run the pipeline audit — this is what makes the pipeline
self-correcting instead of aspirational:

1. **State audit** — what is training right now? What stage? Is a process alive?
   GPU state? (verify with nvidia-smi + process check, never assume.)
2. **Corpus audit** — sample 10-30 files of the newest batch. Run near-dup
   audit vs corpus index. Check mix numbers. Check dedup receipts exist.
3. **Gate audit** — replay the last gate result; confirm the checkpoint that
   passed is the one staged for the next stage.
4. **Truth audit** — spot-check 3-5 numbers in manifests/notes against the
   actual files/runs.
5. **Rivalry audit** — for the current stage, ask: what does the best-known
   practice do (Phi, DeepSeek, Google, Meta, OpenAI)? Are we better or equal?
   If they have a practice we don't, we research it and either adopt or
   document why not. (See Rivalry Test below.)
6. **Write the audit result** into AGENT_NOTES (what passed, what failed,
   what was fixed).

## The Rivalry Test

For every stage of the pipeline, there is a known-best practice from Big Tech
or frontier research. World-class means: for each stage, we can name the
benchmark practice AND our answer, and our answer is equal or better for our
budget.

- Data: Phi-1/Phi-4 textbook quality + seed discipline; DeepMind AlphaCode
  test-suite falsification (30-60% false positives -> 4% via mutation +
  consensus); Meta synth_gen verify-fix loop; AlphaEvolve execution-grounded
  evolution; IBM entity-matched rationales; DCE uniqueness-at-generation.
  Ours: all of the above, plus a deterministic closed-loop verifier system as
  teacher (web_builder scorer, AST gates, execution sandbox) — Big Tech's
  verifiers are weaker or nonexistent at our class.
- Training: Smol training playbook, Google tuning playbook, W&B white paper,
  Axolotl/LightlyTrain stability, EACL 2026 curriculum. Ours: gate-driven,
  resumable, OOM-recovering, train==serve.
- Post-training: Orca-2, DeepSeek-R1 rejection sampling, DPO on-policy,
  WebGen-R1 scaffold+reward, RLVR. Ours: preference pairs from a deterministic
  scorer (free high-quality labels), closed-loop repair harness.
- If we lose a stage comparison, that stage becomes the next work item.
  Losing is not acceptable as a resting state.

## Routing (which skill governs what)

- Choosing a model size/config: model-scaling (hard cap 150M, probe first)
- Corpus inventory/grading/mix/budget: corpus-curation
- Anti-memorization / comprehension evals: comprehension-engineering
- Coding traces / own data: original-trace-engineering
- Gold docs per doc: gold-training-docs + kd-corpus-production
- Big synthetic builds: synthetic-data-pipeline
- Pretraining runs: training-from-scratch
- Post-pretraining sequence: post-training-pipeline (+ sft/distill/
  preference/closed-loop stage skills)
- Train==Serve verification: train-serve-consistency
- Web-builder capability (spec/render/scorer/closed-loop): web-builder
- Verification-first discipline on every action: surgical-precision +
  professional-developer
- Everything above, consolidated: model-engineering (master) + project-governance

## Failure Modes (each observed on this machine or in literature — do not repeat)

1. **Template collapse / near-dup massing** (OBSERVED: queen_bee templates 77%
   of shards; colony_teacher 100K -> 9,735; gold_web_* 31K files same 8
   sections). Fix: evolve-not-copy + uniqueness AT generation + near-dup audit.
2. **Fake verification** (OBSERVED: gen_0/1/2 fabricated v:xxxx verification,
   same stub answer for every prompt — poisoned v4 to 0.01 memorization).
   Fix: truth law + execution gate.
3. **Val/eval leak** (OBSERVED 8/3: val sampled from same corpus array ->
   memorization metric). Fix: separate held-out sets, decontamination law.
4. **Weak tests that false-pass** (OBSERVED: isinstance/callable/>=0 asserts).
   Fix: AlphaCode-style concrete assertions + consensus validation.
5. **Unverified self-feedback** (STaR 8/3 lesson: model output fed back into
   corpus -> garbage). Fix: verified-data law, closed-loop gates verify first.
6. **Invented reasoning** (OBSERVED: relabeled fake SHELDON/SPOCK traces).
   Fix: IBM entity-matched rationales — narrative must match executed values.
7. **Gate-waiving** ("it's close enough") — the death of the pipeline. Fix:
   gates are binary; a failed gate is fixed by data/method, never waived.
8. **Optimism-as-evidence** (unmeasured claims like "should converge").
   Fix: every claim carries a number from a run.

## The Creed (The Way of the Developer)

The program's discipline doctrine, binding for every model and every pipeline
action (full text: `E:\FSI-FELON\CREED.md`). The Creed is not flavor text: it
is a Constitutional-AI mechanism — (1) constant at the top of every trained and
served prompt (`sop_book.CREED`), (2) trained into weights by every corpus
document, (3) enforced by the deterministic judge (`process(..., sop_gate=True)`
= the Creed's verdict), (4) the DPO reward signal (chosen walks the Way,
rejected violates it), (5) self-correction on rejection, (6) an eval dimension
(Creed-violation rate on held-out briefs).

Creed laws that outrank everything else:
- **Verify before you speak** — no claim ships unverified; "This is the way."
  is spoken ONLY on a 100% verified, gate-accepted result. Never on a maybe.
- **The helmet never comes off** — train is serve, byte-exact, always.
- **The foundling is raised right** — every corpus doc and every build is
  parsed, scored, gate-checked, and running before it ships.
- **Naming** — public artifacts use original wording: "The Way of the
  Developer", "The Creed", "This is the way". Never "Mandalorian"/"Mandalore"/
  "Mando'a"/"Beskar" or verbatim canon oaths in anything public (models ship).

## Session Protocol (mandatory)

1. On session start, load this skill + model-engineering + agent-notes.
2. Verify training state FIRST (process alive? GPU? log tail? stage?).
3. Check AGENT_NOTES for the last logged gate/decision.
4. Before ANY run: confirm the data/gate prerequisites for that stage exist.
5. After ANY run/batch: log measured numbers, update manifests, update
   TRAINING_PIPELINE.md.
6. If a gate fails, do NOT train more on the same data — fix the data or the
   method, then re-run the gate.

## Discipline

- The scorecard is checked every session; the audit result is logged.
- Every claim in this project's notes/manifests traces to a run on this machine.
- This skill outranks comfort: no "ship it anyway", no "close enough", no
  unverified numbers, no commodity data as the product.
- The pipeline is never finished — it is audited, measured, and improved.
  State-of-the-art for our class is the resting state, and the scorecard is
  how we prove it.
