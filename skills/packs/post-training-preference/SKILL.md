---
name: post-training-preference
description: Stage 3 of post-training — preference optimization for a small from-scratch model (queen-bee-v5): DPO first, then GRPO/RLVR on verifiable tasks. Use when the distillation checkpoint passes Gate 2 and the model must be aligned to prefer correct, format-clean outputs over incorrect ones. Governs preference pair construction from verifier results, DPO recipe, GRPO recipe, and the Gate 3 final eval.
---

# Post-Training Stage 3 — Preference Optimization (DPO -> GRPO/RLVR)

Grounded in: SmolLM (1 epoch DPO after 1 epoch SFT), Phi-3 (SFT + DPO), Llama 3 (rejection sampling + PPO + DPO), Tülu 3 (SFT -> DPO -> RLVR, full PPO hyperparams), DeepSeek-R1 + GRPO (RL on verifiable rewards, GRPO without a critic).

## When to run (Gate 2 must be satisfied)
- Distillation checkpoint `posttrain_distill.pt` passes the reasoning gate.
- The verifier (ast.parse + unit tests + measured-result checks) is in place and has a FAIL/PASS backlog from Stages 1-2 — that backlog IS the preference data source.

## Stage 3a — DPO (one epoch)
### Preference pairs (build from verifier results)
- A pair = (prompt, chosen, rejected) where chosen PASSED the verifier and rejected FAILED it, on the SAME prompt.
- Sources: (1) the recorded failures from Stage 2 — same task, passing trace = chosen, failing trace = rejected; (2) new sampling: sample K completions per held-out task, run the verifier, take one PASS as chosen and one FAIL as rejected; (3) format failures: a format-clean completion beats a format-broken one on the same task.
- Minimum quality: reject pairs where the failure is trivial (empty/garbage) — preference learning works best when rejected is "almost right" (e.g., wrong final value, correct structure).
- Volume: 1-3K pairs is plenty for a 16M model (SmolLM used a few thousand; LIMA-style curation applies).

### DPO recipe
- Start from `posttrain_distill.pt`. One epoch. LR 1e-6..1e-5 (beta ~0.1 for DPO; SmolLM used the Zephyr-Gemma recipe numbers scaled down).
- Reference model = the distillation checkpoint (frozen). Clip the ratio to avoid degenerate updates on tiny data.
- Mask prompts; compute the DPO loss on completion tokens only.
- Watch: chosen/rejected log-ratio should separate over the epoch; if it plateaus, the pairs are too easy/hard — fix data.

## Stage 3b — GRPO / RLVR (only for tasks with fast exact verifiers)
Reasoning = RL on verifiable rewards (DeepSeek-R1). Our verifiers: ast.parse, unit tests, exact-match numeric checks — all O(ms). NO model-based reward model on this hardware budget.
- Use GRPO, not PPO (DeepSeek-Math / Unsloth): sample 4-8 completions per prompt, advantage = (reward_i - mean)/std, reverse-KL penalty against the reference with beta ~0.04, no value head.
- Prompts: the held-out verifiable task suite (math-exact, code-parse, format-exact).
- Tülu 3 PPO/RLVR defaults as a starting grid: LR ~1e-6, gamma 1.0, lambda 0.95, eps 0.2, KL beta 0.05, temp 1.0, penalty -10 for responses missing EOS, response cap ~512 tokens.
- Run SHORT (1-2K steps), eval every 200 steps on the task suite. Stop when solve-rate plateaus or generation quality (repetition, readability) starts to degrade — the R1-Zero failure mode (repetition, language mixing) happens without cold-start; our cold start = the SFT + distillation stages already done.
- If repetition/language-mixing appears: lower LR, raise KL beta, or add format-clean completions back into the prompt set.

## Gate 3 — final eval (Stage 3 done when these pass)
1. Task suite solve-rate >= Gate 2 rate (RL must not regress the distillation gains).
2. Cloze + py_parse + format rate >= all previous stage rates (no regression anywhere).
3. Generation quality: coherent, no repetition death, follows chat format (8/3 lesson: loss is not the proxy; sample and look).
4. Calibration/abstention: on a small abstain probe, the model refuses/walks-back on tasks it fails rather than confidently hallucinating (flagship precision requirement; see RECOMMENDATION_FLAGSHIP).
Only then: export final post-train checkpoint + write the eval report.

## Deliverables
- Preference manifest (prompt -> chosen id -> rejected id -> verifier results)
- Checkpoint `posttrain_dpo.pt`, `posttrain_rlvr.pt` (lineage preserved)
- Gate 3 report; hand-off to Stage 4 (closed loop) as the deployed model

## Audit checklist
- [ ] DPO one epoch, pairs from verifier PASS/FAIL backlog, chosen always verified
- [ ] GRPO uses exact verifiers only; beta ~0.04; short run; repetition watch
- [ ] All evals (cloze, py_parse, format, solve-rate, abstain) >= prior stages
- [ ] No regression in any metric; sample-based quality check done
- [ ] Lineage: sft -> distill -> dpo -> rlvr all preserved
