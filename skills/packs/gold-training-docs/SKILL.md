---
name: gold-training-docs
description: Generate gold-standard training documents (KD docs) for the trek language-model pretraining corpus, based on Big Tech proven data practices (Phi-1 textbook quality, LIMA curation, Orca-2 multi-strategy reasoning, Google active learning). Use when writing any new training document, building corpus batches, or creating doc templates for the queen-bee-v5 corpus.
---

# Gold Training Docs — Big Tech Data Practices Applied

These are the rules for producing every training document in the trek corpus. Every doc is an executable, verified artifact — never a generator, never a strip, never filler. One doc = one harness section written + run + observed + delivered with real numbers.

> **NOTE (2026-08-04):** The general, research-backed methodology now lives in the `kd-corpus-production` skill (professional KD + training-data practice: Orca triple format, 5-gate quality pipeline, distillation rules, book-organization). This skill is the trek-project-specific application of that research. When generating docs, follow BOTH this skill (trek format/naming/domains) AND `kd-corpus-production` (research gates and distillation discipline).

## Research Basis (must shape every doc)

| Source | Proven Principle | Applied as |
|---|---|---|
| Phi-1 — "Textbooks Are All You Need" (Microsoft, 2023) | Textbook-quality data beats raw web; 1.3B + 6B textbook tokens → 50.6% HumanEval; 350M small → 45% | Every doc is textbook-grade: full worked example, single topic, explained through code + observe |
| LIMA (Meta, arxiv 2305.11206) | 1,000 curated examples (~750K tokens) outperform 65K uncurated; style + format carry the supervision | Consistent byte-exact format across ALL docs; curation before volume |
| Orca-2 (Microsoft, 2023) | Teach MULTIPLE reasoning strategies (step-by-step, recall-then-generate, recall-reason-generate, direct answer) instead of pure imitation; rich explanation traces | Dual-mind block is mandatory: Spock (step-by-step induction) + Sheldon (lateral/algorithmic cross-check); synthesize both in the synthesis block |
| Google Research (Aug 2025) | High-fidelity labels / active learning → 10000x data reduction; verification quality is the lever | Every doc's numbers come from an actual executed run — never estimated |

## Mandatory Doc Format (byte-exact, in this order)

```
<task>Write a training document on TOPIC. Write the document. Not a generator, a complete executable example.</task>
<guidelines>
SOP: TOPIC_X_V1
Preconditions: ...
1. ... (numbered checklist with exact expected outcomes)
2. ...
Verification gate: [ ] PASS — all checklist items observed
</guidelines>
<check>
Topics covered: ...
Depth: L2 (or L1 only if the topic is genuinely surface-level)
</check>
<mind_spock>
- Step-by-step analysis: ...
</mind_spock>
<mind_sheldon>
- Cross-check: ... (independent re-derivation or adversarial probe)
</mind_sheldon>
<code>
...complete runnable code, stdlib only...
</code>
<execute>
(paste the real run results here)
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
- Tokens: ~N (measured)
- Level: 2
</deliver>
```

## The 10 Non-Negotiable Rules

1. **Execute, then write.** The harness section is written and RUN BEFORE the doc is written. Paste real outputs into the execute/observe blocks. Never invent a number.
2. **No generators.** Never write a doc that says "imagine", "for example your code would...", or ships template code without real output. The doc IS the real example.
3. **No strips / no filler.** No filler text, no repeated boilerplate, no padded sections, no emoji. Every line teaches.
4. **Single topic per doc.** One doc teaches one mechanism deeply (e.g. binary search trees OR HMAC CSRF tokens, never both). Depth over breadth (Phi-1).
5. **Byte-exact format.** The exact tag structure above, every doc, every time. Format consistency IS the LIMA style supervision.
6. **Dual-mind reasoning.** Both blocks mandatory. Spock = induction, decomposition, trace. Sheldon = independent cross-check, edge cases, adversarial probes. Synthesis must resolve both.
7. **Stdlib only.** The harness runs on venv_trek python with only the standard library. If a topic needs a package, write the mechanism from scratch instead.
8. **Measured verification.** Every claim in the deliver block (tokens, timings, sizes) comes from the execute block. If the harness prints it, it's evidence.
9. **Level-2 by default.** Filenames must NOT contain L1 keywords: code, debug, ops, project, software, cyber, security, nlp_, engineering, ai, ml, gen. The classify rules say "cs_concepts" is L1-adjacent — prefer cipher/site/trade/phys domains (see precedent: bytecode→interp).
10. **Corpus discipline.** Docs go to `E:\queen-bee-v5\training_curated\` staging only AFTER verification; AGENT_NOTES updated per batch (each batch = 5 docs + harness run + note entry). Never put an unverified doc in the corpus.

## The 5-Gate Quality Pipeline (kd-corpus-production research, applied)

Every doc must clear all five gates before staging. This is the sub-1B professional practice (Ertas/DataMan/NeurIPS-2025):

1. **Length & scope** — one self-contained unit; single topic; complete worked example; target 2-5K tokens.
2. **Complexity** — learnable by the 16M-40M student; no unexplained jumps; step-by-step where possible (teacher-is-ceiling: if the student can't hold it, compress it).
3. **Verification** — every number from an actual executed run; never invented.
4. **Format** — byte-exact doc format, zero drift (one bad example = a 5% failure mode at small scale).
5. **Dedup/originality** — check the corpus index first; no near-duplicate of an existing doc; vary topic seed + angle (Cosmopedia diversity).


## Harness Protocol

- Harness lives at `E:\pip_temp\opencode\kd_tests.py`; each batch appends sections 21-25 etc. New batch code goes in `kd_tests_batchN.py` (write tool), then appended with Add-Content to keep the main file intact.
- Run with: `E:\felon_workspace\venv_trek\Scripts\python.exe -u E:\pip_temp\opencode\kd_tests.py` and ALWAYS prefix `$env:PYTHONIOENCODING='utf-8'` in the same shell (Windows cp1252 crashes on ufffd otherwise).
- Fix bugs until every section prints PASS; then write the docs from the observed numbers.
- Keep measured facts for docs: exact outputs, timings (e.g. `0.465s for 100k inserts`), sizes, byte counts, complexity evidence.

## Naming & Domain Conventions

- Domains used so far: cipher (data structures/algorithms), site (web/backend mechanisms), physics, trade. Pick new domains per batch.
- File: `gold_<domain>_<topic>_NN.txt` (NN = 01, 02, ...).
- Classify check: run the repo's classify on the finished doc and fix violations before writing the next doc.

## When to Trigger

- Writing ANY new training doc or doc batch
- Auditing corpus docs for quality
- Designing new harness sections

## Reference the skill from AGENT_NOTES

Every batch entry in AGENT_NOTES.md must name this skill as the governing process (e.g. `via skill: gold-training-docs`).
