---
name: project-governance
description: Consolidated project governance for the FSI-FELON / queen-bee-v5 small-model program. Merges the previously-unregistered skills agent-notes (persistence protocol), kd-corpus-production (KD gold-doc corpus discipline), post-training-pipeline/-sft/-distill/-preference/-closed-loop (the full post-pretraining playbook), and felon-master (FELON edge-model architecture). Use at the start of every session and every context compaction, after ANY task/change/decision/event, when writing training docs or corpus batches, when a pretraining run finishes, and when running any post-training stage or audit. When a section below says "load the X skill", the X content IS section N of this file.
---

# Project Governance — Consolidated Master Skill

This is the canonical, loadable version of the skills that were on disk but not registered. Sections are self-contained; follow the section matching your task. Never rewrite history in AGENT_NOTES; never ship unverified data into any corpus.

## Section 1 — Persistence Protocol (was: agent-notes)

Project memory lives in `AGENT_NOTES.md`. Single source of truth across sessions and compactions. Nothing is remembered between sessions EXCEPT what is written here.

- **READ FIRST.** At session start and after every compaction, read `AGENT_NOTES.md` and orient from its most recent entries.
- **WRITE AFTER EVERY ACTION.** Append an entry after ANY task, change, decision, check, or event. No entry = task incomplete.
- **NEVER REWRITE HISTORY.** Append newest-first to the running log. Never edit or delete prior entries.
- **TIMESTAMP** every entry `YYYY-MM-DD HH:MM`. Use the environment-reported date.
- **NAME THE ACTOR**: `human` (decision) or `opencode`/`subagent` (action).
- Entry block: `## [ts] Actor: <human|agent>` with Type (task|decision|event|bug|checkpoint|update|audit|note), Status (in-progress|done|blocked|cancelled|verified), Summary, Details (paths, commands, numbers), Files, Next. Short entries may be one-line but keep ts/actor/type/status.
- **CURRENT STATUS section** near the top is the ONE place in-place edits are allowed (summary, not history). After every significant event: update it in place AND append the full entry.
- Log: training runs (PID/step/loss/val/speed/ETA), scripts written/edited/deleted, corpus changes (path/size/format), checkpoints, bugs (root cause + fix), human decisions + reasoning, skill edits, audits, all model tracks.
- Files: master `E:\FSI-FELON\AGENT_NOTES.md`; `E:\queen-bee-v5\AGENT_NOTES.md` is a redirect pointer. If AGENT_NOTES.md is missing, create it from `references/template.md` (agent-notes) with the canonical structure. If locked, say so and record next write — never silently skip.

## Section 2 — KD Corpus Production (was: kd-corpus-production)

For small models, data quality + format ARE the strategy: 20K perfect examples beat 100K noisy (+20-30 pts), 1,000 curated beat 65K uncurated (LIMA), textbook-quality synthetic lets a 1.3B match 10x-larger web-trained models (Phi-1.5). Teacher output must be LEARNABLE by the student (ACL 2025: KL≈NLL>>MSE; bigger teacher not always better).

### The 5-Gate Quality Pipeline (every doc)
1. **Length & scope** — one self-contained unit: single topic, full worked example, not a fragment/generator/strip. Record the token band.
2. **Complexity** — learnable by the target student; small worked example beats a big jump; step-by-step.
3. **Verification** — every number/output/claim from an ACTUAL executed run. Never invented. If it can't be verified, it doesn't ship.
4. **Format** — byte-exact doc format below, zero drift (one inconsistent example = a 5% failure mode at small scale).
5. **Dedup/originality** — check the corpus index first; no near-duplicate; vary topic seed + angle (Cosmopedia diversity).

### Canonical doc format (Orca triple + book organization, byte-exact order)
```
<task>Write a training document on TOPIC. Write the document. Not a generator, a complete executable example.</task>
<guidelines> SOP: DOMAIN_TOPIC_V1 + Preconditions + numbered checklist + Verification gate: [ ] PASS
<check> Topics covered: ... / Depth: L2
<mind_spock> step-by-step / decomposed reasoning path
<mind_sheldon> independent cross-check / re-derivation / adversarial probe
<code> complete runnable code, stdlib only
<execute> REAL run output, never invented
<observe> measured observations
<mind_synthesis> merge Spock + Sheldon
<deliver> File: gold_<domain>_<topic>_NN.txt / Tokens: ~N (measured) / Level: 2
```
- `<task>+<guidelines>+<check>` = the directive-with-known-procedure teaching. `<mind_*>` = Orca-2 multi-strategy + rationale signal. `<code>+<execute>` = Phi-1 exercises-and-answers (strongest anti-hallucination grounding). Book-organization: internal order is planned adjacency; do not split related content across docs.

### Distillation rules (when generating from a teacher)
1. Teacher is the ceiling but bigger is not always better; compress to what the student can hold.
2. Always include rationales (step-by-step is the highest-leverage feature).
3. Progressive complexity (Orca): easier before harder; docs at the student's current edge win.
4. Diversity by topic-seeding, not repetition (Cosmopedia).
5. **NEVER feed the model its own incoherent output** (STaR self-poisoning). Only verified teacher output ships.
6. Verify with executors, not vibes (Google active learning: 10000x data reduction).

### Corpus discipline
- Every batch = N planned topics (coverage check) + N harness sections run + N docs written from observed numbers + AGENT_NOTES entry naming this skill.
- Docs stage to `training_curated\` ONLY after all 5 gates pass.
- Keep a corpus index (topic → filename) for the dedup gate.

## Section 3 — Post-Training Pipeline (was: post-training-pipeline + 4 stage skills)

Sequence and gate everything AFTER pretraining. Orchestrator first, then run the matching stage section. Rules are research-grounded (SmolLM, Llama 3, Phi-3, Orca-2, DeepSeek-R1, Unsloth GRPO, Tülu 3, SOL-VER, MapCoder-Lite).

Golden rule across all stages: **never feed unverified model output into any corpus.**

### Gate 0 — pretraining finalization (from training-from-scratch)
Best-val checkpoint chosen retrospectively; eval note written; base checkpoint is a fresh copy for `posttrain_sft` lineage.

### Stage 1 — SFT (was: post-training-sft)
- Input: the same gold docs (`E:\queen-bee-v5\training_curated\`) ARE the instruction source. 3 pair templates per doc: Direct (task → verified content), SOP (follow SOP → SOP+gate lines), Closed-loop (task + wrong first attempt → corrected verified version).
- Freeze the chat template (system/user/assistant) forever. Keep tokenizer_v5 specials.
- ONE epoch. Underfit → add higher-quality pairs, never epochs. Every completion must be verifiable. ~2-5K pairs from ~1,078 gold docs. Keep time-sensitive trivia OUT (Phi-3).
- Recipe: full FT of ~16M (no LoRA), LR 1e-4..3e-4 (start 1e-4, probe 3e-4 on 200 steps, pick by eval not loss), AdamW (0.9, 0.95), wd 0.01, clip 1.0, warmup 5-10%, cosine to ~10% peak, prompt labels masked, eff batch ~32K tok/step, short run. Best by Gate 1 metric, not loss.
- **Gate 1**: format rate ≥ ~80% (structural match), cloze + py_parse ≥ base, no repetition death. Fail → more curated pairs on the failing structure, re-run.

### Stage 2 — Distillation (was: post-training-distill)
- Teacher = the closed-loop verifier system (generate → execute → verify → self-correct → keep ONLY verified final trace), stronger than copying a big model's prose because every trace is proven.
- Data: (1) replay kd_tests harness backlog as (P, C, T); (2) new traces — sample N candidates from current model, keep only verifier-PASS; failures become Stage-3 preference data, NEVER completions; (3) Orca-2 strategy labels (step_by_step, recall_then_generate, recall_reason_generate, extract_generate, direct) balanced; (4) prompt erasure (MapCoder-Lite): strip intermediate feedback, store task → final verified solution; (5) regenerate on failure with failure msg as instruction, store only the passing trace.
- One epoch from `posttrain_sft.pt`, same recipe. Difficulty ramp easy→hard. Optionally mix 10-20% pretrain gold docs.
- **Gate 2**: solve-rate on HELD-OUT verified suite ≥ Gate 0 rate + absolute improvement (e.g. +20 pts); strategy coverage; no regression. Fail → fix data (strategy diversity vs harder tasks), never epochs/LR.

### Stage 3 — Preference (was: post-training-preference)
- 3a DPO (one epoch): pairs from verifier PASS/FAIL backlog — same prompt, chosen=PASS, rejected=FAIL; or format-clean vs format-broken. Rejected should be "almost right", not garbage. 1-3K pairs plenty. Recipe: from `posttrain_distill.pt`, LR 1e-6..1e-5, beta ~0.1, reference=frozen distill ckpt, clip ratio, prompt-masked. Watch chosen/rejected log-ratio separate.
- 3b GRPO/RLVR ONLY for fast exact verifiers (ast.parse, unit tests, exact-match — all O(ms)). NO model-based reward model. GRPO not PPO: sample 4-8 completions/prompt, advantage=(r-mean)/std, reverse-KL vs reference beta ~0.04, no value head. Tülu-3 grid: LR ~1e-6, gamma 1.0, lambda 0.95, eps 0.2, KL 0.05, temp 1.0, −10 missing-EOS, cap 512 tok. Run SHORT (1-2K steps), eval every 200, stop on plateau or repetition/language-mixing (R1-Zero failure). Fix repetition: lower LR, raise KL beta.
- **Gate 3**: solve-rate ≥ Gate 2; cloze/py_parse/format ≥ all prior; no repetition death; abstention probe — model refuses/walks-back on failures rather than hallucinating. Then export final checkpoint + eval report.

### Stage 4 — Closed Loop (was: post-training-closed-loop)
```
1 EVALUATE deployed model (task suite + cloze + py_parse + format)
2 COLLECT failures (task, failing completion, verifier output)
3 VERIFY each: generate → execute → AST/unit verify → self-correct → keep ONLY passing trace
4 ROUTE the fix to the correct stage corpus
5 RETRAIN that stage (short run) from the nearest checkpoint
6 RE-EVALUATE; ship if no regression, else back to 3
```
- Routing: format/structure → SFT; reasoning w/ clean pass → distill; pass+fail on same task → preference; systematic gap → STOP, add a new gold doc to pretrain corpus, plan next run (never loop the same stage); abstention → preference with abstain-aware pairs.
- Verification gate (non-negotiable): every corpus entry stamped with verifier name + exact pass result, source, prompt-erasure state. No stamp, no entry. Keep `closed_loop_manifest.jsonl` append-only.
- Verifier co-evolves (SOL-VER): add task templates + keep a verifier registry of known-correct oracles; never grade with an unverified oracle.
- Hygiene: one iteration = one lineage bump (posttrain_vN.pt), never mutate shipped checkpoints; fixed held-out suite never enters any corpus; ship only when ALL metrics ≥ previous AND target category dropped; 2 failed tries on the same gap → escalate to capacity decision. STaR re-enable only behind the verification gate.

## Section 4 — FELON Master Architecture (was: felon-master)

FELON = Fractal Emergent Language Operating Network, 25M-param edge IDE model, Q-NFRE quantum-neural fusion, nanobot swarm, DNA Helix memory, epistemic conscience.

- Q-NFRE block: RMSNorm → QuantumSuperposition → CausalSelfAttention(RoPE) → NanobotCommGate(2048 bots) → SwiGLU FFN → DNAHelixMemory(32 pairs) → EpistemicResonanceLayer → TurbulencePredictor.
- Dims: 8 layers × 384 dim, 6 heads, 1024 FFN; 4 qubits, depth 2, decoherence 0.15; 2048 nanobots × 64, 10 territories; DNA 32 pairs × 48, REM every 500 steps; vocab 16384 BPE.
- Territories: coder builder debugger architect tester frontend backend data devops general.
- Training: vocab=16384 min (4096 is char-level), seq_len=128 → 512 later, bf16 AMP, batch 16, lr 4e-4 cosine, 1K warmup, grad clip 1.0 MANDATORY, transfer v1 weights for 45 shared layers (skip Q-NFRE), no calibration loss until loss < 2.0, adversarial self-play only after step 10K.
- NaN recovery: LR ×0.1, remove calibration/adversarial, check QuantumSuperposition div-by-zero, check TerritoryRouter bias init.
- Benchmarks (priority): val perplexity, code syntax completion (valid AST), confidence calibration (ECE < 0.1), nanobot routing accuracy, adversarial detection, self-repair rate.
- Edge: ONNX/ExecuTorch → ARM/Android; int8 dynamic quantization; DNA in fixed O(1) memory; "I don't know" gating at inference.

## Cross-Cutting Rules (apply everywhere)
1. Closed-loop verification everywhere: generate → AST-verify → self-correct → confidence.
2. Never ship unverified data into any corpus or checkpoint lineage.
3. Log every action to AGENT_NOTES with timestamp, actor, type, status.
4. Reference this skill by name (`via skill: project-governance`) in AGENT_NOTES entries.
5. If a task is not fully covered above, fall back to the governing research skills: `gold-training-docs` (trek doc format/naming) and `training-from-scratch` (pretraining pipeline).
