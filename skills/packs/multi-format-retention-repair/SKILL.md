---
name: multi-format-retention-repair
description: Repair a model that emits multiple output formats or task families without improving one format by regressing another. Use whenever web, code, envelope, safety, or instruction-format repair changes shared decoder behavior.
---

# Multi-Format Retention Repair

## Problem

A shared small decoder can improve one target while destroying another. Pair-count
ratios are not enough: prompt masking, completion lengths, gradient magnitude,
stateful modules, and task difficulty determine the actual update mix. A repair
checkpoint is never promotable because one category rose.

## Non-Negotiable Gates

1. Freeze the parent checkpoint and evaluate every format on the same fixed suite.
2. Run the `train-serve-consistency` battery before interpreting a repair loss.
3. Account for **completion tokens by format**, not just number of examples.
4. Use verified retention examples only; polluted replay is not retention data.
5. Evaluate per-format acceptance, strictness, semantic score, safety, and unrelated
   regressions at every probe checkpoint.
6. One repair attempt is one controlled pass. Two failed attempts on the same gap
   trigger a capacity/data or routing decision, not more epochs or LR guesses.
7. Never promote a checkpoint unless every protected metric is at least the parent
   baseline and the target category improves by a measured margin.

## Diagnosis Order

1. **Harness integrity:** verify decode flags, prompt wrapping, EOS handling, held-out
   selection, and category stratification.
2. **State integrity:** batch invariance, train/eval parity, cache/no-cache parity,
   per-request memory reset, and dead-gradient audit.
3. **Baseline:** measure `(strict, parseable, semantic, SOP, human-safety, tokens)`
   per format and per kind on a fixed seed.
4. **Mix accounting:** print examples, completion tokens, loss-mask tokens, and
   effective sampling share for each format.
5. **Route choice:** choose a task-balanced sampler, explicit loss weights, a
   sequential retention phase, a separate head/adapter, or a capacity decision.

## Repair Routes

### Task-balanced single pass

Use when all formats are learnable in the current capacity. Construct batches with
an explicit format composition, weight each masked completion loss by the desired
token share, and keep the total to one pass. Random row sampling is insufficient.

### Sequential retention phase

Use only after a target repair has passed its target-category probe. Run a short,
separately measured retention phase on clean format anchors, then re-check the
target category. If retention restores format but erases the target, the shared
capacity is insufficient for this route.

### Task-conditional head or adapter

Use when the same shared decoder repeatedly trades format A for format B despite
clean data, fixed state, balanced tokens, and protected gates. The routing signal
must be explicit and present at training and serving. Prove train/serve parity and
batch invariance before training a new lineage.

### Capacity/data decision

Use after two failed controlled attempts on the same gap. Increase verified data
diversity, reduce claimed task scope, or increase capacity; do not hide the tradeoff
with a lower threshold.

## Required Manifest Fields

Every repair manifest records:

- parent checkpoint and forward-code version;
- format/kind label for every pair;
- prompt tokens, completion tokens, loss-mask tokens, and total tokens;
- verifier and exact pass result;
- target-category reason and retention-category reason;
- sampling/weighting policy;
- fixed eval seed, suite version, and per-category baseline;
- promotion decision and all protected metrics.

## Current Web-Builder Application

The web-builder has two output families: free-form web specs and envelope docs.
The clean b4 web repair improved human-safe acceptance but shared updates reduced
envelope strictness. The next experiment must use explicit task balancing or a
task-conditional route; another unweighted distill epoch is forbidden until the
token mix and retention policy are implemented and independently audited.
