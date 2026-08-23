---
name: kd-teacher-strengths
description: Teacher-strength-scoped knowledge distillation. Use BEFORE and DURING any distillation work — before selecting a teacher, before generating a trace, before building any KD corpus, and when choosing what to extract from an existing teacher. Mandates that every teacher model is distilled ONLY within its verified competence envelope (benchmarks + official recommendations), never beyond it. Grounded in the LFM2.5 research (IFeval 88.4, BFCLv3 57, GSMA8K 85.6, MATH-500 88, AIME25 31.7; explicitly NOT for code/knowledge tasks) and applies the same evidence-first audit to every teacher: Qwen2.5-Coder, Phi-3, DeepSeek-Coder, kira-14e, or any future teacher. Pair with kd-corpus-production and post-training-distill.
---

# KD Teacher-Strength Scoping — Distill Only Within Verified Competence

## The Rule

**Never distill a teacher beyond its verified competence envelope.** A teacher is a tool with a measured strength profile. Using it outside that profile injects the teacher's weaknesses into the student (weak code output becomes the student's code floor; fabricated knowledge becomes the student's knowledge). A 1.2B thinking model's 88.4 IFEval score makes it an outstanding reasoning/instruction-following teacher; the same model is explicitly weak at code and knowledge — so it must never write those docs.

This is a **mandatory audit before any KD trace or doc is generated**, for every teacher model in the fleet.

## Step 1 — Teacher Competence Audit (evidence-first)

Before ANY distillation, fill in this table from primary sources (official HF model card, official benchmark tables, the model's own documentation — not forum posts):

| Axis | How to verify | Judgment |
|---|---|---|
| Instruction following | IFEval / IFBench / Multi-IF scores on official card | high = safe teacher for structured tasks |
| Tool calling / agentic | BFCLv3, native tool-call support, agentic docs | high = safe teacher for tool-use traces |
| Reasoning (math/logic) | GSMA8K, MATH-500, AIME25, GPQA, MMLU-Pro | high = safe teacher for reasoning traces |
| Code | HumanEval/MBPP, official recommendation | LOW or absent = **never** use for code |
| Knowledge | MMLU-Pro, official recommendation, cutoff date | LOW or "not for knowledge" = **never** use for facts |
| Languages | card-supported languages, vocab size | only distill in supported languages |
| Context | max context length, long-context benchmarks | caps trace length and doc size |
| Generation params | card temperature/top_k/repetition_penalty | copy verbatim into generation harness |
| Chat template | template source (ChatML/IM, Jinja) | must match runtime exactly (see Step 3) |

Record the audit result in AGENT_NOTES: teacher name, each axis verdict, allowed trace types, forbidden trace types.

## Step 2 — Build the Strength Map (what to distill from this teacher)

From the audit, derive the teacher's ALLOWED task taxonomy. Only these task types may be generated with this teacher:

- **Reasoning** — multi-step decomposition, trade-off analysis, decision theory, CAP/architecture reasoning, explicit "think step by step" traces. (LFM2.5: GSMA8K 85.6, MATH-500 88, AIME25 31.7 → allowed.)
- **Instruction following / structured tasks** — format-driven outputs, checklist adherence, multi-part directives. (LFM2.5: IFEval 88.4, Multi-IF 69.3 → allowed.)
- **Tool calling / agentic flows** — function-call traces, tool-use decision reasoning, tool-result interpretation. (LFM2.5: BFCLv3 57, native `<|tool_call_start|>...<|tool_call_end|>` → allowed.)
- **Data extraction** — parsing, extraction, RAG retrieval-based Q&A over provided context. (LFM2.5 card: "recommended for agentic tasks, data extraction, and RAG" → allowed.)
- **FINE-TUNING rationale** — the model card itself is a legitimate distillation source: distillation of how to reason, how to follow instructions, how to call tools — never what to know.

Forbidden (explicit or by absence of evidence):
- **Code generation** (LFM2.5 card: "not recommended for... programming" → NEVER).
- **Knowledge-intensive facts** (LFM2.5 card: "not recommended for knowledge-intensive tasks" → NEVER; knowledge cutoff mid-2024 caps any factual claim).
- Any axis judged LOW in the audit.

## Step 3 — Runtime Correctness (the LFM2.5 template bug, made a rule)

The trace-generation harness MUST reproduce the teacher's native chat template exactly. LFM2.5 failure mode observed and fixed:
- WRONG: manual `<|im_start|>` wrapping PLUS `--chat-template chatml` override → double-wrapped, garbage output ("Loading model..." + mojibake, empty answers). The old `gen_traces_live.py` did this.
- RIGHT: `--jinja` in llama-cli so the template embedded in the GGUF metadata (the `{{ bos_token }}...` Jinja with `keep_past_t...`) is applied exactly once.
- For every teacher: read the GGUF's embedded `tokenizer.chat_template` kv-pair, confirm the runtime applies it, and test ONE prompt before any batch. Never batch-generate on an untested harness.

Also: llama-cli prints its banner to stdout — parse from the first `<think>` tag, don't grep the raw merged stream.

## Step 4 — Strength-Bound Corpus Rules

- Each KD trace gets tagged with the teacher's strength class (`TEACHER=LFM2.5-Thinking|STRENGTH=reasoning|task=...`). These tags drive corpus-mix decisions in corpus-curation.
- Cross-synthesis docs may combine multiple teachers, but each segment must be within that teacher's envelope. No segment is exempt.
- If a task type falls outside every available teacher's envelope, write it closed-loop (verify-by-execution, from scratch) — never stretch a teacher into its weak zone.
- Distillation selection rationale goes into AGENT_NOTES with the corpus batch (kd-corpus-production discipline).

## Teacher Fleet (audited or pending audit)

| Teacher | Location | Audit status | Allowed | Forbidden / caveats |
|---|---|---|---|---|
| Qwen3.5-4B | `E:\models\qwen3.5-4b\Qwen_Qwen3.5-4B-Q4_K_M.gguf` | **AUDITED + LIVE-VERIFIED (2026-08-08)** — SHA-256 `13c16f...a983` == HF tree lfs.oid, size 3,013,027,808B; llama-cli b9940 runs OK, writes valid Python, 24.2 t/s prompt / 4.9 t/s gen | **code, knowledge-intensive facts** (MMLU-Pro 79.1, GPQA-D 76.2, LiveCodeBench 55.8, IFEval 89.8 — official Qwen card + Onyx leaderboard) | long-tail facts, vision (unused); thinking mode ON by default -> use `enable_thinking=false` for KD structured output; runs via `--jinja` (native Qwen3.5 template, 262K ctx) | 
| LFM2.5-1.2B-Thinking | `E:\models\lfm2.5-thinking\LFM2.5-1.2B-Thinking-Q4_K_M.gguf` | AUDITED (2026-08-05) | reasoning, instruction-following, tool-calling, data extraction | code, knowledge-intensive facts; must use `--jinja` (native template), temp 0.05, top_k 50, rep_pen 1.05 |
| Qwen2.5-Coder-3B-Instruct | `E:\models\Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf` | **FAILED VERIFICATION (2026-08-05)** — corrupt GGUF, degenerate repeat tokens ("ECT inflouno...") even at `--no-jinja --temp 0` | — | **UNUSABLE.** "peg-native format" error; struct complete (last tensor ends exactly at EOF) but content garbage. Removed from rotation. Card audit moot — file does not run. |
| Phi-3-mini-4k-instruct | `E:\models\Phi-3-mini-4k-instruct-Q4_K_M.gguf` | **FAILED VERIFICATION (2026-08-05)** — corrupt GGUF, "####" degenerate repeats | — | **UNUSABLE.** Removed from rotation. |
| DeepSeek-Coder-1.3b-instruct | `E:\models\deepseek-coder-1.3b-instruct\` (safetensors) | **FAILED VERIFICATION (2026-08-05)** — SHA-256 MISMATCH vs HF tree lfs_sha256 (disk `8eb072ab…`, expected `4ff570bf…`); size identical but content corrupt; live run = token soup (English/Russian/Chinese garbage); same signature in old `data_generation\output\proc_kd_teacher.txt` | — | **UNUSABLE.** Corrupt since download. Removed from rotation. |
| DeepSeek-R1-Distill-Qwen-1.5B | `E:\models\deepseek-r1-distill-qwen-1.5b\` (safetensors) | **FAILED VERIFICATION (2026-08-05)** — SHA-256 MISMATCH vs HF tree (disk `402b6529…`, expected `58858233…`); size identical, content corrupt | — | **UNUSABLE.** Removed from rotation. Not live-tested — hash failure is decisive. |
| kira-14e | `L:\kira_training\phase4\kira-14e-q4_k.gguf` + `L:\kira_model\*` | PROTECTED (unfinished Kimi-K2.5 + DeepSeek merge; never delete/modify/test) | TBD | never usable as teacher until user finishes it; do NOT audit as a usable fleet member |
| LFM2.5-1.2B-Thinking | `E:\models\lfm2.5-thinking\LFM2.5-1.2B-Thinking-Q4_K_M.gguf` | AUDITED + LIVE-VERIFIED (2026-08-05) | reasoning, instruction-following, tool-calling, data extraction | code, knowledge-intensive facts; `--jinja` (native template), temp 0.05, top_k 50, rep_pen 1.05 |

**Fleet status (2026-08-08):** TWO verified-usable teachers: LFM2.5-1.2B-Thinking (reasoning/IF/tool/data-extraction) + Qwen3.5-4B (code/knowledge). The code/knowledge slot is now FILLED (was empty since 8/5; 4 prior downloads failed hash). Download rule: a file is complete ONLY when its SHA-256 equals the tree's `lfs_sha256` (size match is NOT completeness — 4 of 4 prior downloads failed exactly this test; Qwen3.5-4B passed on the first try).

Every new teacher gets a row BEFORE first use. Never distill with an unaudited teacher.

### Per-teacher runtime cheat-sheet (from official cards)

- **LFM2.5-Thinking**: llama-cli `--jinja` (NOT `--chat-template chatml`); parse from first `<think>`; temp 0.05, top_k 50, rep_pen 1.05.
- **Qwen2.5-Coder**: ChatML template (apply via tokenizer or `--jinja`); 32K ctx; works in llama.cpp.
- **Phi-3**: `<|system|>...<|end|>` / `<|user|>...<|end|>` / `<|assistant|>`; 4K ctx; `--jinja` reads embedded template; greedy (temp 0) for structured output.
- **DeepSeek-R1-Distill**: **DEAD (hash-failed 2026-08-05)** — if ever re-downloaded: MUST force `"<think>\n"` at response start or it skips reasoning; temp 0.5-0.7; do NOT add a system prompt; do NOT add "think step by step" coercions (model card warns it breaks them).
- **DeepSeek-Coder-1.3b**: **DEAD (hash-failed 2026-08-05)** — if ever re-downloaded: `<｜begin▁of▁sentence｜>User: ...` template; run via transformers (no `trust_remote_code` needed, plain LlamaForCausalLM, vocab 32022).

## When to Trigger

- Selecting a teacher for any KD run (post-training-distill, kd-corpus-production)
- Choosing what to extract from an already-downloaded teacher
- Building or extending the strength-map of an existing teacher
- Changing a teacher's runtime (new GGUF, new llama.cpp build, new template)
- Auditing whether previously generated traces are in-envelope (re-grade with this skill)
