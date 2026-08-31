---
name: aide-worktree-isolation
description: The AIDE pattern for shadow-workspace isolation — when the user switches from plan to act, commit the current workspace to a shadow git branch, the agent operates on a worktree copy, and the changes merge back only on user approval. Use when implementing Cursor's shadow workspace, Replit's Worktree pattern, or Claude Code's "isolate sessions with worktrees" feature. Use when reviewing AIDE's plan-to-act transition, when designing subagent scratch dirs (composes with aide-subagent-dispatch), or when auditing whether an agent's edits are safe to merge.
---

# Worktree Isolation — Shadow Git Workspaces, Approval-Gated Merge

Born 2026-08-31 from the wiring audit. AIDE's plan mode (A1, shipped) refuses non-read-only tools, but the moment the user switches to act, the agent writes to the real workspace with no rollback. Cursor, Claude Code, Cline, Windsurf, Replit all ship "shadow workspace" or "worktree isolation" patterns; AIDE doesn't. This skill IS the wire-in.

## Why this matters

- **Safety**: a runaway agent in act mode can corrupt the real workspace. The shadow branch is the rollback.
- **Review**: the user sees "these are the changes the agent wants to make" before they land. The diff between shadow HEAD and main HEAD is the proposed change.
- **Composability**: subagent scratch dirs (per `aide-subagent-dispatch`) inherit this pattern. Each subagent is its own worktree.
- **No-Brick-Wall**: even if the agent gets stuck, the user can `git diff` the shadow branch and roll back in one command.

## The AIDE worktree contract (3 hard rules)

1. **A worktree is a real git worktree** under `<workspace>/.aide/worktrees/<id>/`, with `core.worktree=<workspace>` set in the worktree's git config. The worktree's branch is `aide-shadow/<id>` based on the user's current HEAD.
2. **All plan→act writes go to the worktree**, not the workspace. The agent's `file/write`, `file/edit`, and `git/commit` (if allowed) operate on the worktree's working directory.
3. **The user approves the merge**. A `/api/workbenches/worktree/merge` route takes `{id, strategy: "merge"|"squash"|"rebase", commit_message}` and applies the shadow branch's diff to the real workspace. A `/api/workbench/worktree/discard` route nukes the shadow branch and worktree without touching the workspace.

## Files to touch (when wiring)

| File | Change |
|---|---|
| `daemon/git-service.mjs` | EXTEND: add `createShadowWorktree({id, baseRef})`, `mergeShadowWorktree({id, strategy, message})`, `discardShadowWorktree({id})`, `listShadowWorktrees()`. All use the existing `execFile('git', ...)` pattern. |
| `node/src/services/agent-loop.mjs` | ADD: when `mode === 'act'`, resolve the worktree path from `parentSessionId` (or create one), pass it to the tool dispatch as `cwd` for file/write and file/edit. |
| `node/src/routes/workbenches.ts` | ADD: `POST /api/workbench/worktree/merge`, `POST /api/workbench/worktree/discard`, `GET /api/workbench/worktree/list`. |
| `common/contracts/workbenches.ts` | ADD: the 3 request/response zod schemas. |
| `tests/arch/worktree-isolation.test.ts` | NEW: 4 tests (create, edit, merge, discard). |
| `scripts/aide-bundle.cjs` | (optional) add `worktree` subcommand. |
| `browser/src/...` | (optional) the cockpit shows "Working in shadow: <branch>" when active. |

## The contract (zod-strict)

```ts
// in common/contracts/workbenches.ts

export const WorktreeInfo = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  branch: z.string().regex(/^aide-shadow\/[a-z0-9-]{1,64}$/),
  base_ref: z.string(),
  path: z.string(),
  created_at: z.number().int(),
  diff_stats: z.object({
    files_changed: z.number().int().gte(0),
    insertions: z.number().int().gte(0),
    deletions: z.number().int().gte(0)
  }).optional()
}).strict();

export const WorktreeCreateRequest = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  base_ref: z.string().optional()  // default = current HEAD
}).strict();

## The git-service integration

```js
// in daemon/git-service.mjs (or a new file, e.g. node/src/services/worktree.mjs)

// CREATION: spawn a real worktree under .aide/worktrees/<id>/
async function createShadowWorktree({ id, baseRef = 'HEAD' }) {
  const worktreePath = path.join(workspace, '.aide', 'worktrees', id);
  const branchName = `aide-shadow/${id}`;
  // 1. mkdir -p the worktrees dir
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  // 2. git worktree add -b <branch> <path> <baseRef>
  await execFile('git', ['worktree', 'add', '-b', branchName, worktreePath, baseRef], { cwd: workspace });
  // 3. set core.worktree on the worktree to the real workspace
  //    (so agent can run `git add -A` from the worktree and stage the workspace files)
  await execFile('git', ['config', 'core.worktree', workspace], { cwd: worktreePath });
  // 4. set core.bare=false (worktree is a working tree, not a bare repo)
  // 5. return WorktreeInfo
  return { id, branch: branchName, base_ref: baseRef, path: worktreePath, created_at: Date.now() };
}

// MERGE: apply the shadow branch's diff to the workspace
async function mergeShadowWorktree({ id, strategy, commit_message }) {
  const worktreePath = path.join(workspace, '.aide', 'worktrees', id);
  const branchName = `aide-shadow/${id}`;
  // 1. Verify the worktree exists, has no uncommitted changes in the workspace
  // 2. From the workspace, git fetch the worktree's branch (or just merge it directly)
  // 3. git merge --no-ff (or --squash) <branch>
  // 4. On success: remove the worktree, delete the branch
  // 5. On conflict: leave the worktree, return CONFLICT status with conflict files

## Threat matrix (the tests must cover these)

| Threat | Test | Pass criterion |
|---|---|---|
| Agent writes to real workspace when shadow active | Mode=act, worktree active, agent calls file/write | git status on workspace shows NO uncommitted changes; the worktree has the changes |
| Merge conflict blocks silently | Shadow branch conflicts with main HEAD | merge returns CONFLICT, worktree preserved, user sees conflict files |
| Discard leaks the worktree | Discard a worktree that has commits | worktree dir removed, branch deleted, workspace unchanged |
| Worktree path traversal | Agent writes `../../etc/passwd` via file/edit | sandbox.mjs rejects, tool_result.ok=false |
| Stale worktree accumulation | Create 100 worktrees, list them | 100 worktrees, no zombies, all have valid git state |

## Existing assets this skill USES

- `daemon/git-service.mjs` (or `node/src/services/git-service.d.mts`) → existing `execFile('git', ...)` pattern with the cwd law
- `harness/sandbox.mjs` → path-jail enforcement (the worktree path is the jail)
- `harness/cipher-state.mjs` → emit `worktree_created`, `worktree_merged`, `worktree_discarded` events
- `common/contracts/workbenches.ts` → existing WorkbenchInstallRequest pattern

## Pitfalls (each one will cost real time when wired)

- **Do NOT use `git worktree add` without a clean cwd.** If the workspace has uncommitted changes, the add fails. The wire-in must `git stash` first, then unstash after.
- **Do NOT use `git worktree add` with a branch that already exists at a different path.** Use `-b` to force a new branch.
- **Do NOT block on the merge while the user is reviewing.** The merge is user-initiated, not agent-initiated. The agent can REQUEST a merge via a tool call, but the actual merge needs `/api/workbench/worktree/merge` (a user-triggered route).
- **Do NOT auto-merge on approval.** The user's approval fires a route, the route performs the merge, the route returns the result. The agent sees the result, not the user input.
- **Do NOT use `--force` on the discard.** Use `--force` only on the worktree REMOVE, not the branch delete. The branch delete should fail loudly if the branch has unmerged commits the user might want.

## The rollout (2 PRs)

### PR A — Service + contracts + routes
- Add the 4 zod schemas to `common/contracts/workbenches.ts`
- Regenerate `common/openapi.json`
- Add `createShadowWorktree`, `mergeShadowWorktree`, `discardShadowWorktree`, `listShadowWorktrees` to `node/src/services/worktree.mjs` (NEW file, git-service shim)
- Add the 3 routes to `node/src/routes/workbenches.ts`
- 4 arch tests
- Commit: `feat(workbenches): worktree isolation service + routes (PR A of aide-worktree-isolation)`

### PR B — Agent loop integration
- Modify `agent-loop.mjs` to resolve worktree for `mode === 'act'`
- Pass worktree path as `cwd` to file/write, file/edit
- Emit spine events
- 2 more arch tests
- Commit: `feat(agent): act-mode writes to worktree (PR B of aide-worktree-isolation)`

## References

- `aide-workflow-gap-roadmap` Gap #3 (worktree isolation, audit gap)
- `aide-offline-agent-loop` A1 (plan mode, the seam this composes with)
- `aide-subagent-dispatch` (subagent scratch dirs can be worktrees)
- `aide-engine-lifecycle-doctrine` (engine kill laws — worktree commit != engine restart)
- Cursor shadow workspace, Claude Code "isolate sessions with worktrees", Replit Worktree, Cline checkpoints — the rival patterns

  // 6. Return the merge result (sha, files_changed, conflict)
}

// DISCARD: nuke the shadow branch + worktree, no merge
async function discardShadowWorktree({ id }) {
  // 1. git worktree remove --force <path>
  // 2. git branch -D <branch>
  // 3. Return OK
}
```

## The agent-loop integration

```js
// In the tool dispatch, when mode === 'act' AND a worktree is active for this session:
const worktreeInfo = await worktreeService.getForSession(sessionId);
if (worktreeInfo) {
  // Override the cwd for file/write, file/edit, search/replace
  toolArgs.cwd = worktreeInfo.path;
  // All file operations are now scoped to the worktree
  // The agent's commits land on the shadow branch
  // The real workspace is untouched until the user approves the merge
}
```

## Default behavior (the safe defaults)

- `mode === 'plan'`: no worktree, no writes (existing A1 behavior, unchanged)
- `mode === 'act'` without an active worktree: **auto-create one** on the first write (seamless, no user prompt)
- `mode === 'act'` with an active worktree: writes go to the worktree
- User clicks "Apply" / "Merge" / "Discard" in the UI: routes handle it


export const WorktreeMergeRequest = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  strategy: z.enum(['merge', 'squash', 'rebase']).default('squash'),
  commit_message: z.string().min(1).max(2000)
}).strict();

export const WorktreeListResponse = z.object({ worktrees: z.array(WorktreeInfo) }).strict();
```


