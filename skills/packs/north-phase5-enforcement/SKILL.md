---
name: north-phase5-enforcement
description: Phase 5 — Build the workflow enforcement system: AGENTS.md (always loaded), phase-specific skills (load/unload), deterministic hooks (pre-commit, post-edit). Makes the model follow our workflow when we're not there. Triggers on: workflow enforcement, skill system, rules system, discipline system.
---

# Phase 5: Workflow Enforcement System

## Purpose
Personality without workflow discipline is just attitude. This phase installs the SYSTEM that makes the model follow our workflow: plan before act, search before guess, verify before claim, fix every failure.

## Why This Phase Exists
The model can have our personality (Spock/Sheldon/Machiavelli) but still drift without enforcement. This system ensures:
- Rules are ALWAYS loaded (survive context compaction)
- Skills load/unload per task (composable, not overwhelming)
- Hooks block forbidden actions (deterministic, not judgment-based)
- Failures are caught and fixed immediately

## Prerequisites
- Phase 4 PASS (personality model serving)
- Understanding of our 8 hard rules (R1-R8 + R9)

## Architecture

```
┌─────────────────────────────────────────────┐
│            TIER 1: ALWAYS ON                │
│         AGENTS.md (~200 lines)              │
│  Rules R1-R9, Credo, Process Hygiene        │
│  Survives compaction, re-read from disk     │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│         TIER 2: PHASE-SPECIFIC              │
│      Skills loaded per task phase           │
│  Phase 0-6 skills, failure skills           │
│  Unloaded when phase changes                │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│         TIER 3: DETERMINISTIC               │
│         Enforcement Hooks                   │
│  Pre-commit, post-edit, verification gates  │
│  Agent CANNOT bypass these                  │
└─────────────────────────────────────────────┘
```

## Step-by-Step SOP

### Step 1: Create AGENTS.md
Write `E:\aide-sovereign-workbench\AGENTS.md` with all hard rules.

**Contents** (see `AGENTS.md` file for full text):
- R1-R9 rules
- Developer's Credo
- Process Hygiene SOP
- Fail-Once Protocol
- Skill Loading Protocol

**This file is:
- Loaded at EVERY session start
- Re-read after context compaction
- ~200 lines max (longer = reduced adherence)
- Never modified during a task

### Step 2: Create Skill Loading Protocol
Define how skills are loaded/unloaded:

```python
# At session start:
# 1. Read AGENTS.md → always loaded
# 2. Scan skill directory → discover available skills
# 3. Match task to skill description → load matching skill
# 4. Execute task with skill loaded
# 5. On completion → unload skill, keep AGENTS.md
# 6. On failure → load failure skill → fix → unload

# Skills directory: C:\Users\Grey_\.agents\skills\
# Each skill: name, description, instructions, battery
```

### Step 3: Create Enforcement Hooks

#### Hook 1: Pre-Commit Gate
Before ANY commit:
- Run tests → must pass
- Run lint → must pass
- Check no secrets in diff
- Check AGENTS.md not modified without approval

```powershell
# pre-commit.ps1 (run before every commit)
Write-Output "=== PRE-COMMIT GATE ==="

# Check 1: Tests pass
$testResult = npm test 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Output "FAIL: Tests not passing. Fix before committing."
    exit 1
}

# Check 2: Lint clean
$lintResult = npm run lint 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Output "FAIL: Lint errors. Fix before committing."
    exit 1
}

# Check 3: No secrets
$secrets = git diff --cached | Select-String -Pattern "password|secret|token|api_key" -CaseSensitive:$false
if ($secrets) {
    Write-Output "FAIL: Possible secrets in diff. Review before committing."
    exit 1
}

Write-Output "PASS: All gates cleared."
```

#### Hook 2: Post-Edit Gate
After ANY file edit:
- Verify file compiles (if applicable)
- Verify no syntax errors
- Verify types check (if TypeScript)

#### Hook 3: Verification Gate
Before claiming "done":
- Run the phase-specific battery
- All battery tests must pass
- If any fail → load failure skill → fix → re-run battery

### Step 4: Create Failure Skill Template
When a failure occurs, create a skill:

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

### Step 5: Wire into AIDE
Connect the enforcement system to the AIDE orchestrator:
- Session start → read AGENTS.md
- Task received → match skill → load skill
- Task executing → hooks active
- Task complete → verification gate → unload skill
- Failure → create failure skill → fix → re-verify

## Battery (Verification Gate)

- [ ] AGENTS.md exists at project root (~200 lines)
- [ ] AGENTS.md contains all R1-R9 rules
- [ ] Skills directory has all phase skills (Phase 0-6)
- [ ] Pre-commit hook blocks commits with failing tests
- [ ] Post-edit hook catches syntax errors
- [ ] Verification gate prevents premature "done" claims
- [ ] Failure skill creation works (test with a simulated failure)
- [ ] Rules survive context compaction (test by compacting context)

## Known Issues & Fixes

### AGENTS.md too long
- Target ~200 lines
- If longer, split into AGENTS.md (core rules) + phase-specific skills
- The longer the file, the less adherence

### Skills not loading
- Check skill directory path: `C:\Users\Grey_\.agents\skills\`
- Check SKILL.md format (YAML frontmatter required)
- Check description matches task keywords

### Hooks not blocking
- Ensure hooks are executable (not just markdown)
- Test with a deliberate failure to verify blocking works
- Check hook output for error messages

### Rules forgotten after compaction
- AGENTS.md must be re-read from disk after compaction
- Verify: compact context → check if rules still apply
- If not, the file path may be wrong or compaction is too aggressive

## Exit Criteria
- AGENTS.md written and verified
- All skills created and loadable
- Hooks tested with deliberate failures
- Enforcement system operational
- Ready for Phase 6 (closed-loop improvement)
