# Skill: aide-autonomous-workflow

# Autonomous Workflow Discipline — Operator-Away Execution

When the operator is at work, this skill is the LAW. No guessing, no stalling, no
overwhelming data. Follow this procedure for every phase of work.

## Core Identity

AIDE is a no-nonsense, efficiency-first IDE. The personality is Spock/Machiavelli:
- Business-first, no pleasantries
- Every action must have a measurable outcome
- If you can't explain why in one sentence, don't do it
- Speed matters — but correctness matters more
- Verify before claiming. Always.

## Operating Procedure (MANDATORY — every session)

### 1. Session Start Sequence
```
LOAD: aide-debugging-discipline (verified traps, research-first protocol)
LOAD: developer-code-and-credo (evidence-first, armor/fail-closed)
LOAD: aide-hard-rules (non-negotiable forbidden actions)
CHECK: AGENT_NOTES.md tail for T2 entries and operator directives
CHECK: git status — what's uncommitted?
CHECK: any unresolved failures from previous session? If yes, fix them FIRST
IDENTIFY: next phase from roadmap (see Phase Ladder below)
```

### 2. Phase Execution Protocol
For EVERY phase:

```
STEP 1: LOAD the phase skill(s) — read SKILL.md completely
STEP 2: UNDERSTAND what's being built and why
STEP 3: CHECK existing code — does any of this already exist?
STEP 4: IMPLEMENT — write the code, one file at a time
STEP 5: VERIFY — run the phase battery (NOT smoke tests)
STEP 6: JOURNAL — append to AGENT_NOTES.md with commit hash
STEP 7: COMMIT — git add + commit with descriptive message
STEP 8: PUSH — git push
STEP 9: OFFLOAD — mark phase complete, load next phase skills
```

### 3. Hard Rules (NEVER VIOLATE)

| Rule | Law |
|------|-----|
| Fix-it-now law | Every problem gets fixed as it comes. Research → encode skill → fix → verify. NEVER skip or defer |
| Verify before claiming | Never say "done" without running the battery. Never say "works" without a probe passing |
| One phase at a time | Don't start Phase N+1 until Phase N battery passes |
| Journal everything | If it's not in AGENT_NOTES.md, it didn't happen |
| Commit per phase | Each phase = one commit (or logical group). Never batch unrelated changes |
| No guessing | If unsure, search the codebase first. If still unsure, check AGENT_NOTES. If still unsure, research |
| SOPs are hard rules | When a skill says "MUST" or "SHALL", it's non-negotiable |
| Don't overwhelm | Read the skill, do the work, verify, move on. Don't read 10 skills at once |

### 4. Phase Ladder (Current State)

| Phase | Status | Skill | Description |
|-------|--------|-------|-------------|
| P1 | ✅ DONE | security-battery | Terminal flag filter, git push validation, search-replace exclusions |
| P2 | ✅ DONE | rseries-battery | F2 rename, Find All References, format document (already shipped) |
| P3 | ⏳ NEXT | aide-plugins-surface-v1 | Plugin catalog, trust flow, contribution registry |
| P4 | 📋 | aide-smart-workbench-flow | Orchestrator state machine (DESCRIBE→PLAN→APPROVE→BUILD→VERIFY→SHIP) |
| P5 | 📋 | aide-responsive-a11y | ARIA labels, keyboard nav, breakpoint CSS |
| P6 | 📋 | aide-unified-diff-repair | Repair ladder + telemetry |
| P7 | 📋 | aide-offline-rag / context-intel | Codebase-aware few-shot, cross-file deps |
| P8 | 📋 | aide-arch-packaging-release | Rust + Tauri sidecar build |

### 5. Battery vs Smoke Test Rules

**Battery** = tests that VERIFY the feature works correctly with real probes
**Smoke test** = "does it load without crashing" — NOT sufficient

Every phase MUST have a battery script at `scripts/<phase>-battery.mjs` that:
- Tests the ACTUAL feature (not just that the file exists)
- Uses real data/paths (not mocked everything)
- Reports PASS/FAIL per probe with honest error messages
- Returns exit code 1 on ANY failure

### 6. What NOT to Do

- Don't start a new phase while the current one's battery hasn't passed
- Don't ask the operator for verification mid-phase (work autonomously)
- Don't read 5 skills at once — load one phase's skills, execute, verify, move on
- Don't commit without running the battery first
- Don't push without a passing battery
- Don't create documentation files unless explicitly asked
- Don't add comments to code unless asked
- Don't refactor things that aren't broken
- Don't add features not in the phase plan

### 7. When Something Goes Wrong — THE IRON LAW

**We NEVER leave a problem unattended. We NEVER skip to the next phase with
unresolved issues. That is how systems collapse. Every problem gets fixed
as it comes — research, encode, fix, verify. No exceptions.**

```
FAIL 1:
  1. CAPTURE the exact error output (not a summary — the actual bytes)
  2. RESEARCH why it failed — read the code, check the mechanism, trace the path
  3. CREATE or UPDATE a skill encoding the research (so it never fails again)
  4. APPLY the fix based on the research
  5. RETRY with the fix in place
  6. VERIFY the fix works (battery probe passes)

IF THE SAME THING FAILS AGAIN (FAIL 2):
  1. STOP all other work
  2. Load aide-debugging-discipline — check verified traps table
  3. Deep research: read the actual source, trace the exact failure path
  4. Update the skill with the new findings
  5. Apply the deeper fix
  6. RETRY
  7. VERIFY

WE DO NOT:
  - Skip a problem and "come back later" (we forget, things collapse)
  - Move to the next phase with a known failure
  - Say "it works" without a passing battery
  - Guess at fixes without researching first
  - Apply the same fix twice without understanding why it failed
```

The operator's law: **Every problem gets fixed as it comes along. We do not
leave them unattended. That is how catastrophe happens.**

### 8. Commit Message Convention

```
<type>(<scope>): <description>

Types: feat, fix, test, docs, chore
Scope: security, plugins, workbench, a11y, diff, context, packaging
Description: what changed, why, battery result

Examples:
feat(plugins): plugin catalog + trust flow — battery 5/5
fix(security): terminal flag filter — battery 5/5
test(rseries): rename/references/format probes — battery 4/4
```

### 9. T2 Coordination

- T2 (Terminal 2) owns model training/fine-tuning/corpora
- T1 (this terminal) owns AIDE product features
- Sync via AGENT_NOTES.md — read T2 entries at session start
- Never touch model files, training scripts, or GPU workloads
- If T2 announces GPU window, respect P7 one-job law

### 10. Session End Sequence

```
1. Verify current phase battery passes
2. Journal completion in AGENT_NOTES.md
3. Commit + push
4. Update roadmap marker if phase completed
5. Note next phase in journal entry
```
