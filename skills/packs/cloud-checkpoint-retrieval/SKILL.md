# Skill: cloud-checkpoint-retrieval (Phase C4)

# Checkpoint → Home → GGUF → Serving — Closing the Round Trip

## Objective
Convert the retrieved best checkpoint into a served, verified in-house model on
THIS machine: fp32 checkpoint → bf16/fp32 GGUF conversion decisions done
correctly for OUR arch → quantize (Q8_0 primary) → import into workbench
manifest/profile/backends → serve via the fixed runtime (aide-inhouse-model-
runtime skill) → gate battery re-run locally. DONE = engine serving at its port
with identity + chat verified AND Gate-0' eval suite passing locally.

## Why a dedicated phase exists (bugs this prevents)
- Train/serve skew is the historic killer (train-serve-consistency): cloud
  trained bf16/tensor-core; local serve path is llama.cpp — logits parity vs
  PyTorch reference must be MEASURED (logit agreement ≥99.9% band probe before
  accepting quality claims).
- GGUF conversion for NOVEL architecture: llama.cpp supports llama-shape ops.
  Our arch differs (dual-mind attention, DNA-helix memory, debate gate). TWO
  legal paths, decide explicitly:
    A) **Portable-equivalent export**: if Phase-2 architecture kept an
       inference-isomorphic fallback (standard-shape projection layers
       producing equivalent outputs), export THAT and verify equivalence.
    B) **Custom consumer**: extend converter/exporter ourselves; never
       silently map custom ops onto wrong stock ones.
  Path choice recorded with evidence; "it converted without error" is NOT
  evidence of correctness.

## Procedure

### Step 1 — Local landing + integrity
Place under versioned lineage dir (`E:\models\house-model\cloud_v1\`), run
`sha256sum -c RETRIEVE.SUMS` (if not already), then re-run the model's own
config-hash assert. Fresh-regression-only rule: NEVER compare against metrics
produced by older normalizer/eval versions.

### Step 2 — Reference logits probe (before any quantization)
PyTorch fp32 reference forward on N=64 fixed prompts saved from val set →
save logits. Serve candidate GGUF via llama-server → pull same prompts.
Metric: per-token logit agreement (≥99.9% within tolerance) OR min-KL bound
documented in skill gguf-quantization-deployment terms. Fail ⇒ exporter bug ⇒
fix, regenerate GGUF; do not tune quantization around a broken exporter.

### Step 3 — Quantize + parity ladder
Q8_0 first (quality lane) then Q4_K_M (size lane) per gguf-quantization-deploy:
each passes (a) perplexity/completion parity probe against fp16 GGUF, (b)
served-identity check, (c) one real chat. Record file sizes + tok/s local
(Vulkan backend, ~27 tok/s precedent for 4B-class file; expect ≥ this for ≤150M).

### Step 4 — Workbench integration (same import contract as house models)
1. Copy artifact to `E:\aide-sovereign-workbench\models\aide-house\`.
2. Update `manifest.json` entry (id/name/context_tokens/lora_adapter only if
   post-trained adapter exists).
3. Profile sidecar json (backend=vulkan, ngl=999, samplers per training-sop).
4. `POST /api/models/start {id}` → READY → `/v1/models` alias identity match →
   real completion returns coherent code/doc output.

### Step 5 — Local gate battery re-run (the real acceptance)
Run the local eval harness against held-out suites IN THE SERVING PATH:
format rate · cloze · py_parse/exec-verifiable items · repetition/degeneracy
floor · paraphrase-robust spot set. Numbers logged next to cloud-side training
losses; any category dropped vs prior shipped model ⇒ regression protocol
(multi-format-retention-repair posture), no quiet ship.

### Step 6 — Cleanup + records
- Delete cloud instance/bucket leftovers; verify zero billable resources.
- AGENT_NOTES final entry: full chain hashes (ckpt→gguf q8/q4), sizes, parity
  numbers, gate table, tok/s served.
- Optional corpus side-effect: failures collected here feed closed-loop S4
  queues per project-governance §3 (Stage-4 routing rules).

## Threat matrix
| Threat | Armor |
|---|---|
| Exporter maps custom op to plausible-but-wrong stock op | Step-2 logits probe is the teeth; visual-look tests forbidden as proof |
| Parity lost only at long ctx | probe set includes ≥2 sequences at max train seq len |
| Quantization absorbs/ hides exporter error | Step 2 runs BEFORE quant ladder; order non-negotiable |
| Old eval artifacts silently compared | fresh-regression-only rule restated in every comparison line |
| Port squatting during local verify (silent EADDRINUSE class) | stop + netstat verify zero BEFORE start (debugging-discipline trap table) |
| Asset sprawl / lineage confusion | single versioned dir; old artifacts untouched; names carry hash prefix |

## Dependencies
skills: gguf-quantization-deployment · aide-inhouse-model-runtime ·
train-serve-consistency · multi-format-retention-repair (on regression) ·
workbench manifest/profile contracts (Phase W models/import flow).

## Done definition (lane-complete)
Cloud lane is CLOSED only when: zero billable cloud resources remain AND local
engine serves the new model through a real task AND all numbers above are in
AGENT_NOTES. Public-facing docs may then state facts (novel arch, from-scratch,
params count) WITHOUT contest/monetary framing per standing public-rule.
