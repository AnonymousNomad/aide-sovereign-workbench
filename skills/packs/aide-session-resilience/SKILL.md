# Skill: aide-session-resilience

# Session Resilience — Surviving Context Compaction and Restarts

When context compacts or the session restarts, work must not be lost. This skill
ensures continuity through AGENT_NOTES.md as the canonical journal.

## The Problem

- Context windows fill up → old messages compressed/lost
- Session restarts → all in-memory state gone
- Operator returns → needs to know what happened

## The Solution: AGENT_NOTES.md

AGENT_NOTES.md is the durable state store. Every action, decision, and result
gets appended. On session restart, read the tail to understand current state.

## Session Start Protocol

```bash
# 1. Read the last 50 lines of AGENT_NOTES.md
tail -50 AGENT_NOTES.md

# 2. Identify:
#    - What phase was last worked?
#    - What was the last battery result?
#    - What's the next action?
#    - Any T2 entries?

# 3. Check git status
git status
git log --oneline -5

# 4. Check for uncommitted work
git diff --stat
```

## What to Journal

### After every battery run
```
- [TIMESTAMP] agent: PHASE X COMPLETE — BATTERY N/N PASS (actor: agent-name).
  What was verified. Battery: scripts/name-battery.mjs (N/N). NEXT: what's next.
```

### After every commit
```
- [TIMESTAMP] agent: COMMITTED hash — description (actor: agent-name).
```

### After every research finding
```
- [TIMESTAMP] agent: RESEARCH — topic. Finding: what was found.
  Implication: what it means. Action: what to do about it.
```

### After every blocker
```
- [TIMESTAMP] agent: BLOCKER — description. Cause: root cause.
  Workaround: what to do instead. Fix: how to fix it.
```

## Context Compaction Recovery

When context compacts mid-task:

1. Check AGENT_NOTES.md for the last completed action
2. Check git log for uncommitted work
3. Identify the current phase from the phase ladder
4. Resume from the last verified state
5. Never assume — verify before continuing

## Cross-Session Continuity

### T1 (this terminal) owns:
- AIDE product features
- Skills creation
- Batteries and testing
- Git commits and pushes

### T2 (Terminal 2) owns:
- Model training/fine-tuning
- Corpora management
- GPU workloads

### Sync protocol:
- Read T2 entries at session start
- Never touch model files or training scripts
- If T2 announces GPU window, respect one-job law

## Anti-Patterns

- DON'T rely on memory across sessions — journal everything
- DON'T start a new phase without checking what was last done
- DON'T assume battery results from a previous session — re-run if unsure
- DON'T commit without journaling first
- DON'T push without a passing battery
