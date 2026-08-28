---
name: aide-workflow-gap-roadmap
description: The full competitive gap analysis for AIDE's workflow / orchestrator / architecture, ordered by leverage × effort. Use when planning workflow features; when comparing AIDE to Cursor/VS Code/Claude Code/Cline/Aider/Windsurf; when designing subagents, hooks, custom modes, or auto-memory; when triaging what to ship next. Born 2026-08-28 from Cursor/VS Code/Claude Code/Cline/Aider/Windsurf/Replit research, focused on what AIDE does NOT have that every rival converges on.
---

# Workflow + Orchestrator + Architecture — Gap Roadmap

Born 2026-08-28: a competitive audit of AIDE's workflow surface vs.
Cursor, VS Code, Claude Code, Cline, Aider, Windsurf, Replit.
Result: 6 gaps ranked by leverage × effort. Three are doctrinal
(no code, just skills) and three are engineering (need real work).
This skill is the canonical prioritization for the next 3-6 months.

## Research base (verified 2026-08-28)

Web research summary, see AGENT_NOTES 2026-08-28 for full
extraction. The 7 rivals all converge on the same architectural
table-stakes:

- Plan/Act mode (every rival)
- Subagents / task delegation (every rival except Aider — Aider
  uses architect+editor instead)
- Persistent memory across sessions (every rival)
- Hooks (Cursor, VS Code, Claude Code, Cline)
- MCP (every rival except Aider)
- Custom modes / harnesses (Cursor, VS Code, Claude Code, Cline,
  Windsurf)
- Plan approval card (every rival)
- Checkpoints / rollback (every rival)
- Background tasks (Cursor, Claude Code, Replit, Windsurf)
- Permissions / approval (every rival)
- Architect→Editor split (Aider — and the principle is the same
  one in the others, just hidden)
- Worktree isolation / shadow workspace (Replit, partially
  Cursor)

AIDE's audit results (the matrix; what we have vs. what we
don't):


## Gap #1 — Architect→Editor split (HIGHEST LEVERAGE)

**Status**: skill `aide-architect-editor-pattern` exists, no code.

The single biggest workflow improvement. Aider's architect/editor
mode ships with one goal: "Certain LLMs aren't able to propose
coding solutions and specify detailed file edits all in one go.
For these models, architect mode can produce better results." We
have cipher v1 (4B) which is exactly that case.

**Effort**: medium. Modify `agent-loop.mjs` to support
`architectEditor: true` mode. Add `agent:plan` event. Add
`/architect` slash command. ~150 lines of code + 80 lines of
test. **Implement this session.**

## Gap #2 — Subagent dispatch

**Status**: aspirational. `aide-agent-harness-convergence` skill
exists with a contract. No `spawnSubagent` route, no
delegation path in the orchestrator.

The 2026 standard: Cursor Subagents, Claude Task tool, Cline
Agent Teams, Replit Task system. A long task is broken into
parallel subagents, each with its own context, tool set, and
budget. The parent coordinates.

**Why it matters**: any task that touches >5 files is a
subagent job today. AIDE's agent loop has a 80-message cap and
serial execution. Subagents are the only way to scale.

## Gap #4 — Auto-memory across sessions

**Status**: ⚠️ partial. `harness/memory-spine.mjs` exists, the
chat uses memory blocks, but the cross-session auto-memory
(Cursor Rules / Claude `CLAUDE.md` / Replit `replit.md`) isn't
in place.

The pattern: at the end of every session, summarize what was
learned (preferences, project conventions, file locations,
frequently-used commands) into a `.aide/memory/<scope>.md` file.
On the next session's first chat, inject that file into the
system prompt.

**Why it matters**: this is the #1 "feels like a real partner"
feature in every rival. The operator's preferences and the
project's conventions become persistent.

**Effort**: small. `daemon/handoff.mjs` already does session
handoffs. Extend it to extract "preferences" + "conventions"
sections into `.aide/memory/`. ~100 lines + 50 lines of test.

## Gap #5 — Custom modes / harnesses registry

**Status**: ❌ one harness only.

A "harness" is a named bundle of (system prompt, model role,
tool whitelist, approval policy). Today AIDE has one: the
offline agent. A real IDE needs:
- `default` (the current one)

## Order of attack

The four "ship next" gaps in order, each as a separate
commit:

1. **Gap #1 — Architect/Editor pattern** (this session)
2. **Gap #4 — Auto-memory** (next session, smallest, biggest UX win)
3. **Gap #3 — Plan-mode tool whitelist + worktree** (security)
4. **Gap #2 — Subagents** (capability, depends on #1)
5. **Gap #5 — Custom modes** (operator UX, depends on #2)
6. **Gap #6 — Hooks** (workflow integration)

Each gap has its own skill (Gaps #1, #3, #5, #6) or expansion
of an existing one (#2, #4) to be created at the time of
implementation.

## Verification

After each gap is shipped, the test that proves it works lives
in `tests/arch/`. The arch battery (`scripts/run-arch.mjs`)
must stay green.

## Pitfalls

- **Do NOT chase every gap at once.** Each is a separate skill
  for a reason. The skill-curation law is: one gap = one
  session = one commit = one PR (or one commit per gap in our
  case).
- **Do NOT let Gap #5 (custom modes) creep into Gap #1.** The
  patterns look similar but they're orthogonal. Architect/Editor
  = a per-call mode. Custom modes = a per-session tool whitelist.
- **Do NOT adopt "subagents" without the worktree isolation in
  Gap #3.** A subagent that mutates your main branch is
  dangerous. The two ship together or not at all.
- **Do NOT skip the auto-memory extraction.** The whole point of
  Gaps #4-#5 is that the IDE gets smarter over time. Without
  memory, every session starts from zero.

- `architect` (just Gap #1)
- `test-writer` (read + write test files only)
- `reviewer` (read + post comments; no writes)
- `debug` (read + run_command + write source only)
- `desktop` (the desktop policy + tools)

The cockpit can then let the operator pick a harness per
session. Each harness has a YAML manifest in
`.aide/harnesses/<name>.yaml`.

**Why it matters**: this is the "I trust this with file X but
not file Y" workflow that VS Code's agent harnesses and
Cursor's custom modes ship. The operator picks the
right tool for the right job.

**Effort**: medium. Schema for the manifest, a registry
loader, the harness picker in the agent loop, the cockpit
dropdown. ~300 lines + 100 lines of test.

## Gap #6 — Hook system

**Status**: ⚠️ skeleton. `common/contracts/notifications.ts`
defines event types. No runner. No `pre/post` binding to scripts.

A hook is: "after every tool call, run `prettier --write` on
the file." Or: "before every `run_command`, run a security
scan." Or: "after every successful commit, post to a webhook."

The system: `~/.aide/hooks/<event>.yaml` lists scripts to run.
The agent loop, before/after each tool call, executes the
hooks. The output is captured into the trajectory. Exit
non-zero = warn the operator, do not fail the tool call.

**Why it matters**: this is the "make the IDE match the
team's workflow" feature. Every serious rival has it.

**Effort**: medium. The runner is a thin shell-out wrapper. The
manifest format is YAML. The integration point is
`agent-loop.mjs`'s `dispatchTool` and `daemon/server.mjs`'s
session lifecycle. ~250 lines + 80 lines of test.


**Effort**: medium-large. New route `/api/agent/subagent` with
`{task, role, model, sandbox}`. The parent session's
`dispatchTool` adds a `subagent_spawn` tool. The child session
runs in a worktree copy. Results return as a summary. ~400
lines of code.

**Prerequisite**: Gap #1 (architect/editor) — the subagent
itself benefits from the same pattern.

## Gap #3 — Plan-mode tool whitelist + worktree isolation

**Status**: ⚠️ plan mode is set but unenforced. No worktree copy.

Two distinct sub-gaps:

1. **Tool whitelist**: in plan mode, the agent should only be
   able to call read-only tools (`read_file`, `list_dir`,
   `search`, `desktop_action` with read-only op like
   `list_windows`). Today: any tool can be called. Fix: the
   agent loop checks `mode === 'plan'` and rejects non-read-only
   tool calls with a `PLAN_MODE_TOOL_REJECTED` error.
2. **Worktree isolation**: when the user switches from plan to
   act, the agent should commit the current workspace state to
   a shadow branch and operate on a worktree copy. If the user
   rejects the result, the worktree is discarded; if approved,
   the changes are merged back. This is the cursor "shadow
   workspace" pattern and Replit's `Workspace`.

**Effort**: small for #1 (~50 lines), medium for #2 (~200 lines +
git plumbing). The full Gap #3 ships in 2 PRs.

| Feature | AIDE | Rival norm |
|---|---|---|
| Plan/Act mode | ⚠️ partial — mode is set but plan-mode tool whitelist is unenforced | full |
| Subagents | ❌ aspirational (skill only) | full |
| Persistent memory | ⚠️ per-session only; auto-memory not wired into prompt | full |
| Hooks | ⚠️ skeleton (event types defined, no runner) | full |
| MCP | ⚠️ skill only (aide-mcp-inbox-surface) | full |
| Plan approval card | ✅ built | full |
| Skills / slash commands | ⚠️ commands route + parser, no /commands UI surface | full |
| Checkpoints | ✅ built | full |
| Background tasks | ⚠️ shell jobs only; no backgrounded agent | full |
| Permissions / approval | ✅ built | full |
| Custom modes / harnesses | ❌ one harness only (offline) | full |
| Architect→Editor split | ❌ one-call only | full (Aider explicit) |
| Worktree isolation | ❌ | full (Replit) |
| Conventions file (CLAUDE.md equiv) | ✅ harness/credo.md | full |
