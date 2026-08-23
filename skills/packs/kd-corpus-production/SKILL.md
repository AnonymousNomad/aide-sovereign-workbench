---
name: kd-corpus-production
description: Professional knowledge-distillation corpus production for small language models. Use when generating training documents, building KD datasets, synthesizing teacher-to-student training data, auditing corpus quality, or designing distillation pipelines — for any project training a small model (sub-1B) from a stronger teacher (LLM or self). Grounded in research: Phi-1/Phi-1.5 textbook quality, LIMA curation, Orca/Orca-2 multi-strategy reasoning, Cosmopedia diversity, DataMan quality criteria, pre-training distillation design space (ACL 2025), book-level synthetic textbooks (NeurIPS 2025), and sub-1B synthetic-data practice.
---

# KD Corpus Production — Professional Distillation & Training-Data Practice

The defining idea of this research-backed practice: **for small models, data quality and format are the entire strategy.** A small student (sub-1B) has near-zero tolerance for noisy, misaligned, or inconsistent data. 20K perfect examples beat 100K noisy ones by 20-30 accuracy points (Ertas practice), 1,000 curated examples beat 65K uncurated (LIMA), and textbook-quality synthetic data lets a 1.3B model match 10x-larger web-trained models (Phi-1.5).

## Research Foundations (what professionals actually do)

| Source | Proven Principle | Applied As |
|---|---|---|
| Phi-1 / Phi-1.5 (Microsoft, 2023) | Textbook-quality synthetic data beats raw web data; "exercises and answers" format; data construction needs iteration + topic selection + knowledge-gap awareness | Every doc is a complete worked exercise with real, verified output; docs are seeded from a planned topic taxonomy |
| LIMA (Meta, 2023) | 1,000 curated examples outperform 65K uncurated; style + format carry the supervision | Byte-exact format across ALL docs; curation before volume |
| Orca / Orca-2 (Microsoft, 2023) | Teach multiple reasoning strategies (step-by-step, recall-then-generate, extract-generate, direct answer); explanation traces and rationales are the key signal | Docs contain explicit multi-path reasoning (dual-mind): a step-by-step path + an independent cross-check path, merged in synthesis |
| Orca-AgentInstruct (Microsoft, 2024) | Agentic flows (transform → generate → refine) beat single-shot generation; reflection + tools raise data quality above the generator's own ceiling | Every doc goes through generate → verify-by-execution → self-critique → refine before delivery |
| Cosmopedia (HF, 2024) | Diversity comes from topic-seeded prompts + audience/style variation; duplicates waste compute; model collapse from self-training is real | Batch topics planned for coverage; audience/style variety; never feed model's own incoherent output back into its training set |
| DataMan (Qwen/Alibaba, 2025) | 14 complementary quality criteria derived from PPL anomalies; pointwise rating; criteria correlate weakly with PPL — check multiple axes | Every doc scored on: factual correctness, structure, depth, executability, clarity, originality |
| Pre-training Distillation (ACL 2025) | KL ≈ NLL >> MSE for distillation loss; capacity gap matters (bigger teacher not always better); WSD schedule for KD-loss ratio | Teacher output must be **learnable** by the student — verified via complexity scoring |
| Book-level synthetic textbooks (NeurIPS 2025) | Organization beats rewriting: hierarchical structure + planned adjacency in a single doc outperforms split or concatenated docs | Docs are coherent, self-contained units with ordered internal structure; related docs planned as a series |
| Sub-1B distillation practice (2026) | Filtering pipeline decides the outcome: length-match, complexity-score, domain-relevance, dedup, format-validate; 100K→20K examples = +20-30pts | Every doc passes a 5-gate quality pipeline before entering the corpus |
| FKL/RKL temperature (2026) | At τ=1 RKL wins; higher τ (2.5-3.5) flips it to FKL; temperature exposes dark knowledge | Generation temperature and sampling tuned per doc type; never default blindly |

## The 5-Gate Quality Pipeline (mandatory for every doc)

Each doc MUST pass all five gates before it can be staged to the corpus. This is the sub-1B filtering practice, applied per-document.

1. **Length & scope gate** — Doc must be one self-contained unit: single topic, full worked example, complete. Not a fragment, not a generator, not a strip. Target length band recorded and matched (per-corpus, e.g. 2-5K tokens).
2. **Complexity gate** — Content must be learnable by the target student. If a mechanism can be shown with a small worked example, use the small one. No unexplained jumps. Step-by-step where possible.
3. **Verification gate** — Every number, output, and claim in the doc comes from an ACTUAL executed run. Code docs: the execute block is real output. Math/stat docs: the observed values are measured, never invented. If it cannot be verified, it does not ship.
4. **Format gate** — Byte-exact document format (below), every doc, every time. Zero tolerance for format drift at small scale (Ertas: one inconsistent example can create a 5% production failure mode).
5. **Dedup/originality gate** — Doc teaches something not already covered by an existing doc in the corpus. Check the corpus index first. Near-duplicates are harmful at small scale (they over-represent patterns).

## Canonical Document Format (Orca-triple + Book-organization)

Each doc is an `<task, context, response>` triple in the Orca style, organized as a coherent book section. Order is fixed and byte-exact.

```
<task>
Write a training document on TOPIC. Write the document. Not a generator, a complete executable example.
</task>

<guidelines>
SOP: DOMAIN_TOPIC_V1
Preconditions: (what must hold before the example runs)
1. ... (numbered checklist, exact expected outcomes)
2. ...
Verification gate: [ ] PASS — all checklist items observed
</guidelines>

<check>
Topics covered: (one line)
Depth: L2
</check>

<mind_spock>
- Step-by-step analysis: (the inductive, decomposed reasoning path)
</mind_spock>

<mind_sheldon>
- Cross-check: (independent re-derivation, edge cases, adversarial probe)
</mind_sheldon>

<code>
(complete runnable code, standard library only)
</code>

<execute>
(paste the real run results here — never invented)
</execute>

<observe>
- Observation 1 (with measured value)
- Observation 2 ...
</observe>

<mind_synthesis>
- (merge Spock + Sheldon into the final understanding)
</mind_synthesis>

<deliver>
- File: gold_<domain>_<topic>_NN.txt
- Tokens: ~N (measured, not estimated)
- Level: 2
</deliver>
```

### Why this format (research mapping)
- **`<task>` + `<guidelines>` + `<check>`** = the Orca system message / user query: it teaches the student how to respond to a directive with a known procedure.
- **`<mind_spock>` / `<mind_sheldon>` / `<mind_synthesis>`** = Orca-2's multi-strategy reasoning (step-by-step vs recall-reason-generate) + the rationale signal that makes KD 2x data-efficient (Lion).
- **`<code>` + `<execute>`** = Phi-1's "exercises and answers": the code is the exercise, the executed output is the answer. Executors are the strongest grounding against hallucination (synthetic-data survey).
- **`<observe>`** = the measurable facts the student must retain.
- **Book-organization principle**: the internal order (task → how → do → observe → conclude) is a planned adjacency — content is introduced, used, then concluded in one continuous document. Do not split related content across docs without reason.

## Distillation-Specific Rules (when generating from a teacher)

1. **Teacher is the ceiling, but bigger is not always better.** Teacher output must be learnable by the student. If you (teacher) produce output the 16M-40M student cannot possibly reproduce, it is bad data for it — compress the reasoning to what the student can hold.
2. **Always include rationales.** Step-by-step solutions are the single highest-leverage content feature for small students. Final-answer-only docs are weak.
3. **Progressive complexity (Orca).** Easier docs/mechanics precede harder ones in the corpus and in the curriculum. A doc at the student's current edge (Phi's "deep understanding of knowledge gaps") beats a doc far beyond it.
4. **Diversity by topic-seeding, not repetition.** Vary the topic seed, audience, and angle between docs (Cosmopedia zero-shot-topic finding). Two docs teaching the same mechanism from the same angle are one doc's worth of learning.
5. **Never feed the model its own incoherent output.** If the model cannot generate parseable/coherent text yet, do NOT include its generations in its training data (STaR self-poisoning). Only verified teacher output ships.
6. **Verify with executors, not vibes.** Code → run it. Math → recompute it. Claims → measure them. Verification quality is the lever that gave Google 10000x data reduction (active learning).
7. **Multi-strategy reasoning = separate generation passes, never relabeling.** A dual-mind doc (`<mind_spock>` step-by-step + `<mind_sheldon>` cross-check) is only genuine when the two blocks come from *distinct* generation passes (e.g. first pass = reasoning, second pass = independent verify/refute). Splitting one text by keywords and labeling the buckets "SHELDON/SPOCK" is fake distillation (documented failure: `dual_mind_distill.py` produced `</<mind_sheldon>>` and relabeled lines). Use the teacher's own second-pass verification (see `kd_batch_tracegen.py --cross-check`).
8. **When feeding a trace back to a teacher (self-verification), the runtime context must exceed the trace length.** llama-cli defaults to 512 tokens context; long traces were silently truncated and the teacher reasoned about input it never saw. Pass `-c <ctx>` explicitly.

## Corpus Discipline

- Every batch = N planned topics (coverage check) + N harness sections run + N docs written from observed numbers + AGENT_NOTES entry.
- Docs stage to `training_curated\` ONLY after all 5 gates pass.
- Reference this skill by name in AGENT_NOTES for every batch.
- Keep a corpus index (topic → filename) to enforce the dedup gate.

## When to Trigger

- Writing ANY new training document or doc batch (for any small-model project)
- Auditing/cleaning an existing corpus (run the 5 gates over existing docs)
- Designing a KD / synthetic-data pipeline (teacher selection, generation, filtering)
- Deciding whether model-generated output belongs in the training set
