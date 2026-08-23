# Skill: multi-format-interference-repair

Professional playbook for adding capability A to a shared small decoder without
destroying capability B, after clean-data and balanced-token routes have failed.
Extends `multi-format-retention-repair` (which governs schedule/data routes);
use this skill when that skill's two-failed-attempt rule triggers.

## When to use

- Two or more controlled schedule/data retention attempts on the same
  format-vs-format gap have failed (protected metric regresses whenever the
  target metric improves).
- Symptom signature: per-checkpoint metrics see-saw; balanced sampling and
  verified retention data still trade; the shared decoder is the bottleneck.
- FSI-FELON history: 8 controlled attempts on the web-human-safe vs envelope
  gap all rejected (through repair_web_b5_bal30_5e-6_v2, 2026-08-12).

## Evidence base (fetched and verified 2026-08-12)

- LoRA: Low-Rank Adaptation of Large Language Models (Hu et al., Microsoft,
  2021; arXiv 2106.09685): freeze base W, train low-rank delta BA on selected
  matrices; 10,000x fewer trainable params; mergeable at deploy (zero extra
  inference latency); adapters swappable per task on one frozen base.
- PEFT blog (Hugging Face, 2023) + Beyond LoRA benchmark (Hugging Face,
  2026-06-18): PEFT "overcomes the issues of catastrophic forgetting"; LoRA is
  98.4% of PEFT usage; same base can serve many fine-tunes; method-comparison
  benchmarks track forgetting/drift as a first-class metric.
- LoRA Learns Less and Forgets Less (Biderman et al., Databricks Mosaic, 2024;
  arXiv 2405.09673): in instruction-finetuning regimes LoRA substantially
  preserves base-model capability vs full FT; forgets less than weight decay or
  dropout; high rank (r=256) + alpha=2r can match full FT on IFT; target ALL
  modules (MLP drives most gains); LoRA best LR is ~10x full-FT LR (5e-5..5e-4
  for their setups); LR sweep is crucial.
- TGI Multi-LoRA serving (Hugging Face, 2024): production pattern — one base
  deployment, many adapters, request carries adapter_id, system selects the
  adapter per request; ~1% VRAM overhead per adapter. This is the
  task-conditional routing pattern already sanctioned by
  multi-format-retention-repair, realized with no decoder surgery.
- Gradient Surgery / PCGrad (Yu et al., Stanford/Berkeley/Google, NeurIPS
  2020; arXiv 2001.06782): when task gradients conflict (negative cosine),
  project each onto the normal plane of the other before applying;
  model-agnostic; targets the "tragic triad" (conflict + magnitude dominance +
  high curvature) that matches our measured see-saw; combinable with any
  optimizer and with architectural routes.
- Overcoming catastrophic forgetting / EWC (Kirkpatrick et al., DeepMind, 2017;
  arXiv 1612.00796): Fisher-weighted quadratic penalty anchoring each weight to
  its parent value in proportion to importance for the old task; protects old
  capability while new learning proceeds elsewhere; linear compute cost.
- Task arithmetic (Ilharco et al., UW/Microsoft/AI2, 2022; arXiv 2212.04089)
  and Model soups (Wortsman et al., UW/Google, ICML 2022; arXiv 2203.05482):
  fine-tune weight deltas from a shared init are near-orthogonal across tasks
  and additive/interpolable; greedy weight averaging beats the best single
  fine-tune with zero inference cost.

## Route ladder (ranked for our situation)

### 1. Format-conditional LoRA adapters (PRIMARY recommendation)

Freeze the parent checkpoint entirely. Train one small LoRA per format that
needs repair (e.g., web-human-safe repair LoRA); the parent itself remains the
envelope-format authority. At serve time, select the adapter by the
request-type signal that already exists in the pipeline (web design brief ->
base+web-LoRA; `<task>` envelope request -> base). Rationale: the protected
format is preserved BY CONSTRUCTION (its weights never move), the target format
gets dedicated capacity, VRAM drops far below full-FT (no optimizer states for
frozen params — removes the 6GB OOM class), and it is the dominant industry
practice with production serving patterns.

FSI-Trek specifics:
- Target modules: attention q/k/v/o projections AND FFN matrices of the
  dual-mind blocks (evidence: "All" modules beats attention-only; MLP is the
  primary locus of adaptation).
- Rank: start r=64, alpha=2r; escalate to r=256 only if target learning stalls
  (high ranks needed for hard IFT domains; ranks 16-64 underfit code-like
  tasks).
- LR: sweep 1e-5..5e-4; LoRA tolerates ~10x full-FT LR; pick highest stable.
- Init A ~ N(0,1), B = 0 (delta zero at start; parent behavior unchanged at
  step 0).
- Freeze everything else: embeddings, lm_head, DNA memory, scratch pads (they
  are runtime state, not format knowledge).
- Train/serve parity: the adapter selector must be the SAME deterministic
  function of request type at training and at decode; extend the train-serve
  battery to assert bitwise parity with adapter-on vs adapter-off for each
  request class.

### 2. Gradient surgery (PCGrad) on the existing balanced full-FT

If adapters are unavailable or insufficient: accumulate per-format gradients
separately per effective step, measure cosine; when negative, project the
conflicting component out before applying. No architecture change, no serving
change. Best combined with route 1 (project inside adapter training if the web
LoRA still leaks into envelope-sensitive directions).

### 3. EWC anchoring on full-FT

Compute diagonal Fisher of the parent on the protected-format rows (sampled);
add lambda * F_i * (theta_i - theta0_i)^2 to the repair loss. One extra pass,
no serving change. Use when a single merged checkpoint is mandatory and
adapters are rejected.

### 4. Task vectors / model soups (cheap ablation, anytime)

Train separate repair and retention fine-tunes from the parent; add/interpolate
deltas (greedy soup: keep a delta only if the fixed gate does not drop).
Near-zero cost, often recovers most of both metrics; useful as a sanity probe
before committing to routes 1-3.

### 5. Capacity/data decision (last resort, per parent skill)

Reduce claimed task scope, add verified data diversity, or increase capacity.
Never hide the tradeoff by lowering a gate threshold.

## Gates (non-negotiable, same as multi-format-retention-repair)

1. Every protected metric >= parent baseline AND target improves by a measured
   margin, on the same fixed suite/seed.
2. Run the train-serve-consistency battery (including adapter parity checks)
   before interpreting any repair loss.
3. One controlled pass per attempt; two failed attempts on the same gap trigger
   the next rung or the capacity decision — never more LR/epoch guessing.
4. Stamp every checkpoint: verifier results, data manifest, adapter/selector
   policy, per-format metrics, and promotion decision.
5. Never promote on run-log metrics alone; regenerate with the independent
   stratified eval before deciding.

## Do not

- Do not return to schedule/LR/weight tuning of shared full-FT once this skill
  applies (exhausted by measurement in this project).
- Do not believe paper claims without measuring on our fixed suite — the HF
  2026 benchmark explicitly warns paper results overstate their methods.
- Do not merge a repair LoRA into the parent unless the merged model re-passes
  every protected gate; keep the adapter separable so the parent stays intact.
