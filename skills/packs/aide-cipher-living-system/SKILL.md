---
name: aide-cipher-living-system
description: Implementation spec for Cipher as a living system — cipher-state.jsonl unified event bus, sandbox execution loop for TASK proposals, [learned] context injection from accumulated outcomes, preference memory from approvals/rejections. This is NOT research — this is the build spec. Use when implementing any part of the learning loop, state bus, or adaptive scaffold.
---

# Cipher Living System — Build Spec

## 1. State Bus (.aide/cipher-state.jsonl)

Every meaningful event appends one JSON line. All components query relevant
entries. Replaces scattered logs with unified queryable state.

Event types:
- approval {tool, path, decision}
- rejection {tool, path, reason}
- gate {gate, passed, duration_ms}
- ship {commit_sha, files_count, intent}
- phase {from, to, engine}
- preference {pattern, direction}
- error {source, message}

Query helper: `readState(workspace, {type?, since?, limit?})` returns filtered entries newest-first.

## 2. Sandbox Execution Loop

When TASK produces file edits:
1. Copy affected files to .aide/sandboxes/current/
2. Run verify commands against sandbox copies (existing task service)
3. If all pass → present diff for approval (existing flow)
4. If fail → collect errors, feed back to model for retry (max 3 attempts)
5. Log full cycle to cipher-state.jsonl
6. Only verified diffs reach SHIP panel

Implementation: extend planAndBuild's approve handler. After apply, instead of
showing diff immediately: write to scratch, verify, retry if needed, THEN apply
to real files and show diff. Uses existing task-service run() for verification.

## 3. Learned Injection

buildScaffold() reads last N approved patterns from cipher-state.jsonl where
type=preference or type=approval with high confidence. Injects as:
```
[learned] Operator prefers async/await over promise chains
[learned] Auth module uses JWT tokens — follow existing pattern
```
Cap at 10 lines. Only entries seen >=3 times (confidence threshold).

## 4. Files to modify

- harness/cipher-state.mjs (NEW): readState/appendState helpers
- app.js: wire state recording into approval/rejection/save flows
- daemon/server.mjs: expose GET /api/cipher/state (tail query)
- harness/scaffold.mjs: read learned entries in composeScaffold
- scripts/run-harness-battery.mjs: no change (battery measures outcome)

## Verification

- Unit: state round-trip (append -> query -> filter by type/since)
- Live: approve a TASK edit -> state entry exists -> next scaffold includes it
- Regression: battery delta unchanged (state bus adds no latency to chat path)
