---
name: synthetic-data-pipeline
description: Big-tech synthetic training-data production at scale for small models — teacher rotation (generate → verify → delete → next teacher), Nemotron-style curation, reasoning-trace distillation, Evol-Instruct evolution, and synthetic-mixture budgeting. Use whenever planning a synthetic corpus build of tens-to-hundreds of millions of tokens, selecting/rotating a generation teacher, scaling up KD, or deciding how much synthetic data can safely enter the shared ~1B-token corpus. Complements (does not replace) kd-corpus-production (per-doc 5-gate pipeline) and corpus-curation (inventory/grading).
---

# Synthetic Data Pipeline — Big-Tech Practice for Small Models

Big tech does not hand-write corpus data at scale; it *engineers* it: curate huge
raw pools, then use the strongest available models to synthesize or rephrase the
subset that survives. This skill encodes that practice for our budget (one GPU,
one operator, sub-1B students) so synthetic tokens are produced with the same
discipline Google/NVIDIA/Microsoft/DeepSeek apply.

## Research Foundations (what big tech actually does)

| Source | Proven Principle | Applied As |
|---|---|---|
| NVIDIA Nemotron-CC (2025-05) | Massive raw pool → **curation decides the corpus**: 28 heuristic filters + FastText quality classifier + Mixtral Edu-classifier ensemble + perplexity scoring remove ~10%; synthetic rephrasing/scoring then *expands* the survivors | Every generated batch passes a curation stack BEFORE it enters the corpus; generation starts only from verified raw material or verified teacher output |
| DeepSeek-R1 distillation (EMNLP 2025) | Explicit reasoning traces improve answer quality; answer tokens attend substantially to the reasoning tokens — **reasoning-trace data is deliberately valuable** | Never strip the rationale to ship answer-only synthetic data; the chain is the signal |
| Phi-1 / phi-1.5 (Microsoft) | A small model trained on LLM-generated **textbook-quality** tokens (~20B) beats 5x-larger web-trained models | Every synthetic doc is a complete worked exercise with verified output — quality of a single token beats volume |
| WizardLM Evol-Instruct (2023) | LLM-driven *evolution* of instructions raises complexity + diversity better than hand-writing data | Rotation pass can **evolve** (deepen, diversify) a verified seed doc instead of re-generating a near-copy |
| Synthetic-data scaling study (EMNLP 2025) | Mixture ratios are a systematic decision: how much synthetic vs raw, and which synthetic source, measurably change outcomes | Every corpus build records and justifies its synthetic share; never drift above the mix budget |

## The Teacher Rotation Loop (core workflow)

Purpose: run a rotation of the strongest available coding/reasoning models — each
generates what it is best at, then is **deleted**, replaced by the next teacher —
until the gold-standard synthetic layer is produced. Discipline requirement: every
step below is a gate. Nothing ships on vibes.

1. **Select the teacher for the current slot.** The slot decides the specialty
   (reasoning, code, knowledge, instruction-following). Pick the strongest model
   that (a) exists on disk and (b) is byte-exact complete. No teacher → no slot.
2. **Verify the teacher live BEFORE any batch.** File completeness (size delta = 0
   vs `.cache\huggingface\trees\*.json` expected sizes) is necessary but NOT
   sufficient. Run a short coherence generation (`--no-jinja --temp 0`, and a
   `--jinja -c <ctx>` tool-call variant) and read the output. Corrupt GGUFs
   produce degenerate repeats ("ECT inflouno...", "#########") — such models are
   dead on arrival and get deleted, not audited.
3. **Generate within the teacher's envelope.** Each teacher only generates what it
   is actually strong at (LFM2.5 = reasoning/instruction/tool-calling; a Coder
   model = code traces; a math model = math). Never ask a teacher to produce
   outside its verified strength — that is how unverifiable filler is born.
   Always pass explicit context (`-c 4096`) — defaults silently truncate.
4. **Verify the OUTPUT (Nemotron-style curation stack), not just the teacher.**
   Every generated doc passes: coherence check (no degenerate repeats /
   template stubs / placeholder slots) → verification check (code parses via
   AST, numbers come from an executed run) → format check (byte-exact doc
   template from kd-corpus-production) → quality scoring (factual correctness,
   structure, depth, executability, clarity, originality).
5. **Dedupe.** Exact (hash) then near-dup (MinHash/shingling) against the corpus
   index. Never train on the same pattern twice.
6. **Stage** the survivors into the corpus staging path with measured token counts.
7. **Delete the teacher. Rotate.** The model is a consumable — after its slot is
   done (or it is found corrupt/unusable), remove it from the rotation and move to
   the next teacher. Logged, irreversible, keeps the disk clean.
8. **Log every batch** to AGENT_NOTES and the corpus index (topic → filename).

## Envelope Rules (what a teacher may generate)

- **Never feed the model its own incoherent output** (STaR self-poisoning). Only
  verified teacher output ships.
- **Never re-label as reasoning** what was one generation pass split by keywords
  (documented failure: `dual_mind_distill.py` fake SHELDON/SPOCK). Distinct
  generation passes or a genuine `--cross-check` pass only.
- **Never extrapolate a teacher beyond its runtime context.** When a trace is fed
  back to a teacher for verification, `-c` must exceed the trace length.
- **The bulk of the corpus is still verified raw data on disk**, not LLM
  generation. At ~10-20 tok/s on one GPU, LLM generation is ~1M tok/day: 1-2B
  tokens purely by generation is 2-6 years. The synthetic layer is the high-value
  reasoning/instruction KD layer (~50-150M feasible), layered on verified raw
  data (ferrell ~200M, swarm_neci ~150M, colony_teacher ~75M, gold_corpus ~3.5M).

## Synthetic Share Budget (from the scaling study)

- Never let ONE synthetic source exceed ~5% of the shared corpus.
- Total synthetic/KD layer target: ~50-150M tokens of the ~1B corpus (reasoning +
  instruction + cross-check traces). Enough to transfer teacher-level reasoning,
  not enough to collapse or over-train a single pattern.
- Default pretraining mix: ~50% verified code, ~30% structured docs, ~20% general
  reasoning/knowledge. Synthetic layers slot into the reasoning/instruction share.
- Record the ratio per build; a change to the ratio is a reviewable decision, not
  a side effect.

## Teacher Verification Checklist (run in this order, abort on any failure)

1. File content-intact? **SHA-256 must equal the HF tree json's `lfs_sha256`** (for safetensors) or the publishing model card's sha for GGUFs. Size match is NOT completeness — proven failure: 4 of 4 downloaded models (Qwen GGUF, Phi GGUF, DeepSeek-Coder + DeepSeek-R1 safetensors) were byte-length-identical to expected yet content-corrupt; hashes caught all four. Hash mismatch or missing reference hash = abort.
2. Architecture supported? (`LlamaForCausalLM`-style = plain; exotic archs need
   trust_remote_code and a working HF path — unproven on this box)
3. Live coherence generation? (raw mode AND jinja/tool mode; no degenerate repeats)
4. Live output within claimed envelope? (a "coder" must emit parseable code)
5. No PEG/template grammar errors at realistic context?

Any failure → the model is deleted from the rotation and recorded as F/unusable.
Recorded pass → the teacher is authorized for its slot.

## Discipline

- Every rotation event (teacher in, teacher out) and every batch is logged in
  AGENT_NOTES with the skill name.
- Every synthetic doc's numbers/claims trace to an executed run or a verified
  teacher pass. Unverifiable → does not ship.
- Apply this skill by name, then hand each survivor doc to the per-doc 5-gate
  pipeline (kd-corpus-production) before staging.
