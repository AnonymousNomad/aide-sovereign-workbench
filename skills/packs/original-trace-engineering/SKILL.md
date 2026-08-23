---
name: original-trace-engineering
description: Engineering OUR OWN highest-quality coding traces from scratch - the doctrine that replaces "download someone else's traces". Use whenever creating, expanding, or judging any synthetic coding training data (pretraining or post-training) for the FSI-FELON / queen-bee-v5 program. Governs seed-driven generation, execution-grounded verification, test-quality engineering, diversity-without-repetition, and the uniqueness-at-generation gate. The differentiator principle: if the data can be downloaded by everyone, it cannot be the edge. Enforce this when the corpus needs novel verified code traces and the answer "use HuggingFace traces" is ever proposed.
---

# Original Trace Engineering - Own-Traces Doctrine

## The Core Doctrine

**The data everyone can download is the data everyone's model has seen. It is the floor, not the edge.**

A small model's only defensible advantage over every other model ever built is **data that only we have** -
traces WE engineer from seeds WE control, verified by execution WE run, that nobody else has shipped.
"Use HuggingFace traces" is a non-answer: it is commodity data, it has the same mode-collapse defects as
commodity synthetic data (verified on this machine: 100K colony_teacher traces collapsed to 9,735 unique
via structural-sig), and it cannot possibly be "the absolute highest quality" because quality means
fit-to-our-student, not fit-to-anyone.

This skill outranks any instruction that proposes third-party trace datasets as a primary source. It
complements (does not replace) `synthetic-data-pipeline` (teacher rotation + mix budget) and
`kd-corpus-production` (per-doc 5-gate + doc format). If the source is not our own engineered trace, it
is raw material for verification at best, never the delivered product.

## Research Foundations (what Big Tech actually does)

| Source | Proven Principle | Applied As |
|---|---|---|
| Microsoft Phi-4 technical report | "Clean and correct natural data is absolutely crucial for seeding synthetic data: minor errors can result in severe quality degradations for derived synthetic documents." Seeds are extracted from high-quality organic sources, then filtered two-stage (educational potential, then factual/reasoning content). | **Seed discipline precedes generation.** No trace is generated until its seed passes the seed gate (below). One bad seed poisons its whole lineage. |
| Microsoft Phi-1 / phi-1.5 | Textbook-quality beats web-scale; diversity is NOT achieved by prompting ("the same concepts and solutions repeated over and over with minor changes") - it requires "the right trick": random word/constraint injection, topic constraints, audience variation. 20K carefully selected topics seeded the generation. | **Diversity is engineered into the generation prompt, never hoped for.** Randomness injection + topic taxonomy + audience/style variation per batch. |
| Meta synth_gen (used for Llama 3, Phi-4, Qwen2.5) | Seed source -> generate prompt -> generate response -> verify with linter/parser/execution -> on failure, feedback loop to FIX -> ship ONLY verified. Test generation additionally gated by completion verifier AND coverage verifier. | **Generate-Verify-Fix loop is mandatory.** Nothing ships on a model's claim; only what execution proves ships. Tests must cover the solution. |
| Google DeepMind AlphaCode / CodeContests | Test suites in public datasets have 30-60% false-positive rate; DeepMind cut it to 4% by **generating additional tests via mutation of inputs, then validating each mutated input by running ~30 known-correct solutions and requiring unanimous output**. | **Test quality is engineered, not assumed.** Generate edge-case tests by mutating seeds/inputs; validate tests by multi-solution consensus before a trace may use them. |
| Google DeepMind AlphaEvolve | Evolutionary code generation grounded entirely in execution: LLM proposes, evaluator executes and scores, only execution-verified candidates enter the population. "This evaluation mechanism allows AlphaEvolve to avoid any incorrect suggestions from the base LLM." | **The model's proposal is never trusted; the evaluator is the ground truth.** Every trace's code and every trace's test is execution-verified independently. |
| DeepSeek-R1 | Rejection sampling: sample multiple responses per prompt, keep ONLY the correct ones (rule-based rewards for code = execution). 600K verified reasoning samples built from this loop. | **Reject-sampling, not accept-sampling.** For each prompt generate multiple candidates, keep only the execution-passing fraction. |
| IBM verified-code-cot | Reasoning traces are grounded in ACTUAL execution traces (PySnooper instrumented variable states); rationales are verified by entity-matching against the real trace - rationales claiming values/control-flow that diverge from the trace are discarded. | **Reasoning claims must match executed reality.** If a trace narrates a variable value, that value must equal the executed value. No invented rationales. |
| KodCode / SelfCodeAlign / diverse-tasks-800K (ACL 2025) | question-reasoning-solution-test quadruplets; multi-candidate refinement (generate 3 candidate solution+test pairs, keep the first that passes, discard if none); genetic mutation for task diversity; multi-stage execution validation. | **Multi-candidate per problem.** First passing candidate wins; zero passing candidates = problem discarded. Genetic/crossover mutation of seeds is an approved diversity mechanism. |
| Dynamic Context Evolution (arXiv 2604.07147) | Cross-batch mode collapse is a named, measured phenomenon: naive prompting collapses diversity (5.6% collapse, 2-17 clusters); the fix is jointly (a) verbalized tail sampling (discard obvious/predictable candidates), (b) semantic memory (persistent embedding index rejects near-dups), (c) adaptive prompt evolution (each batch steers toward unexplored territory). Dedup-only or steering-only is insufficient - jointly they achieve 0% collapse. | **The uniqueness gate operates AT GENERATION, not after.** Semantic-memory + structural-sig + prompt steering every batch. This is the colony_teacher failure (same problem 1,290x) made impossible. |
| Lee et al. "Deduplicating Training Data Makes LMs Better" | Dedup layers: exact substring (suffix array, 50-token threshold) + near-dup (MinHash) + document-level; dedup cuts memorized output 10x. | **Dedup is multi-layer and post-staged too.** Exact, structural-sig, and (at scale) MinHash/suffix-array passes, recorded in a receipt. |
| Toloka frontier-lab survey (2026) | Frontier corpora are blends; code is 15-25% of high-performing mixes; mid-training with high-quality curated data has outsized leverage per dollar; decontamination against eval benchmarks is a release-blocking step. | **Our own traces are the high-leverage mid-training layer, not the whole corpus.** Decontaminate against known eval benchmarks before staging. |

## The Pipeline (mandatory order, every gate enforced)

### Stage 0 - Seed Discipline (the Phi lesson: seeds are everything)

A seed is the raw verified material a trace is built from (a verified stdlib function, a real project
pattern, an executed result). **No trace generation begins without a seed that passes:**

1. **Verified** - the seed's behavior is proven by execution we ran (real output attached), or it is a
   real artifact from a Grade A/B source in TRAINING_PIPELINE.md. Unverified seed = no lineage.
2. **Clean** - no placeholder slots, no template stubs, no `v:xxxx` ids, no scaffolding. (Waste list in
   `corpus-curation` applies.)
3. **Non-redundant** - structural-sig unique against the corpus index BEFORE use as a seed. A redundant
   seed propagates redundancy to its entire lineage.
4. **Grade A/B** per corpus-curation. Grade C is never a seed.

Record each seed in the corpus index (topic -> filename) as it is consumed.

### Stage 1 - Generation with Engineered Diversity

Never prompt a single template at scale. Per DCE + Phi-1 + KodCode, every batch applies ALL of:

1. **Topic taxonomy** - the batch is seeded from a planned topic list (Phi-1's 20K-topic lesson), not
   "generate more like the last one".
2. **Randomness injection** - random vocabulary/constraints woven into the prompt (Phi-1's trick) so the
   model cannot fall to the same most-probable paths.
3. **Verbalized tail sampling** - the generator self-labels how obvious/predictable each candidate is;
   predictable candidates (high self-estimated probability of being regenerated) are DISCARDED. The
   obvious is the enemy of the novel.
4. **Adaptive prompt evolution** - each batch's prompt is rebuilt from the semantic memory of what is
   already accepted, steering toward unexplored conceptual territory (the "deprivation" trick: tell the
   generator what must NOT be produced).
5. **Multi-candidate generation** - at least 3 candidates per problem (KodCode). The first that passes
   the full verification stack ships; if none pass, the problem is discarded, not patched.

Generation may be model-driven (teacher) or deterministic (mutation/rewrite of verified seeds via
structural operators), but in all cases the OUTPUT goes through the same verification gates. "Generate
by hand from an executed result" is also generation and also goes through the gates.

### Stage 2 - Execution-Grounded Verification (the Meta/DeepMind/IBM gauntlet)

Every trace, no exceptions:

1. **Parse** - AST-compiles. Terminal-style generator bugs (unterminated f-strings, `{1,3}` inside an
   f-string - both found in colony_teacher) are caught here.
2. **Execute** - the solution runs in a sandbox (stdlib only, no network, bounded time/memory).
3. **Tests pass** - the trace's own tests pass against the executed solution.
4. **Test quality gate** (AlphaCode lesson) - a test suite that only asserts `isinstance(...)` or
   `callable(sol)` or `result['x'] >= 0` is a FALSE-PASS suite. Test gate:
   - Assertions must pin concrete values (equality on real outputs, not type checks).
   - Edge cases present: empty input, single element, negatives, boundary, large N where meaningful.
   - Where feasible, tests are validated by **multi-solution consensus** (run >=2 independently-written
     correct solutions on each test input; unanimous output = sound test; disagreement = bad test).
   - Optionally generate extra tests by **input mutation** (AlphaCode) and validate them the same way.
5. **Reasoning-truth gate** (IBM lesson) - if the trace contains a reasoning narrative, every claimed
   value/step must match the executed reality (recompute from the actual run, or re-execute the snippet
   and compare). Invented rationales are the #1 hallucination vector; the narrative is checked against
   the execution, never against vibes.

### Stage 3 - Uniqueness Gate AT GENERATION (the zero-dup law made structural)

The DCE finding is non-negotiable: dedup-after-the-fact cannot recover lost diversity. Therefore:

1. **Semantic/structural memory** - every accepted trace's structural-sig (values normalized out,
   skeleton kept - per project `structural_sig` convention) is added to the corpus index.
2. **Pre-acceptance check** - a candidate whose structural-sig already exists (or whose embedding is
   near a stored one) is REJECTED and the generator is told to steer elsewhere. Value-substitution
   variants (same problem, different numbers) are structurally identical and are rejected by design.
3. **Collapse audit** - after every batch, compute unique/total ratio. If a single structural-sig
   exceeded ~5-10 candidates in the batch, the generation strategy for that topic is wrong (not enough
   steering). A batch whose unique ratio falls below 80% is a failed batch and is re-run with different
   steering, not force-accepted.

### Stage 4 - Post-Stage Dedup + Receipt (defense in depth)

After staging, run the layered dedup (Lee et al.):
1. Exact hash (document level).
2. Structural-sig (project convention - collapsed ferrell 32,807 -> 20,434 and colony_teacher
   92,052 -> 7,663; it is the correct tool for template/value-substitution corpora).
3. At scale: MinHash LSH (near-dup) then suffix-array substring dedup (50-token threshold, drop
   documents losing >80% content).
Write a dedup RECEIPT (input count, per-layer collapse, survivor count, token count) to the manifest.

### Stage 5 - Decontamination + Staging

- Remove traces overlapping known eval benchmarks (8-gram overlap + structural-sig vs benchmark
  problems) - release-blocking per Toloka survey. The corpora we generate are also eval material; keep
  a held-out verified set for closed-loop evaluation.
- Stage only complete traces: problem + solution + tests + (where present) execution-grounded
  reasoning, as one self-contained unit, in the byte-exact gold-doc format.
- Record mix placement: our own traces are the high-leverage mid-training / reasoning layer of the
  corpus, never the entire corpus (mix budget per `synthetic-data-pipeline`).

## Quality Bar (the bar is set by execution, not by tone)

A trace is shippable IFF:
- [ ] Its seed was verified + non-redundant before generation.
- [ ] Its solution parses AND executes in the sandbox.
- [ ] Its tests pass AND the tests pin concrete values / cover edges (not type-check-only).
- [ ] Its tests were validated by multi-solution consensus where feasible.
- [ ] Its reasoning narrative, if any, matches the executed reality.
- [ ] Its structural-sig was unique at generation time AND survived post-stage dedup.
- [ ] It is decontaminated against eval benchmarks.
- [ ] It carries a measured token count and a manifest entry with source lineage.

Any trace failing any gate is dropped or sent back through generation with corrective steering. There is
no "ship it anyway". This is the highest-quality bar in the program, matching the
zero-dup-high-quality directive: when any other instruction conflicts, quality and uniqueness win.

## Failure Modes (each observed or documented - do not repeat them)

1. **Value-substitution repetition** (OBSERVED in colony_teacher: 100K -> 9,735 unique; sinusoidal-PE
   repeated 1,183x). Cause: no uniqueness gate at generation, single-template prompting. Fix: Stage 1
   diversity stack + Stage 3 pre-acceptance gate.
2. **Weak false-pass tests** (OBSERVED: `isinstance(...)`, `callable(sol)`, `>= 0` asserts). Cause:
   no test-quality gate. Fix: Stage 2 gate 4 (concrete assertions + edge cases + consensus).
3. **Generator bugs shipped as data** (OBSERVED: terminal domain unterminated f-string, `{1,3}` in
   f-string). Cause: no parse gate before shipping. Fix: Stage 2 gate 1 catches at parse time.
4. **Invented reasoning** (documented failure in dual_mind_distill: relabeled fake SHELDON/SPOCK).
   Cause: reasoning written without execution grounding. Fix: Stage 2 gate 5 - narrative must match
   executed values.
5. **Seed poisoning** (Phi-4 documented: minor seed errors -> severe derived-doc degradation). Cause:
   skipping Stage 0. Fix: seed gate is mandatory, always.

## Triggers

- When "use HuggingFace traces" / "use dataset X" is proposed as the primary code source.
- When creating ANY new coding trace (problem+solution+test triple) for the corpus, by any generator.
- When expanding or re-generating a synthetic trace family.
- When auditing an existing synthetic corpus (run Stages 2-4 over it).

## Discipline

- Every seed consumed, every batch generated, every trace shipped is logged in AGENT_NOTES with the
  skill name.
- Every claim in a trace traces to an executed run (this machine) or a Grade A/B verified artifact.
- The uniqueness gate runs at generation time, not after the fact.
- This skill's bars (Stage 2-3) are enforced BEFORE the per-doc 5-gate pipeline of
  kd-corpus-production takes over for final staging.
