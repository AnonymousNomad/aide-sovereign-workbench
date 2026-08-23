---
name: web-builder-model-frontier
description: Research-grounded doctrine for building the #1 model for beautiful, novel, unique websites and Shopify websites (frontend + backend) with NLP. Use for EVERY decision on the web-builder model — data, architecture, training, evaluation, Shopify integration, capability boundaries, and release framing. Codifies what Big Tech research actually prescribes: specialize instead of scale, make data diversity the gate, benchmark on real interactive tasks, validate Shopify capabilities per-capability, and report honest capability boundaries.
---

# Web Builder Model Frontier

Sources (primary): Hugging Face + Dharma-AI "Specialization Beats Scale" (2025),
McGill-NLP WebLINX (EMNLP 2023 Findings), Toloka frontier-lab pretraining-data
research (2024/25), Shopify Dev MCP (Model Context Protocol server, 2025),
frontier-lab web-corpus practice (FineWeb / dedup / DSIR), and this project's own
measured evidence (novelty ceiling probe, gate matrix, coherence probe).

## The Verdicts (what Big Tech says)

1. **Specialize, do not scale.** HF/Dharma-AI: a 3B-parameter specialist model
   outperformed every frontier generalist API on real web tasks, at ~52x lower
   inference cost per million pages, with the lowest text-degeneration rate
   (0.20% vs 25-33% for frontier models). The mission — a small, focused,
   from-scratch web-builder model — is the strategy the research endorses.
   Size is not the weapon. Capability coverage + data curation + honest framing are.

2. **Data diversity and quality are the gate, not parameter count.** Toloka's
   survey of frontier-lab pretraining corpora shows six categories working in
   every frontier blend: public web text (e.g. FineWeb), books, academic/scientific
   text, code, synthetic, and **human-generated specialized data**. Frontier labs
   converge on curated diversity + aggressive dedup, not raw scale.
   **Direct lesson (measured in this project):** the model's designs are only as
   diverse as its corpus. The reference DB had 5 degenerate specs (1 grid, 1 column,
   1 visual language); the novelty ceiling that data imposed (~0.40 observed vs
   0.50 floor) was a data artifact. A novel/unique output REQUIRES a diverse
   design-space corpus. Build the design-space-expansion batch BEFORE spending
   GPU on a creative LoRA.

3. **Benchmark in the real interactive environment, not offline.** WebLINX
   evaluates conversational web-navigation agents against live sites, multi-turn,
   with human-style instruction — because offline/static checks reward the wrong
   thing. For this model: gate on real briefs → real spec → parse → render →
   inspect, and on the full held-out brief set, not n=8 samples.

4. **Shopify capability = per-capability engineering with validation loops.**
   Shopify's own Dev MCP pattern: scoped tools, gradual context injection, and
   "the model proposes, the server disposes" — every capability gets its own
   retrieve-docs → generate → **validate** loop. There is no blanket "Shopify
   works." Each Shopify capability (storefront, products, collections, theme
   files) is verified independently before it is claimed.

5. **Curated, verified data beats raw web data.** Specialization-Beats-Scale's
   specialist was built on curated, verified instruction data. Do not paste
   scraped websites into the corpus. Every training doc passes the 5-gate KD
   pipeline; every synthetic spec is parsed, AST-verified, and scored before it
   enters training (anti-trash-data-doctrine + closed-loop verification).

## The Build Doctrine (follow in this order)

1. **Data first.** Diversity of the design space is the number-one lever:
   kinds × grids × columns × visual languages × section vocabularies × palettes.
   Audit the corpus with the novelty formula (design_db.novelty_score) and do not
   train a creative LoRA until a sample fraction scores ≥0.50 against the
   reference DB.
2. **Capability boundaries are the product.** v1 = frontend web-spec generator
   (proven: web_spec gate 5/5, format 1.0). v2 = full-stack Python generation.
   Python code-gen (py_parse 0/4) is a DOCUMENTED limitation, not a hidden one.
3. **Per-capability validation loops.** For each claimed capability: build the
   test battery, measure the number, record it, and only then claim it.
4. **Novelty and uniqueness are measurable requirements.** Use the structural
   distance formula (grids, columns, visual languages, sections, palettes). Novel
   ≠ random — it must still parse, render, and match the brief.
5. **Honest public framing.** The model is a web-design-spec generator, not a
   general chat model (proven by coherence probe: free-form NLP prompts fail,
   structured briefs produce valid specs). Release numbers are the measured
   numbers, limitations included. Public docs describe the architecture and the
   verified capability list — no contest/money/"beat" language ever.

## The Loop (every task, in order)

1. Research the task from primary sources before touching code.
2. Build the data/training/code change.
3. Verify with the REAL test battery (verification-complete skill), never smoke tests.
4. Record the measured evidence in AGENT_NOTES.
5. Report observations, not expectations.
