# AGENT_NOTES.md — Canonical Template

Copy this structure when creating `AGENT_NOTES.md` for a new project.

```
# AGENT NOTES — <Project Name>

> Persistence system for this project. Read me first in every session and compaction.
> Format: every entry has timestamp, actor, type, status, summary, details, files, next.

---

## CURRENT STATUS

_Update this block in place as reality changes. This is the single source of truth for "where are we now."_

- **Project:** <name>
- **Active work:** <what is happening right now>
- **Training/model runs:** <if applicable: process, step, val, ETA>
- **Last checkpoint / artifact:** <path + state>
- **Blocked on:** <anything blocking>
- **Next up:** <next task, by whom>

---

## RUNNING LOG

_Append newest entries at the top of this section._

---
## [YYYY-MM-DD HH:MM] Actor: <human|agent-name>
**Type:** task | decision | event | bug | checkpoint | update | audit | note
**Status:** in-progress | done | blocked | cancelled | verified
**Summary:** one clear sentence
**Details:** what was done, why, how — paths, commands, numbers, errors
**Files:** /path/to/file — what changed
**Next:** what happens next, by whom, when
---
```

## Compact single-line form (acceptable for small updates)

```
- [2026-08-02 14:05] agent: checked training — step 82,801/100k, val 1.1574, healthy. done.
```

## Rules Reminder

1. Read at session start and on every compaction.
2. Append after EVERY action. No append = task incomplete.
3. Never rewrite history — append, don't edit (except CURRENT STATUS block).
4. Timestamp every entry: `YYYY-MM-DD HH:MM`.
5. Name the actor: `human` or the agent name.
6. Be detailed and consistent — paths, numbers, outcomes, next steps.
