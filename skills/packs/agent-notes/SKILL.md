---
name: agent-notes
description: Agent Persistence System — the mandatory project journal. Use at the START of every session and every context compaction, and after EVERY task, change, decision, or event in this project. Maintains the canonical AGENT_NOTES.md so no work is ever lost across sessions. Overrides default behavior: any action that is not appended to AGENT_NOTES.md is considered incomplete.
---

# Agent Notes — Persistence Protocol

You are operating under the Agent Persistence System. The project memory lives in `AGENT_NOTES.md` (project root). This file is the single source of truth across all sessions, compactions, and agents. Nothing is remembered between sessions EXCEPT what is written here.

## Core Rules

1. **READ FIRST.** At the start of every session and every context compaction, read `AGENT_NOTES.md` before doing anything else. Orient from its most recent entries.
2. **WRITE AFTER EVERY ACTION.** After completing ANY task, change, decision, check, or event, append an entry to `AGENT_NOTES.md`. If you did not append an entry, you did not finish the task.
3. **NEVER REWRITE HISTORY.** Append new entries at the top of the log (newest first) OR at the top of a clearly-marked running-log section. Never edit or delete prior entries — they are the audit trail.
4. **TIMESTAMP EVERYTHING.** Every entry must carry a timestamp in the exact format `YYYY-MM-DD HH:MM` using the current date. (The environment reports today's date; use it.)
5. **WHO DID IT.** Every entry must name the actor: `human` (the user) or the agent name (e.g. `opencode`, `subagent`). Attribute decisions to the human, actions to the agent that performed them.
6. **BE DETAILED AND CONSISTENT.** Vague entries are worse than no entries. Include: what, why, how, files touched, numbers, outcomes, and next steps. Use the exact section structure below.

## Entry Format (append these blocks at the top of the running log)

```
---
## [YYYY-MM-DD HH:MM] Actor: <human|agent-name>
**Type:** task | decision | event | bug | checkpoint | update | audit | note
**Status:** in-progress | done | blocked | cancelled | verified
**Summary:** one clear sentence
**Details:** what was done, why, how — include paths, commands, numbers, errors
**Files:** /path/to/file — what changed
**Next:** what happens next, by whom, when
---
```

If the summary + details are short, a compact single-line entry is acceptable but must still contain the timestamp, actor, type, and status:

```
- [2026-08-02 14:05] agent: checked training — step 82,801/100k, val 1.1574, healthy. done.
```

## Current-Status Section

`AGENT_NOTES.md` maintains a `## CURRENT STATUS` section near the top (below the header, above the running log). It must always reflect reality. After every significant event:

1. Read the current status block.
2. Update it in place with the newest state (this is the ONE place in-place edits are allowed — it is a summary, not history).
3. Still append the full entry to the running log.

## What Must Be Logged (non-exhaustive)

- Training runs: start time, PID, step, loss, val_loss, speed, ETA, stop/crash reason
- Any script written, edited, or deleted — with path and purpose
- Any new training document / dataset / corpus change — path, size, format, purpose
- Model architecture changes and parameter counts
- Checkpoint saves: path, step, val_loss
- Bugs found and fixes applied (root cause + fix)
- Decisions made by the human and the reasoning
- Skill creations/edits (this file, others)
- Audits performed and their findings
- All four model tracks: 7M tablet, 16.5M, 200M, 350M — their states, issues, next steps
- Anything that would be needed to resume work after a crash or a new session

## When You Cannot Write (rare)

If `AGENT_NOTES.md` is missing, create it with the canonical structure (see `references/template.md`). If the file is locked or unwritable, say so out loud and record the entry in the next available write — never silently skip.

## Canonical File Location

- **Notes file: `E:\FSI-FELON\AGENT_NOTES.md`** (master, repo root — all FSI-FELON models consolidated here 8/2).
  - `E:\queen-bee-v5\AGENT_NOTES.md` is now a redirect pointer only (trek model lives there physically during training).
  - When creating the notes file for a DIFFERENT project: `<project_root>/AGENT_NOTES.md`.
- Skill file: `C:\Users\Grey_\.agents\skills\agent-notes\SKILL.md`
