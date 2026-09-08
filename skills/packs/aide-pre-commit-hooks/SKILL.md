# Skill: aide-pre-commit-hooks

# Pre-Commit Verification Hooks

Before every commit, run verification to ensure nothing breaks. This is the
last line of defense against shipping broken code.

## Pre-Commit Checklist

Every commit MUST pass ALL of these before `git commit`:

### 1. No stray processes
```powershell
Get-Process -Name "llama-server","node","python" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match "aide|llama" } |
  Select-Object Id, ProcessName, CommandLine
```
If any stray processes found → kill them first.

### 2. Battery passes
```bash
node scripts/<phase>-battery.mjs
```
ALL probes must pass. If any fail → fix before committing.

### 3. No secrets in diff
```bash
git diff --cached | Select-String -Pattern "password|secret|token|key|dpapi"
```
If any matches → remove before committing.

### 4. No test files committed without verification
```bash
git diff --cached --stat | Select-String -Pattern "test|spec"
```
If test files changed → run the test suite first.

### 5. AGENT_NOTES.md updated
```bash
git diff --cached --stat | Select-String -Pattern "AGENT_NOTES"
```
If NOT updated → add journal entry before committing.

## Commit Message Format

```
<type>(<scope>): <description> — battery N/N

Types:
  feat     — new feature
  fix      — bug fix
  test     — test/battery addition
  docs     — documentation only
  chore    — maintenance, dependency update

Scope:
  security, plugins, workbench, a11y, diff, context, packaging,
  grammar, session, ux, model, hooks

Description:
  - What changed (imperative mood)
  - Why it changed (if not obvious)
  - Battery result (if applicable)
```

Examples:
```
feat(a11y): ARIA landmarks + keyboard nav — battery 14/14
fix(diff-repair): fence normalization for 3-char markers — battery 7/7
test(rag): context intelligence verification — battery 6/6
```

## Post-Commit Verification

After committing, always:

1. Push to remote
2. Verify push succeeded
3. Update AGENT_NOTES.md with commit hash
4. Note next action in journal

## Emergency Rollback

If a commit breaks something:

```bash
# Last commit only
git revert HEAD
git push

# Specific commit
git revert <hash>
git push

# Nuclear option (DANGER — only if nothing pushed)
git reset --hard HEAD~1
```

NEVER force-push to main. Always use revert.
