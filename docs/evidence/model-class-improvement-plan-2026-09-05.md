# Environment-aware model + per-class model improvement plan — 2026-09-05

This is the research + acceptance artifact for the two things the operator asked for in one breath:
1. "the harness in the models that get used inside our aide being aware of the environment they're in" — how do we wire the harness + chat + a tool-calling agent loop so the model can actually see and act on the workspace, not just chat about it
2. "how do we improve every model" — per-class fine-tune plan, not one hammer for every size

The full plan lives in `AGENT_NOTES.md` (entry timestamped 2026-09-05 09:30). This file is a short pointer + the primary sources + the per-class table, so `docs/evidence/` mirrors the prior pattern.

**Why this is happening now:** the operator's exact words were "the harness in the models that get used inside our aide being aware of the environment they're in ... how do we improve every model." This research answers both with primary sources + an audited reading of the current AIDE state.

**Primary sources (current, live, primary):**

1. [Eclipse Theia AI user docs](https://theia-ide.org/docs/user_ai/) — what context Theia injects: active file, selection, file name, repo map; `#` mentions for file/folder/symbol/terminal/tool; MCP context injection (tools grouped by server); Coder agent mode + edit mode; Architect Plan Mode (Understand → Explore → Design → Refine); tool-call confirmation UI.
2. [VS Code Copilot Chat](https://code.visualstudio.com/docs/chat) — implicit context (active file + selection + filename); `#` mentions; `!` terminal; image attachments; browser element selection adds HTML/CSS/screenshot context; tool-call confirmation UI; diffs reviewed before commit.
3. [Cursor](https://docs.cursor.com/agent) — Agent + Thinking + Images capability flags per model; Agent Mode with file edits in diff editors; auto-loads file context.
4. [Anthropic context engineering](https://docs.anthropic.com/en/docs/build-with-claude/context-windows) — "context rot": accuracy and recall degrade as token count grows; curating context is as important as capacity; context awareness on Sonnet 5+; server-side compaction; thinking block clearing.
5. [Hugging Face PEFT LoRA guide](https://huggingface.co/docs/peft) — QLoRA (`target_modules="all-linear"` + 4-bit base), rsLoRA, LoftQ for quantized base, LoRA-FA, LoRA+, MiCA, EVA, PiSSA, CorDA; `find_kappa_target_modules` for condition-number-based target selection; MoE expert parameters via `target_parameters`; post-training `merge_and_unload()`.
6. [Hugging Face TRL DPO Trainer](https://huggingface.co/docs/trl) — DPO algorithm (Rafailov 2023), loss types (sigmoid, hinge, ipo, exo_pair, nca_pair, robust, bco_pair, sppo_hard, aot, apo_zero, discopop, sft, sigmoid_norm), PEFT adapter training, MPO multi-loss combination.

**AIDE state audit (today, `413aeb3`):**

- **Harness scaffold** (`harness/scaffold.mjs:65-121`): L0 PART A credo + L0 PART B FULL Lens (only for ctx ≥ 8192) + L1 FORMAT_CONTRACT + L2 TASK_SOP + L0 micro tier (3 lines, ctx < 8192) + budget enforcer + drift hook. **What's injected: the layer of WHO the model is and HOW to format. What's NOT injected: anything about the user's current project — no file path, no file contents, no selection, no recent edits, no test command, no package.json scripts, no terminal output, no diagnostics, no open tabs.**
- **Operator** (`daemon/operator.mjs:6-25`): reads `workspaceManager.tree(2)` (top 40 entries, JSON-stringified, sliced to 6000 chars) + `gitStatus()` summary + concatenates into a `Workspace context:` prefix on the user message + mode-specific system prompt (ask/plan/agent). **What's injected: a one-shot tree + git at the start of every operator call. What's NOT injected: file contents, selection, recent edits, terminal output, test results, diagnostics.**
- **Model system prompts** (`models/manifest.json` each entry's `system_prompt` field): one-liner per model. Harness wins (prepends to system).
- **No tool calling, no function calling, no MCP, no native tool execution.** The chat handler in `daemon/server.mjs:447` proxies to llama-server; the model can ONLY produce text.
- **The operator's "agent mode"** asks the model to return JSON with `commands: [{program, args}]`, regex-extracts from a fenced json block, forwards to existing `/api/terminal/run approved:true` and `/api/file?path=...`. This is the SEED of a proper agent loop but: no automatic context gathering, no file-content retrieval tool, no selection tool, no diagnostics tool, no real loop (one-shot per call).

**Per-class model improvement table (the operator's "improve every model" — one hammer doesn't fit, so the table is per-class):**

| Class | Model id | Size | Endpoint | Bottleneck | Intervention | Effort | Risk | Expected gain |
|---|---|---|---|---|---|---|---|---|
| A | smollm2-360M | 360M | 8082 | Instruction following at the floor; tool-calling unreliable | SKIP fine-tune. Use micro scaffold (3 lines, no JSON tool calls). Demote to research-only if still weak. | 0 | none | None (already at floor) |
| B | qwen-coder-0.5B | 490M | 8083 | Tool-call format mistakes at 0.5B | QLoRA adapter, rank 16 / alpha 32, 2 epochs, 5e-4 LR, "all-linear" targets, 50-100 examples of golden tool-call trajectories | ~30 min | low | +5-10% on tool-call accuracy |
| C | qwen-coder-1.5B | 1.54B | 8087 | 1.5B at the floor of "real" coding; the operator's regex tool extraction is brittle | QLoRA + DPO, rank 32 / alpha 64, 200-500 SFT examples + 100-200 DPO pairs from real accepted-vs-rejected trajectories, 30% replay buffer | ~1-2 hours per round | medium | +10-20% on coding battery |
| D | north-mini-code-1.0 (30B-A3B MoE, Q2_K_XL) | 30B / 3B active | 8084 / 8092 | Aggressive quantization; 6GB card can't hold optimizer state for 30B | SKIP full fine-tune. Use Q2_K sampling profile (already done per 2026-08-29 cline/T4). If LoRA needed, use LoftQ init + `target_parameters` for MoE expert params | 0 (sampling) / 4+ hours (LoRA) | high | 0 (sampling) / unknown (LoRA) |
| E | aide-cipher-v1 | 4B (DEPRECATED) | 8091 | Replaced by north-mini-code-1.0 | SKIP. No new work. | 0 | none | 0 (deprecated) |
| E' | qwen3-4b-minimax-m2.1-coder (with `thinking_lora_full_f16.gguf`) | 4B | 8090 | Already has an adapter | SKIP new round. Verify existing adapter still works. Re-train with fresh Loop C trajectories if weak. | 0 (verify) / ~2 hours (re-train) | medium | unknown until verified |
| F | granite-3.3-2B / smollm2-1.7B / phi-3.5-mini | 1.7B-3.8B | 8084-8088 (pending) | NOT downloaded yet | SKIP. Download + register + verify on its own slice FIRST. Improve-after-download only when the operator picks a real workflow lane. | 0 | none | 0 (until downloaded) |
| G | BYOK cloud models (OpenAI, Anthropic, Mistral, Groq, OpenRouter, Gemini) | n/a | via /api/providers/chat | Opaque, costs money | NO fine-tune. Improvement is routing — pick the right model for the right task. Already wired. | 0 | none | routing is the lever |
| H | The in-house cipher (`models/aide-house/base.q8_0.gguf` + `frontier-lora.gguf`) | 4B | 8091 (cipher-fast) | Per `aide-cipher-house-model`: base static, LoRA fluid | SKIP new fine-tune until the closed-loop trajectory capture has real data. The LoRA on disk is "current best." Sequenced AFTER the agent loop is live. | 0 (now) / ~2 hours per round (after Loop C has data) | medium (catastrophic-forgetting risk per the cipher skill) | unknown until Loop C is live |

**Build order — 2 vertical slices, one per commit, operator tests in the real UI between slices:**

**Slice A — Environment-aware model (the harness + tool-calling agent loop)**

1. NEW: `harness/context-gatherer.mjs` — reads live workspace state (open tabs, active file text, last git diff, last 20 lines of terminal, current LSP diagnostics). Pure function. Returns a `WorkspaceContext` object. Capped: 2k tokens active file, 500 diff, 200 terminal, 200 diagnostics.
2. MODIFY: `harness/scaffold.mjs` — add a new L3.5 layer: live workspace context, dynamic, capped. Composed AFTER L3 (workspace facts) and BEFORE L4 (session overrides).
3. NEW: `common/contracts/agent-loop.ts` — request/response zod schemas.
4. NEW: `node/src/services/agent-loop.mjs` — the loop: model proposes tool calls in fenced json block, daemon parses, asks user for approval, executes approved ones, feeds results back, loops. Max 8 turns. Stop on `final_answer` or no-new-tool-call.
5. NEW: `node/src/routes/agent-loop.ts` — `POST /api/agent/start`, `POST /api/agent/decision`, `GET /api/agent/status`.
6. Add the 4 tools to the model: `read_file`, `bash`, `search`, `git_diff`. Each tool has a strict JSON schema. Each tool result is sandboxed (path jail, allowlist, max bytes, max time). Each tool call is one approval card.
7. MODIFY: `daemon/operator.mjs` — delegate agent mode to the new agent-loop service (legacy ask/plan paths stay).
8. MODIFY: `models/manifest.json` — update `system_prompt` text only for cipher-fast and qwen3-4b (no new entries).
9. NEW: `tests/in-house-e2e/agent-loop-battery.mjs` — 4 scenarios: read_file, bash, search, git_diff. Each scenario: model proposes, daemon parses, user approves via API, daemon executes, result fed back, model produces final_answer. **All scenarios run with a real cipher engine on 8091.**
10. Veritas gate: full `npm run veritas` green; existing 355/355 arch tests pass; new agent-loop battery passes 4/4.

Commit: `feat(harness): environment-aware model with tool-calling agent loop`

**Slice B — Per-class model improvement plan + Loop C capture (no training yet)**

1. NEW: `docs/evidence/model-class-improvement-plan-2026-09-05.md` (this doc).
2. NEW: `scripts/train-lora-coder.mjs` (or `.py`) — the QLoRA + DPO recipe for qwen-coder-0.5B and 1.5B. Recipe is the SPEC; no training in this slice.
3. NEW: `harness/loop-c-capture.mjs` (or extend `harness/cipher-state.mjs`) — every agent-loop turn writes to `.aide/trajectories/YYYY-MM-DD/<id>.traj.json` with model id, proposed tool calls, approvals/rejections, results, final answer, gate results. This is the raw material for the next LoRA round. **No training in this slice.**
4. Skip classes A, D, E, E', F, G, H from this slice (documented in the per-class table above).

Commit: `docs(plan): per-class model improvement plan + loop-c capture wiring`

**Branch:** `feat/environment-aware-model` (off `t1/strict-pass-batch`).

**Per-slice gate:** focused run of the new battery + full `npm run veritas` + `npm test` (355-test arch suite must stay green) + push + watch CI green before the next slice.

**What I will NOT do in this slice (out of scope, parked):**
- The Covert rename (separate branch).
- The Tauri cross-platform packaging (separate branch).
- The cockpit UI rebuild (separate branch, parked after the operator reversed the prior attempt).
- Real MCP integration (future).
- A new fine-tune round for the in-house cipher (waits for Loop C).
- iOS/Android packaging (need Mac + Apple account + Android keystore).

**Threats and traps I will not let happen (per R8):**
- **No "I think this will work" claims.** Every slice is verified by a real operator session: open the chat, ask the model to do something, watch it propose, approve, see the result, verify the workspace actually changed.
- **No bypassing the approval gate.** The model proposes, the operator decides. Every time.
- **No model is "improved" by hand-waving.** Per-class plans are grounded in the audited bottleneck + the verified 2026 research. A row that says "skip" is also a plan.
- **No silent skip on tests.** If a slice's verification test would have to be skipped, the slice is not done.
- **No killing the engine while a slice is verifying.** Process-hygiene P7.
- **No starting a fine-tune during a working session.** Train at idle.

The full plan with all details, threats, traps, and commit hygiene lives in `AGENT_NOTES.md`. The next move is operator sign-off, then slice A.
