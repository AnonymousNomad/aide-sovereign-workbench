---
name: corpus-curation
description: Gold-standard pretraining corpus pipeline for the FSI-FELON models (trek 16.9M, felon 28M, Sopher/cipher 150-300M). Use whenever inventorying, grading, filtering, deduplicating, mixing, or budgeting training data, or deciding what enters or leaves the shared ~1B-token high-quality corpus. Encodes the standing operating order: the training pipeline must be the best in the world for its budget — data quality is the entire strategy for small models.
---

# Corpus Curation — The 1B-Token Gold-Standard Pipeline

Small models have near-zero tolerance for bad tokens. The literature is unanimous:
Phi-1 textbook-quality beat 10x-larger web-trained models; LIMA's 1,000 curated
examples beat 65K uncurated; Cosmopedia's dedup + diversity decided the outcome;
DataMan's multi-axis quality criteria catch what PPL alone misses. **For our
pipeline, every token must be earned: present, real, verified, deduplicated, and
placed in the right mix for the right model.**

## Source of Truth

- Master inventory + grades: `E:\FSI-FELON\TRAINING_PIPELINE.md` (append-only,
  every source listed with size, token estimate, grade, verdict)
- Running state: `E:\FSI-FELON\AGENT_NOTES.md`
- Doc GENERATION rules (separate skill): `gold-training-docs` + `kd-corpus-production`
- Training-run discipline (separate skill): `training-from-scratch`

## Grading Scale (every source gets a letter)

| Grade | Meaning | Verdict |
|---|---|---|
| A | Verified, real, executable: code that parses (AST), executed outputs with real numbers, high-signal bug/verification journals, curated real project docs | KEEP, weight high |
| B | Real but raw: project code/docs that need cleaning (fragments, mixed quality) | KEEP, filter + dedup, weight medium |
| C | Synthetic with real content but template noise (generated variants with placeholder slots, repeated scaffolding) | USE SPARINGLY, strip scaffolding, tiny weight |
| F | Garbage / waste: synthetic template filler, fabricated verification, training logs, progress bars, checkpoints, near-identical duplicates, unverified model output | EXCLUDE — never train on it |

## The 5-Gate Filter (mandatory for every candidate example)

1. **Noise gate** — drop logs, progress bars, checkpoints, binaries, .log, .err,
   token-id arrays, tiny fragments (< ~40 chars), and anything machine-generated
   that is not a document (see F-grade list).
2. **Verification gate** — code must parse (AST). Claims/numbers must come from an
   executed run. **Golden rule: never feed unverified model output into the corpus.**
3. **Dedup gate** — exact (hash) then near-dup (MinHash / shingling). Duplicates and
   near-duplicates are harmful at small scale: they over-train one pattern and waste
   budget.
4. **Structure gate** — real docs are coherent units: complete, self-contained, with
   internal order. Drop strips, generators, one-liners, and scaffold-only shells.
5. **Quality gate** — DataMan-style multi-axis score: factual correctness, structure,
   depth, executability, clarity, originality. Anything failing 3+ axes is dropped or
   demoted.

## Waste List (verified on this machine — never retrain on these without re-verification)

- `E:\nanocoder\data\gen_0`, `gen_1`, `gen_2` — 2.34 GB synthetic template filler;
  every "solution" is the same generic `result.append(process(item))` stub regardless
  of prompt, fabricated verification, random `v:xxxx` ids. Grade F.
- `E:\nanocoder\data\queen_bee_corpus.txt` — synthetic dual-mind templates with
  `[variant N]` placeholders, repeated scaffolding. Grade C at best (strip) — do not
  treat as A.
- `E:\nanocoder\data\gpt_generated` — synthetic `<PROC_*>` template family. Grade C.
- `E:\lab_training_corpus\fsi_jedi` — training logs / progress bars. Grade F.
- Checkpoints, `.log`, `.err` files anywhere in corpus paths. Grade F.
- Any shard dir built from F/C sources is suspect until re-filtered.

## Candidate Keep Sources (to verify against TRAINING_PIPELINE.md inventory)

- `E:\lab_training_corpus\swarm_neci` — ~2 GB real project code + design docs +
  review comments. Grade B (raw; filter fragments, dedup, verify code parses).
- `E:\lab_training_corpus\ferrell_coder\training_data` — design-decision journals
  including "BUGGY VARIANT" high-signal bug/verification data. Grade A-B.
- `E:\colony_teacher` — teacher KD data (verify). Grade B.
- Desktop `training_data` + `generated_training_docs` — small real docs. Grade B.
- Gold-standard docs generated per `gold-training-docs`/`kd-corpus-production`
  (executed, verified). Grade A.

## Token Budget Math (Chinchilla-optimal, practical for 1 GPU)

- trek 16.9M params → ~340M tokens optimal (practically 150-400M)
- felon 28M params → ~560M tokens optimal (practically 300-600M)
- Sopher/cipher 150-300M params → 1.5-6B tokens optimal (practically 1-3B code-heavy)
- A shared ~1B-token corpus: full cover for trek+felon, solid base for Sopher;
  Sopher continues on code-heavy verified data afterward.

## Mix Rules

- Default pretraining mix (shared base): ~50% verified code, ~30% structured docs,
  ~20% general reasoning/knowledge. Never let one synthetic source exceed ~5%.
- Per-model: cipher/Sopher = code-heavy (raise code share, FIM for the seq-2048
  stage); trek/felon = balanced general.
- Curriculum: easy→hard, seq 512→1024→2048; FIM/AST-FIM only on verified code.
- **Diversity-by-evolution (VERIFIED 2026-08-08, LLM-Landing-page-distillation 1.5B):**
  template-based training data collapses to ONE memorized layout; diversity of
  business types x styles x layouts is what creates genuine variety (they used
  100 business types x 10 styles x 10 layouts; the small model hit a capacity ceiling
  ~500 examples). At small scale, data diversity >= quantity. Every doc KIND must be
  generated across a broad base of instance types, styles, and structural variants —
  never N examples of one template. This is the anti-template / "unique output" lever.
- **MiniPLM / difference sampling (VERIFIED 2026-08-08, ICML'25):** at fixed
  perplexity-reduction budget, difference sampling (weight samples by log-prob
  DIFFERENCE between consecutive model sizes) cuts pretraining tokens 2.4x vs uniform
  sampling at equal accuracy. Data DIVERSITY matters more than total volume for small
  models: uniform high-volume repetition wastes the token budget.
- **OPD / on-policy distillation (VERIFIED 2026-08-08):** distilling the CURRENT
  (student) model's own rollouts from a teacher, with higher reward for out-of-
  distribution examples, beats strong baselines (matched a full 1T-token teacher);
  do NOT distil only from a fixed offline teacher corpus — include on-policy rounds.

## Cross-Synthesis Layer (mandatory domain interlinking)

The models must understand HOW domains relate, not just each domain alone. The
standing design: human behavioral science (48 Laws of Power, 48 Laws of Human
Nature, psychology, mentalism), Machiavelli's The Prince, cybersecurity, SO
architectures/frameworks, and coding share transferable analytical structures —
constraints, incentives, hierarchy, feedback loops, boundaries/contracts,
deception vs. verification. Training on these interconnections makes every
capability (code, security, reasoning, architecture) stronger because each is
mapped onto the same deep pattern language.

- Every corpus batch MUST include cross-synthesis documents pairing at least two
  domains and making the mapping explicit (e.g., "social influence as system
  design", "deception patterns as threat modeling", "negotiation as protocol
  design", "Machiavellian strategy as software architecture tradeoffs").
- Cross-synthesis docs must still be verified, structured, and non-synthetic-filler
  (they can be gold-standard generated docs per gold-training-docs/kd-corpus-production
  rules — analysis with concrete executable examples where possible).
- Target: ~10-20% of the shared corpus is cross-synthesis material. It is a
  first-class citizen, not an afterthought.
- Existing seeds on disk (small, to expand): `human_nature_corpus.txt`,
  `white_rabbit_corpus.txt`, `general_knowledge_corpus.txt`, `cross_domain_corpus.txt`,
  `partnership_corpus.txt` in the nanocoder data dirs.

## Workflow (when building/curating)

1. Inventory the candidate source (read-only): size, file count, sample 10-30 files,
   grade it A/B/C/F, record in TRAINING_PIPELINE.md.
2. Before writing ANY curation script, present the plan (gates, dedup method,
   target output path, expected token yield). Sandbox the script on a small sample.
3. Run on a COPY in `E:\pip_temp\opencode` first; verify counts; only then write the
   real corpus path.
4. After building, verify the output: token count, source mix, dedup stats, a
   random-sample eyeball check. Log everything.
5. Never delete or overwrite an existing corpus path in place — build new, then swap.

## Discipline

- Every corpus change is logged in AGENT_NOTES + reflected in TRAINING_PIPELINE.md.
- Every claim about a source is backed by an observed sample (quote it).
- If a source cannot be verified, it does not ship. Zero exceptions.
