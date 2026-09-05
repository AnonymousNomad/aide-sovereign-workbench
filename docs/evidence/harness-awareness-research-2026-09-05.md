# Harness awareness research + 3-slice plan — 2026-09-05

This is the research + acceptance artifact for "the harness and the model being aware of the environment" — the next layer on top of slice A (the agent loop), which shipped the skeleton but not the awareness.

**Why this is happening now:** the operator said "the engine loads, the chat works, what's next? The harness. The whole workflow. The awareness." The engine + 6-tool loop are in place. The research is the next layer.

**Primary sources read (current, live, primary):**

1. [AGENTS.md open standard](https://agents.md/) — Linux Foundation/AAIF, 60k+ projects. A predictable place for agent context (build/test commands, code style, do-nots). Nearest-file-wins. 32 KiB cap. One AGENTS.md works across Codex, Jules, Aider, Goose, Zed, VS Code, Cursor, RooCode, etc.
2. [Anthropic "Effective context engineering for AI agents"](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (Sep 29 2025) — the shift from prompt engineering to **context engineering**. Three long-horizon techniques: compaction, structured note-taking, sub-agent architectures. Hybrid pattern (Claude Code): drop CLAUDE.md up front, use glob/grep just-in-time to navigate.
3. [Anthropic Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) (2026-09) — be clear and direct; add context (the WHY); 3-5 examples; XML tags; long-context: data at top, query at end (up to 30% better); tools minimal overlap; parallel tool calls; "by default, implement changes."
4. [Cursor](https://docs.cursor.com/agent) — Agent + Thinking + Images per model. Agent Mode with file edits in diff editors; auto-loads file context.
5. `aide-harness-prompt-scaffolding` skill (local, audited 2026-08-24) — L0/L1/L2/L3/L4 layered composer; budget 80 lines / 2.5KiB small, 150 / 6KiB strong; byte-deterministic.

**Diagnosis (why slice A's loop is a starter, not the final design):**
- Slice A shipped a **pull model** — the model must propose the path, the command, the regex. On cipher 4B Q8_0 on 6GB VRAM at 5-15 tok/s, the model can't reliably guess paths. The first turn asked to read `app.js`; it proposed the right path. But that's contrived. In real work the model would guess wrong, the operator would reject, the loop would burn budget.
- The research is clear: **just-in-time context** beats pre-loaded context. Claude Code, Cursor, and Theia Coder all do "model asks for paths via tools; daemon returns content." Slice A has `read_file(path)` and `list(path)` which are exactly those primitives, but the model doesn't know to call them because the live context it sees is too small (370 tokens) to discover what's in the workspace.
- The **operator-style workflow** the operator described — "read app.js, edit, save, run tests, see the diff" — needs the model to be able to: (1) see the workspace tree, (2) read a file by path, (3) write a file, (4) run a shell command, (5) read the diff, (6) read the test output. Slice A has all 6 of these. What's missing is the **glue**: the system prompt that tells the model what tools it has, and the auto-context that feeds tool results back.

**Acceptance plan — what "environment-aware model" MUST look like in 2026:**

The model sees a small but precise system prompt. It has tools. It navigates by asking. The operator approves each step. Nothing new architecture-wise — slice A is the skeleton. The work is: tighten the harness, add the missing system context, and reframe the prompt so the model knows what tools it has and when to use them.

1. **Workspace tree as a tool, not a context section.** Don't dump the tree into the prompt. Add a `list` tool that returns the directory tree on demand. The model calls `list` when it doesn't know where to look. (This is the Theia + Cursor pattern: metadata on demand.)
2. **Search as a tool, already done.** Slice A has `search(query, icase?, regex?, mask?)`. The model uses it to find files by name or content.
3. **Read file by path, already done.** `read_file(path, start_line?, end_line?)`.
4. **Write file, already done.** `write_file(path, content)`. The model diffs what it wrote.
5. **Bash, already done.** `bash(program, args)` with the allowlist. Auto-append last 20 lines of stdout to next turn.
6. **Git diff, already done.** `git_diff(path?)`.
7. **System prompt v2.** Combine the static scaffold (PART A credo, format contract, task SOP) with a compact, version-stamped **tool guide** that tells the model what tools it has and when to use them. Total budget: **80 instruction lines / ~2.5KiB for local small models** (per IFScale arXiv 2507.11538, the verified sweet spot). Current tool guide is 225 chars (~56 lines). Total ~70 lines. No change needed to the static scaffold.
8. **AGENTS.md at the repo root.** Per the AGENTS.md open standard, AIDE should ship a project-level `AGENTS.md` (a la 60k+ projects). Captures: how to install, how to test, code style, what NOT to touch, the loop. The agent loop reads it on every session and includes it in L4 (session overrides). The model now has project-specific context the way Claude Code's CLAUDE.md gives Claude Code.
9. **Auto-context after tool execution.** When a `write_file` completes, append a `git diff` of the file as a system note in the next turn. When a `bash` completes, append the last 20 lines of stdout. This gives the model "you just did X, here's the result" without bloating the system prompt.
10. **Operator approval card flow stays.** Every tool call is one approval card. Theia + Anthropic + VS Code all enforce this. Non-negotiable.

**Build order — 3 slices, each a single commit, operator tests in a real browser between slices:**

**Slice A1 — Tool guide v2 + AGENTS.md + workspace tree on demand**
- NEW: `AGENTS.md` at the repo root.
- MODIFY: `harness/agent-loop.mjs` — rewrite the `TOOL_GUIDE` with "When to use this tool" guidance.
- MODIFY: `daemon/server.mjs` — read project's `AGENTS.md` on session start, inject as L4.
- NEW: `tests/in-house-e2e/harness-battery.mjs` (10 scenarios).
- Veritas: 355/355 arch + 23 agent-loop + 10 new harness = no regression.
- Commit: `feat(harness): tool guide v2 + AGENTS.md + workspace tree on demand`

**Slice A2 — Auto-context append after tool execution**
- MODIFY: `harness/agent-loop.mjs` — write_file success → append git diff; bash success → append last 20 lines of stdout; read_file on missing file → error with close-matches suggestions.
- NEW: `tests/in-house-e2e/auto-context-battery.mjs` (6 scenarios).
- Veritas: no regression.
- Commit: `feat(agent-loop): auto-append tool result context (diff + tail + close-matches)`

**Slice A3 — Operator observation surface**
- NEW: `GET /api/agent-loop/:id/trace` — returns full session history.
- NEW: `GET /api/agent-loop/:id/cost` — returns token count.
- NEW: `tests/in-house-e2e/agent-loop-trace-battery.mjs` (4 scenarios).
- Veritas: no regression.
- Commit: `feat(agent-loop): trace + cost endpoints for operator observation`

**What I will NOT do in these slices (out of scope, parked):**
- Covert rename (separate branch).
- Tauri cross-platform packaging (separate branch).
- Cockpit UI rebuild (separate branch; the operator reversed my prior attempt; legacy `app.js` is fine for now).
- Real MCP integration (aLoRA-style; future).
- New fine-tune rounds (per-class plan in slice B of the prior research; waits for closed-loop trajectory capture).
- iOS/Android packaging (need Mac + Apple account + Android keystore).
- Workspace tree dump in the prompt (this is what the research explicitly says NOT to do).

**Threats and traps I will not let happen (per R8):**
- **Don't dump the workspace tree into the system prompt.** The research is unanimous: expensive, goes stale, bloats the prompt. Tools on demand. This is the #1 lesson from Anthropic's context engineering post.
- **Don't make the harness bigger to compensate for a small model.** The 2026-08-25 battery proved the full scaffold is poison for sub-1B models. Keep the scaffold small; let the tools carry the load.
- **Don't auto-approve tool calls.** Every call is one approval card. Theia + Anthropic + VS Code all enforce this. Non-negotiable.
- **Don't start engines while testing.** Process-hygiene P7.
- **Don't change the agent loop's tool implementations.** Slice A shipped correct executors with path-jail, allowlist, and timeout. Tightening the prompt is not the same as changing the executors.
- **Don't break the 355/355 arch tests or the 23 agent-loop battery.** All three new slices are additive.

**Branch:** `feat/harness-awareness` (off `feat/environment-aware-model`). Each slice = 1 commit.

The full plan with all details, threats, traps, and commit hygiene lives in `AGENT_NOTES.md`. The next move is operator sign-off, then slice A1.
