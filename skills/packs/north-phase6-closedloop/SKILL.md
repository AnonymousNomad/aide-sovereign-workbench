---
name: north-phase6-closedloop
description: Phase 6 — Closed-loop improvement system. Collect failures → research → create skill → retrain if needed. Never repeat failures. The model gets better from real use. Triggers on: failure analysis, improvement, retraining, closed-loop.
---

# Phase 6: Closed-Loop Improvement

## Purpose
The model improves from real use. Every failure is researched, a skill is created, and the failure never repeats. This is how we prevent catastrophe: problems left unattended are problems forgotten.

## Why This Phase Exists
Training installs the personality. Enforcement maintains it. This phase IMPROVES it. Without this, the model stagnates or degrades. With it, every failure makes the model better.

## The Fail-Once Protocol (R8)

When something fails:
1. **STOP** — do not retry blindly
2. **RESEARCH** — logs, errors, documentation, root cause
3. **CREATE SKILL** — write the skill that covers this failure
4. **ACT** — try again with the skill loaded
5. **VERIFY** — confirm the failure doesn't repeat

**One failure is already too many.** Problems left unattended are problems forgotten. Problems forgotten are systems collapsing.

## Step-by-Step SOP

### Step 1: Failure Detection
Failures come from:
- Model produces wrong output (personality drift, hallucination, bad reasoning)
- Model fails to follow workflow (skips planning, doesn't verify, guesses)
- Training regression (new training broke old behavior)
- System failure (server crash, OOM, port conflict)

**Detection sources**:
- Battery test failures
- User reports
- Monitoring logs
- Automated checks

### Step 2: Failure Classification

| Category | Severity | Action |
|----------|----------|--------|
| Personality drift | HIGH | Add corpus examples, retrain |
| Hallucination | HIGH | Add verification examples, retrain |
| Workflow violation | MEDIUM | Create/update skill |
| System failure | LOW | Create failure skill |
| Capability regression | HIGH | Compare before/after, retrain |

### Step 3: Root Cause Research

For each failure:
1. **Reproduce** the failure (get exact error/output)
2. **Examine** logs, context, state
3. **Search** for similar past failures
4. **Identify** root cause (not symptom)
5. **Document** findings

### Step 4: Create Failure Skill

```markdown
---
name: failure-[timestamp]-[short-description]
description: Fix for [failure description]. Auto-created from failure analysis.
---

# Failure: [Description]

## What Failed
[Exact error, context, what was being done]

## Root Cause
[Research findings — why it failed]

## Fix
[Exact steps to fix this specific failure]

## Prevention
[How to prevent this failure in the future]

## Verification
[How to verify the fix works]
```

**Save to**: `C:\Users\Grey_\.agents\skills\failure-[timestamp]-[short-description]\SKILL.md`

### Step 5: Retrain (If Needed)

If the failure is personality-related:
1. Add new training examples to corpus
2. Re-run Phase 3 (fine-tuning)
3. Re-run Phase 4 (export & deploy)
4. Verify fix with battery

If the failure is workflow-related:
1. Create/update skill
2. Verify skill loads and works
3. No retraining needed

### Step 6: Verify Fix

Run the battery again. The failure must not repeat.

```powershell
# Run battery
# Record results
# Compare to previous scores
# If failure repeated: STOP, research deeper, create better skill
```

### Step 7: Log to AGENT_NOTES.md

Record the failure, fix, and verification:
```markdown
## [Date] Failure: [Description]
- **Root cause**: [what research found]
- **Fix**: [what was done]
- **Skill created**: [skill name]
- **Verification**: [battery result]
- **Status**: FIXED
```

## Failure Tracking Template

| Date | Failure | Root Cause | Fix | Skill Created | Verified |
|------|---------|-----------|-----|---------------|----------|
| | | | | | |

## Monthly Review

On the first of each month:
1. Review all failures from the past month
2. Identify patterns (same failure type repeated?)
3. Update skills for common failure types
4. Retrain if personality drift detected
5. Update AGENTS.md if new hard rules needed

## Battery (Verification Gate)

- [ ] Failure tracking template exists
- [ ] Every past failure has a corresponding skill
- [ ] No failure type has repeated more than once
- [ ] Monthly review process defined
- [ ] Retraining path works (if needed)

## Known Issues & Fixes

### Failures keep repeating
- Skill not loaded: check skill loading protocol
- Skill insufficient: rewrite with more specific instructions
- Root cause wrong: re-research the failure
- Model capability gap: may need larger model or different architecture

### Too many failures
- Quality of training data may be insufficient
- Consider expanding corpus with more examples
- Check for overfitting (personality too rigid, loses general capability)

### Retraining breaks old behavior
- Catastrophic forgetting: add old examples to new training data
- Learning rate too high: reduce LR
- Too many epochs: reduce to 1-2 epochs for personality updates

### Skills become outdated
- Review skills quarterly
- Update skills when codebase changes
- Remove skills for problems that no longer exist

## Exit Criteria
- Failure tracking system operational
- Every past failure has a skill
- No repeated failure types
- Monthly review process defined
- Ready for continuous improvement
