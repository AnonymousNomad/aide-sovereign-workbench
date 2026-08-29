# AIDE Cipher-4B — Capability Matrix & Gap Analysis

> **RETRACTION 2026-08-28 (actor: opencode)**: The original summary below drew confident conclusions ("Math is the weakest", "Harness is hurting", "Strong/weak categories") from a 23-prompt battery I designed myself with hand-rolled scoring. That is NOT a verified capability assessment — it's an opinion grounded in insufficient evidence. Per R2 (Armor/Fail-Closed) and the user's "no guessing" directive, the conclusions below are RETRACTED. The raw per-task reports (cipher-4b and router) and JSONL data remain as evidence of what the model SAID, not as a verified capability claim. The proper path: research published Qwen2.5-Coder-4B-Instruct scores, established benchmarks (HumanEval/MBPP/GSM8K/MMLU/SWE-bench), and the project's own cipher-eval/pipeline-phase-9-eval-gates skills BEFORE re-running any capability claim. — opencode

## ORIGINAL (RETRACTED) SUMMARY

**Date**: 2026-08-28
**Engine**: Qwen2.5-Coder 4B (Q8_0, ~4GB), Vulkan on GTX 1060
**LoRA**: frontier-lora.gguf attached (v1, operator-trained)
**Two views compared**:
- **Raw engine** (`http://127.0.0.1:8091/v1/chat/completions`, no harness)
- **Router (harness ON)** (`http://127.0.0.1:4777/api/chat`, v2.1.0 micro-tier harness)

**Why two views**: the AIDE router injects a system scaffold ("credo" / operating guidelines) before the user prompt. At small served contexts (3072) this scaffold is real estate. The audit checks both, so we can see what the model knows vs what it can do with the harness — both matter for daily use.

## TL;DR

| View | PASS | PARTIAL | FAIL | Composite | Wall-clock |
|---|---|---|---|---|---|
| **Raw engine** | 12 | 10 | 1 | **0.698** | 67s |
| **Router (harness ON)** | 9 | 4 | 10 | **0.563** | 562s |

**The harness is currently HURTING performance on this model.** It adds ~9x latency (router 562s vs raw 67s for the same 23 tasks), drops 3 PASS → FAIL conversions, and causes 4 hard timeouts (504/60008ms).

The model is **capable** at code generation, code understanding, code edit, format compliance, and long-context retrieval. It's **weak** at agentic tool-call formatting (when the audit required `ACTION:` prefix), math/probability reasoning, and reasoning under harness overhead.

## Strong categories (PASS in raw, mostly in router)

| Category | Tasks | Raw | Router | Verdict |
|---|---|---|---|---|
| **A. Code generation** | 4 | 4/4 PASS, 0.883 | 3/4 PASS, 0.825 | Strong. Even router passes most. |
| **B. Code understanding** | 3 | 2/3 PASS, 0.800 | 2/3 PASS, 0.689 | Strong. Bug-finding excellent. |
| **C. Code edit** | 3 | 3/3 PASS, 0.906 | 1/3 PASS, 0.492 | Raw strong; router breaks C1 (60s timeout). |
| **F. Format (OpenAPI)** | 1 | PASS | PASS | Strong YAML/structured output. |
| **G. Long-context retrieval** | 2 | 2/2 PASS, 1.000 | 0/2 PASS | Raw strong; router breaks G1 (504). |

**What this means**: the cipher-4b is a solid **code writer and reader**. It's at Qwen2.5-Coder 4B's natural strength zone — generation, edit, format.

## Weak categories

| Category | Tasks | Raw | Router | Why weak |
|---|---|---|---|---|
| **D. Tool-call format (audit-required `ACTION:`)** | 4 | 0/4 PASS, 0.550 | 1/4 PASS, 0.458 | Model emits AIDE-style `mswea_bash_command` blocks instead. The audit's expected format is wrong, NOT the model — but it shows the model expects a specific tool grammar. |
| **E. Reasoning / planning** | 3 | 0/3 PASS, 0.467 | 1/3 PASS, 0.456 | Concise answers; doesn't enumerate 4-6 bullets when asked; chooses valid alternative (CockroachDB) when asked for "redis" |
| **F. Docstring format** | 1 | PARTIAL | FAIL | Model searched the codebase (wrong interpretation) instead of writing one. |
| **H. Math / logic** | 2 | 0/2 PASS, 0.200 | 0/2 PASS, 0.300 | Probability (1/7 vs 3/28) and two_sum (description without code). Real capability gap at math depth. |

**What this means**: the cipher-4b is **not a strong reasoner or math solver**. For probability, formal logic, and multi-step proofs, it's at-or-below a 4B Qwen baseline. For AIDE, this means: don't ask the cipher for math proofs; route math to a tool or a different model.

## Router-specific issues (the harness overhead)

Looking at FAILs that are PASS in raw, the router is *costing* the model:

| Task | Raw | Router | What changed |
|---|---|---|---|
| A2 (http_get_retry) | PASS 0.800 | FAIL 0.300 | Harness scaffold eats context, model returns short answer |
| B3 (regex_explain) | PARTIAL 0.400 | FAIL 0.300, **504** | Router returned 504 — engine stuck or harness caused loop |
| C1 (apply_diff) | PASS 1.000 | FAIL 0.000, **timeout 60s** | Engine timed out — long response with harness took >60s |
| D1 (list_files) | PARTIAL 0.400 | FAIL 0.000, **timeout 60s** | Same timeout issue |
| E1 (plan_auth) | PARTIAL 0.400 | FAIL 0.300 | Truncated answer |
| F2 (docstring) | PARTIAL 0.400 | FAIL 0.300 | Wrong-task interpretation |
| H1 (probability) | PARTIAL 0.400 | FAIL 0.300 | Wrong answer (1/7) |
| H2 (two_sum) | FAIL 0.000 | FAIL 0.300 | Description without code |
| G1 (long_reason) | PASS 1.000 | FAIL 0.300, **504** | Router 504 |

**Hypothesis**: the v2.1.0 micro-tier harness scaffold (205 bytes) is injected, then the model produces output, but the 3072 served context is being eaten by a long system prompt + audit prompt + growing response. Some tasks time out at 60s because the engine is on slow path (Vulkan, FP32) and the model is producing long output (we saw C1 in raw was 1810ms, so the router 60s timeout isn't from compute — it's the harness driving the model into a longer response or the `compose_ms` overhead stacking).

**Action**: investigate the v2.1.0 micro-tier harness for context budget problems. Either:
- Reduce scaffold size for the micro tier (currently 205 bytes — already small, but the system prompt may grow with `[learned]` blocks).
- Investigate the 504s — engine is failing to respond within harness timeout.
- Consider: skip the harness for direct code questions; only inject for chat-style ones.

## Format gaps the audit caught (real)

| Task | What model did | What audit wanted | Gap |
|---|---|---|---|
| D1-D4 | Emitted `mswea_bash_command` blocks (AIDE's own tool grammar) | `ACTION: list_dir path=...` literal | Audit format was wrong. AIDE uses a specific tool-call grammar. |
| F2 | Emitted `mswea_bash_command` to grep the codebase | Wrote a docstring | Model interpreted "write docstring" as "find existing docstring". Fix prompt framing. |
| H2 | Wrote description in prose | Wrote Python code | Model avoided code, gave explanation only. Math + prose tasks. |

**The "mswea_bash_command" pattern** is critical: it tells us the model has been post-trained on AIDE's specific tool-call format. This is good (it'll work with the AIDE agent loop). The audit's expected `ACTION:` format was wrong.

## Capability matrix (single score per category, raw engine basis)

| Category | Score | Strong tasks | Weak tasks | Verdict for AIDE use |
|---|---|---|---|---|
| A. Code generation | 0.88 | All 4 (factorial, retry, csv, sql) | — | **Use it.** |
| B. Code understanding | 0.80 | explain, find_bug | regex (vocab) | **Use it.** |
| C. Code edit | 0.91 | All 3 (apply_diff, rename, fix) | — | **Use it.** |
| D. Tool-call format | 0.55 | (uses AIDE format) | (audit format mismatch) | **Use it via AIDE agent loop** (it knows the right grammar). |
| E. Reasoning / planning | 0.47 | — | All 3 (auth plan, db choice, debug CI) | **Soft.** Use for trivial reasoning only. |
| F. Format (OpenAPI) | 0.70 | openapi | docstring | **Mostly use it.** |
| G. Long-context | 1.00 | both | — | **Use it up to ~2.5K ctx.** |
| H. Math / logic | 0.20 | — | probability, two_sum | **Don't use it for math.** Route to tool. |

## What we have to work with (gap-driven training priorities)

1. **Math is the weakest.** Probability (1/7 vs 3/28) and two_sum (no code) are real gaps. **Add math-rich SFT pairs** to the cipher-from-scratch pretrain or post-train pipeline. Cite measured examples, not just "think step by step" prompts.

2. **Reasoning/Planning needs more enumeration training.** The model writes 1 bullet when asked for 4-6. **Add structured multi-step reasoning SFT pairs** that reward enumeration.

3. **Router harness overhead is a runtime concern, not a model concern.** At 3072 ctx, the v2.1.0 micro scaffold + growing user prompt + growing response causes 504s and 60s timeouts on longer tasks. **Investigate the harness size, the context budget, and the timeout config** before adding more capability.

4. **The 4B cipher is honest at its size.** It does code, it does format, it does long-context retrieval. It does NOT do math, multi-step planning, or long-form enumeration. This matches Qwen2.5-Coder 4B's published capability profile.

5. **The from-scratch 139.7M cipher must beat these numbers in the same battery before promotion** (cipher-eval gate). The from-scratch is intentionally smaller; it should match the 4B on A/B/C/F/G, be acceptable on D, and may regress on E/H until post-train.

## How to use these findings

- For the user's actual SE work, the 4B cipher is **usable** for code generation, edit, format, and long-context tasks. It's a real coding assistant.
- The user's "UIs/UIDs" project work is in scope: code gen, edit, format compliance — all green.
- Math, planning, and reasoning-heavy tasks: pair with a tool, or use the AIDE agent loop to break them into smaller prompts.
- The from-scratch cipher (Track B) must clear this same battery to ship.

## Audit artifacts

- Raw engine results: `E:\pip_temp\opencode\audit_cipher_4b_results.jsonl`
- Router results: `E:\pip_temp\opencode\audit_router_results.jsonl`
- This report: `E:\aide-sovereign-workbench\docs\evidence\capability-audit-summary.md`
- Per-task detail: `E:\aide-sovereign-workbench\docs\evidence\capability-audit-cipher-4b.md` and `capability-audit-router.md`
- Battery script: `E:\pip_temp\opencode\capability_audit_cipher_4b.mjs` (raw) and `capability_audit_router.mjs` (router)

## What to do next

- **Use the 4B for real SE work** (Track A) — it's verified usable for the user's main use case.
- **Phase 0 cipher-from-scratch sizing is in place**: `E:\FSI-FELON\models\fsi_felon_cipher\sizing_139m_v1.json` — needs the user to pick which 3 of 6 novel modules for v1.
- **Investigate harness overhead** as a follow-up — drop scaffold size, or skip harness for code tasks.
- **Add math SFT pairs** to post-train plan.
