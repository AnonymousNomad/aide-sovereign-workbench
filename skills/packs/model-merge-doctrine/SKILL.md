# Skill: model-merge-doctrine

# Model Merging Doctrine — preconditions, methods, validation, and when NOT to merge

## THE FUNDAMENTAL LAW (violating this = silent catastrophic failure)

**All models being merged MUST be fine-tuned descendants of ONE shared base model.**
Not similar size. Not similar architecture. Not compatible shapes. *Same lineage.*

- Merging algorithms (SLERP / TIES / DARE / task-arithmetic / linear) operate on
  **task vectors** — weight DIFFERENCES from the shared base. No shared base =
  no task vectors = you're interpolating through regions of weight space where no
  network was ever trained.
- Measured symptom of violation: **the model still runs but produces degraded or
  incoherent output** ("mode collapse", UNK soup, word salad). It fails silently —
  this is the most dangerous failure class because nothing errors.
- Direct quote (Neural Base course, verified 2026-04): *"if specialist A was
  finetuned from Llama 3.1 and specialist B from Llama 3.2, merging them using
  either as base causes catastrophic performance degradation (mode collapse), not
  just suboptimal results."*
- CASE STUDY (this project, 2026-08-23): Kimi K2.6 × DeepSeek V3.1 merge ("Kira-
  14e") — different labs, different tokenizers (tiktoken 163840 vs DeepSeek vocab),
  different MLA configs. Official-converter GGUF produced word-salad through
  llama.cpp AND the underlying weights were never coherent. LoRA fine-tune loss
  falling afterwards MASKED the incoherence (memorization ≠ coherence).

## PRE-MERGE CHECKLIST (all must pass before any weight math)

1. **Lineage**: every input model's card/training provenance confirms descent from
   the SAME base checkpoint (same family AND same init — Llama-3.1 vs 3.2 already
   violates).
2. **Architecture**: identical arch class, layer count, hidden dims, head config,
   attention type (MLA vs MHA vs GQA must match), RoPE scheme, norm type.
3. **Shapes**: every corresponding tensor shape equal (verify via state-dict keys,
   not parameter counts — matching counts prove nothing).
4. **Tokenizer policy decided explicitly**: identical vocabs → use base policy;
   different-but-related vocabs → mergekit `union` with fallback embeddings +
   targeted eval of added-token prompts; unrelated token spaces → DO NOT MERGE.
5. **Chat template**: one template chosen for output; verify special tokens map to
   real embedding rows.
6. **Count discipline**: ≤8 specialists per merge (drift compounds beyond that).

## METHOD MATRIX (from mergekit docs + Ilharco/TIES/DARE papers)

| Method | Inputs | Base needed | Use when |
|---|---|---|---|
| Linear / Model Soup | ≥2 | optional | averaging checkpoints of same run/family |
| Task Arithmetic | ≥2 | ✓ | scaling task vectors (λ 0–1 start) |
| SLERP | exactly 2 | ✓ | smooth pairwise blend, two specialists |
| TIES | ≥2 | ✓ | conflicting updates; sign-consensus resolves interference |
| DARE (linear/ties) | ≥2 | ✓ | sparsify-then-merge; robust skill retention |
| DELLA | ≥2 | ✓ | DARE + TIES refinement |

Beginner-safe: linear, nuslerp, task_arithmetic. Advanced: ties, dare_ties, della.
There is no universal best — evaluate candidates on YOUR battery.

## POST-MERGE VALIDATION BATTERY (a merge is a candidate, not a result)

1. Perplexity vs each source model on held-out text (merged should be within noise
   of best source; worse-than-every-source = interference/lineage failure).
2. Coherence battery: story generation, instruction compliance, code-gen executed
   via verify_harness (UNK scan mandatory).
3. Capability retention: each specialist's home task tested — did its skill survive?
4. Calibration spot-check on confidence probes.
Failure triage table:
| Symptom | Likely cause | Fix |
|---|---|---|
| Incoherent/random tokens immediately | tokenizer/output-space mismatch or lineage violation | verify lineage + vocab policy; likely REJECT merge |
| Repetitive loops | coefficient overload | reduce λ/density into 0.0–1.0, re-eval |
| Worse than every source | source interference or incompatible lineage | check lineage first |
| One capability vanished | density too sparse / sign conflict ate it | retune density, or drop that source |

## HEALING A BROKEN MERGE — the honest truth

Research offers NO cheap fix for a lineage-violating merge:
- Continued pretraining to "re-align" embeddings = retraining the model at corpus
  scale (weeks+); you've destroyed the reason you merged instead of trained.
- Git Re-Basin alignment exists in research for studied architectures; it is NOT a
  generic repair for cross-lab MoE merges.
- Verdict rule: if post-merge battery fails coherence at the BASE level, the merge
  is rejected — do not ship, do not fine-tune on top (fine-tuning memorizes around
  brokenness and hides it). Document and restart from a valid design.

## THE CORRECT WAY TO GET "MERGED CAPABILITIES"

You cannot merge across lineages — but you CAN get multi-domain capability:
1. Pick ONE strong base appropriate to deployment hardware.
2. Fine-tune N specialists FROM that base (same init!): e.g., aide-workflow,
   fact-check/journalism, debugging loops.
3. Merge the specialists back with TIES/DARE (they share the base — lawful).
4. Battery-validate each capability survived.
This achieves Kimi×DeepSeek-style breadth lawfully: breadth comes from DATA during
fine-tuning, depth from the single base.

## THREAT MATRIX

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cross-lineage merge attempted | HIGH (seductive idea) | FATAL-silent | Pre-merge checklist Law 0; reject before math |
| Tokenizer drift after union | MEDIUM | high | added-token prompt tests post-merge |
| Merge hides behind later fine-tune | HIGH (measured here) | wasted weeks | Law 2 of aide-frontier-model: battery BEFORE ft |
| Density/coefficient mis-tuning | MEDIUM | degraded | sweep 0.0–1.0 λ; evals between sweeps |
| >8 specialists compounding drift | LOW | degraded | cap count |

## DEPENDENCIES
mergekit (arcee-ai) for lawful merges; llama.cpp converter @ runtime commit;
verify_harness.py; the standard coherence battery (UTF-8 file capture).

## WHEN DONE
Merge receipt: lineage proof for every input, method+density/λ params, battery
scores for merged vs every source, sha256 of artifact. No receipt = not shipped.
