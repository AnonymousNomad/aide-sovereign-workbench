# Skill: aide-trio-tuning

# AIDE Trio Fine-Tune Program — three models, one workflow, phased roadmap

## MISSION
Three models fine-tuned specifically for the AIDE workbench workflow, served
offline via llama.cpp from AIDE's model registry:

| Slot | Model | Role | Size | Status |
|---|---|---|---|---|
| FRONTIER | mini-coder-4b (MIT, Qwen3-4B-2507 lineage) | agentic coding: edit→run→fix loops | 4B dense, Q8/Q4 | requant in progress |
| THINKING-CODER | Qwen3-4B-MiniMax-M2.1-Coder | deep reasoning + code, thinking mode | 4B, q4_k_m local | downloaded |
| RESEARCH/TOOLS | LFM2.5-1.2B-Thinking (LiquidAI) | fast tool-calling, research, extraction | 1.2B, q4_k_m local | downloaded |

## RESOURCE LAW (protects the user's AIDE build terminal)
The user is building AIDE concurrently. Therefore:
- HEAVY jobs (training runs, quantization, corpus generation bursts) launch ONLY
  after announcing them, ideally batched into one window; never stack two heavies.
- LIGHT jobs (dataset authoring, scripts, config) run anytime.
- Default pattern: heavy job → WMI-detached + log polling → report → next.
- If the laptop lags: STOP the heavy job first, apologize later.

## PER-MODEL FINE-TUNE DOCTRINE (research-grounded 2026-08-23)

### 1. mini-coder-4b (FRONTIER)
- Data shape: **mini-swe-agent .traj.json-style conversations** (system / user task /
  assistant action+bash / observation). The linear `messages` list is directly
  fine-tune-ready per upstream docs. Author AIDE-flavored tasks: open→edit→test→fix,
  git ops, project navigation using AIDE's actual tool names/routes.
- Method: QLoRA (peft+trl, bitsandbytes 4-bit base) r16 alpha32 dropout 0.05,
  seq 1024–2048, assistant-only loss masking, **error-mask observations**
  (mask role:"tool"/observation spans — model learns actions, not environment text).
- Caveat honored: SWE-Protégé found LoRA < full-SFT at their scale; we cannot full-SFT
  on 6GB — compensate with rank 32 option, more epochs of verified data, phase gates.
- Base for FT = the Q8 GGUF's source weights (HF ricdomolm/mini-coder-4b, bf16)
  loaded 4-bit via bitsandbytes. Merge LoRA → convert via llama.cpp @ runtime commit
  → quantize Q4_K_M (or keep Q8 slot if VRAM allows after tuning).

### 2. Qwen3-4B-Thinking-MiniMax-M2.1-Coder (THINKING-CODER)
- ⚠️ SILENT KILLER BUG (transformers PR #44301): Qwen3 chat template only renders
  `reasoning_content`; datasets storing `thinking` get think-blocks DROPPED silently
  → model never learns reasoning. FIX: normalize every row's field to
  `reasoning_content` during data prep + verify rendered token sequence contains
  the think block before training (assert in dataloader).
- think_loss policy: `answer_plus_think` recommended (train reasoning + answer,
  skip literal tags); alternative `all`.
- Same QLoRA recipe; keep dual-mode behavior by including both thinking and
  no-think rows (Qwen3 soft-switch /think //no_think still works when trained mixed).

### 3. LFM2.5-1.2B-Thinking (RESEARCH/TOOLS)
- Official paths: LEAP Finetune, plain TRL, or Unsloth (all Liquid-supported;
  Unsloth notebooks exist for this exact model).
- Tool calling: NATIVE pythonic format with `<|tool_call_start|>` /
  `<|tool_call_end|>` specials; tools passed as JSON in system prompt.
  Training data MUST use this native format (NOT OpenAI JSON tool_calls).
- Liquid docs recipe: 500–5,000 task examples, LoRA first pass (minutes–tens of
  minutes), frozen held-out set BEFORE training, iterate data not epochs.
- Role in trio: research summaries, web-tool calls, extraction — NOT programming
  (Liquid explicitly rates it weak at programming/knowledge).

### SHARED DATASET LAWS (all three models)
- Every training row execution-verified or human-gated (zero-dup law; no unverified
  self-generation — STaR lesson).
- Assistant-only loss masking everywhere; structured truncation preserving
  system+latest turns (qwen-qlora-train dataset pipeline is the reference impl).
- Phase gates: held-out battery per phase; advance only on improvement; memorization
  signature (phase loss < ~0.8 nats or train>>val divergence) = cut data, not steps.

### REWARD LAW (collaborator directive 2026-08-23, RLVR study on 0.6B–1B: +13pp pass@1)
1. Unit-test/verification rewards are the PRIMARY reward signal for any R/RLVR
   stage — implemented via verify_harness.run_verified pass/fail.
2. Light style shaping allowed (e.g., normalized linter penalty ≤ small weight) —
   but NEVER static-analysis-only rewards: they degenerate models into short,
   safe, wrong outputs.
3. Behavioral diagnostics MUST be reported alongside loss: generation length
   distribution, error-type breakdown, UNK/repetition counts. Reward-induced
   shifts hide in loss curves — loss alone is blind to them.
   → pilot_qlora.py emits these automatically post-run into pilot_report.json.
A verification-reward-trained model slots directly into AIDE's gated sampling +
approval pipeline.

## PHASED ROADMAP

### PHASE 0 — Infrastructure verification (light, anytime)
- [ ] Requant mini-coder q4_k_m completes; serve test passes coherence line
- [ ] Serve MiniMax-Coder q4_k_m; baseline battery (coherence/code/agentic)
- [ ] Serve LFM2.5-Thinking q4_k_m; baseline battery incl. a native tool-call round-trip
- [ ] peft/trl/bitsandbytes import check in venv_trek (DONE 2026-08-23: all present)

### PHASE 1 — Corpus authoring (light, parallel with AIDE build)
- [ ] Define AIDE workflow task taxonomy from the real AIDE repo surfaces:
      file-edit loops, run-error-fix, git ops, LSP-diagnosis, tutor Q&A, research+tools
- [ ] Author ≥500 rows/model to start (Liquid min guidance); scale toward 2–5K
- [ ] Formats: mini-swe traj messages (frontier); messages+reasoning_content
      (thinking-coder); native tool-call json-in-system (LFM2.5)
- [ ] All rows gated: dedup(jaccard) + format + verdict/execution where applicable

### PHASE 2 — Pilot fine-tunes (HEAVY — schedule with user)
- [ ] One pilot QLoRA per model (~200–500 rows, short run) → immediate battery diff
- [ ] Gate: battery improvement vs base; else fix data before scaling

### PHASE 3 — Full runs (HEAVY — overnight windows)
- [ ] Full SFT per model on final corpora; checkpoint completeness rules apply
- [ ] Merge LoRA → GGUF (llama.cpp @ runtime commit) → quantize → battery again

### PHASE 4 — Integration
- [ ] Register three GGUFs in AIDE model registry (ports 8081–8087 doctrine)
- [ ] Per-slot smoke inside AIDE UI; latency/VRAM audit (edge-deployment-ci gates)

## THREAT MATRIX

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Qwen3 think-blocks dropped in FT (silent) | HIGH without prep | model never learns reasoning | normalize to reasoning_content + assert render |
| Resource conflict with AIDE build | HIGH if careless | laptop lockup (measured ×3) | RESOURCE LAW above; announce heavies |
| LFM2.5 trained on OpenAI-style tool JSON | MEDIUM | broken tool calls | native `<\|tool_call_*\|>` format only |
| LoRA underperforms full-SFT (Protégé) | MEDIUM | capability ceiling | rank 32 + verified-data volume + accept ceiling |
| Requant quality drift (q8→q4) | LOW | minor | acceptable for pilot; re-quant from bf16 later |
| bitsandbytes Windows quirks | MEDIUM | blocked QLoRA | already imports ✓; fall back to fp16-LoRA if needed |

## DEPENDENCIES
venv_trek (torch 2.7.1 cu118, peft, trl, transformers, datasets, accelerate,
bitsandbytes ✓ all present); llama.cpp build 9940 + matching converter; E:\models
store (all three bases downloaded ✓); verify_harness.py; watchdog pattern.

## WHEN DONE
Per-model receipts: phase logs, held-out battery deltas vs base, merged-GGUF sha256,
AIDE registry entries, and a written handoff so any future session can pick up.
