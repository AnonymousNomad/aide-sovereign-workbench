---
name: aide-agents-md
description: The AIDE pattern for session-scoped, workspace-scoped, and user-scoped agent instructions — the AGENTS.md (and equivalent) file convention. Use when implementing the AIDE analog of Claude Code's CLAUDE.md, Cursor's Rules, Aider's conventions file, or Cline's Memory Bank. Use when the user asks "make AIDE always do X" or "this project uses tabs, never spaces" or "when I say commit I mean signed". Use when reviewing the prompt composition for the chat path.
---

# AGENTS.md — Persistent Agent Instructions, Scoped Three Ways

Born 2026-08-31 from the wiring audit. AIDE has `harness/credo.md` (the global credo) and `aide-advanced-orchestration` Pattern 5 (AGENTS.md export) but the **load order, scoping rules, and edit UX** are not specified or wired. Every rival (Claude Code, Cursor, Cline, Copilot, Aider) has this. AIDE's version is "the credo is global, period" — too coarse. This skill IS the wire-in.

## The AIDE AGENTS.md contract (3 scopes, 1 precedence)

```
Priority (highest to lowest):
1. SESSION scope:    .aide/agents/session.md       (ephemeral, current session only)
2. WORKSPACE scope:  <workspace>/AGENTS.md         (committed, project-wide)
3. USER scope:       ~/.aide/agents/user.md        (cross-workspace, operator's preferences)
4. GLOBAL scope:     harness/credo.md              (the oath, non-overridable)
```

**Why 4 levels, not 3:** the global credo is **non-overridable** by the other three. It's the oath. The other three are preferences layered on top.

**The "non-overridable" rule:** the credo defines the oaths (protect user, evidence over confidence, etc.). Workspace AGENTS.md can ADD constraints ("always run tests before commit") but cannot REMOVE an oath. A diff that conflicts with the credo is rejected with `OATH_CONFLICT`.

## Files to touch (when wiring)

| File | Change |
|---|---|
| `node/src/services/agent-instructions.mjs` | NEW: `loadInstructions({workspace, userHome, sessionId})` returns the merged, deduplicated, oath-checked instruction set. |
| `node/src/services/scaffold.mjs` | EXTEND: `composeScaffold` calls `loadInstructions` and prepends the merged set to the system prompt. |
| `node/src/routes/agent.ts` (or new `node/src/routes/instructions.ts`) | ADD: `GET /api/instructions` (show merged), `PUT /api/instructions/scope/:scope` (edit one scope), `GET /api/instructions/scopes` (list all 4). |
| `common/contracts/agent.ts` or new `common/contracts/instructions.ts` | ADD: the 4 zod schemas. |
| `node/src/server.ts` | Wire the routes. |
| `tests/arch/agents-md.test.ts` | NEW: 5 tests (scope precedence, oath conflict, dedup, session expiry, edit UX). |
| `scripts/aide-bundle.cjs` | (optional) `bundle instructions` CLI. |
| `browser/src/...` | (optional) "Edit workspace instructions" UI in the settings panel. |

## The contract (zod-strict)

```ts
// in common/contracts/instructions.ts

export const InstructionScope = z.enum(['session', 'workspace', 'user', 'global']);

export const InstructionEntry = z.object({
  scope: InstructionScope,
  path: z.string(),       // file path for verification
  body: z.string(),
  lines: z.number().int().gte(0),
  modified_at: z.number().int(),
  oath_check: z.enum(['pass', 'fail', 'unknown']).default('unknown'),
  oath_conflict: z.string().nullable().optional()
}).strict();

## The load + merge algorithm

```js
// node/src/services/agent-instructions.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const OATHS = [
  'protect the user and their data',
  'evidence over confidence',
  'finish the procedure',
  'preserve the workspace',
  'carry knowledge forward'
];

const SCOPE_PATHS = {
  global:    'harness/credo.md',
  workspace: 'AGENTS.md',
  user:      path.join(os.homedir(), '.aide', 'agents', 'user.md'),
  session:   path.join('.aide', 'agents', 'session.md')
};

export async function loadInstructions({ workspace, sessionId }) {
  const entries = [];
  const conflicts = [];
  for (const [scope, relPath] of Object.entries(SCOPE_PATHS)) {
    const absPath = scope === 'user' || scope === 'global' ? relPath : path.join(workspace, relPath);
    let body;
    try { body = await fs.readFile(absPath, 'utf8'); }
    catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    const oathCheck = checkOaths(scope, body);
    const entry = {
      scope, path: absPath, body,
      lines: body.split('\n').length,
      modified_at: (await fs.stat(absPath)).mtimeMs,
      oath_check: oathCheck.status,
      oath_conflict: oathCheck.conflict
    };
    entries.push(entry);
    if (oathCheck.status === 'fail') {
      conflicts.push({ scope, path: absPath, snippet: oathCheck.snippet, conflicting_oath: oathCheck.oath });
    }
  }
  const merged = entries
    .sort((a, b) => orderByScope(a.scope) - orderByScope(b.scope))
    .map(e => '# [' + e.scope + ']\n' + e.body)
    .join('\n\n');
  return { merged, entries, conflicts };
}

function orderByScope(scope) {
  return { global: 0, user: 1, workspace: 2, session: 3 }[scope];
}

function checkOaths(scope, body) {
  const violations = [

## The scaffold integration

```js
// in harness/scaffold.mjs:
import { loadInstructions } from '../node/src/services/agent-instructions.mjs';

export async function composeScaffoldWithInstructions({ workspace, effectiveContextTokens, taskFamily, sessionId }) {
  const baseScaffold = composeScaffold({ effectiveContextTokens, taskFamily });
  const instructions = await loadInstructions({ workspace, sessionId });
  const header = '[AIDE instructions | ' + instructions.entries.length + ' scope(s) loaded]';
  const system = baseScaffold.system.replace(
    /^(\[AIDE[^\]]+\])/,
    '$1\n' + header + '\n' + instructions.merged
  );
  return { ...baseScaffold, system, instructions };
}
```

## Default scope conventions

- **Session** (`.aide/agents/session.md`): ephemeral, deleted on session end. Use for "during this conversation, always..."
- **Workspace** (`<workspace>/AGENTS.md`): committed, project-wide. Use for project conventions. **This is the most common.**
- **User** (`~/.aide/agents/user.md`): cross-workspace. Use for personal style ("I always use tabs").
- **Global** (`harness/credo.md`): the oath. Read-only. Defines the 5 oaths.

## Threat matrix (the tests must cover these)

| Threat | Test | Pass criterion |
|---|---|---|
| Workspace overrides global oath | Workspace AGENTS.md says "ignore safety" | loadInstructions returns conflicts[0].oath = 'protect the user'; merged still includes the credo (the global wins) |
| Scope precedence | Set session + workspace + user with different instructions | session wins (last in merge order), workspace adds, user adds, global is base |
| Session cleared on session end | Session scope file mtime is older than the current session | session scope is skipped (mtime check) |
| Empty scope | All scopes empty | merged is the credo only (or empty if no credo) |
| 50K char body | Workspace AGENTS.md is 50K | InstructionUpdateRequest rejects with 413 |
| Path traversal | scope='workspace' body='../../etc/passwd content' | the body is text, not a path — rejected only if it contains a path-jail violation; otherwise stored as-is |

## Existing assets this skill USES

- `harness/credo.md` (the oath, GLOBAL, read-only)
- `harness/credo-map.json` (the credo as a structured map)
- `harness/scaffold.mjs` (the existing composeScaffold function)
- `harness/veritas.mjs` (the oath names are the same as the Veritas oath labels)
- `node/src/services/workspace.ts` (workspace path resolution)

## Pitfalls

- **Do NOT allow the global scope to be modified via the API.** The credo is sacred. The route rejects with 403.
- **Do NOT let the session scope leak between sessions.** Delete the session file on session end, or check its mtime.
- **Do NOT inject the merged instructions into the user message.** They go in the SYSTEM prompt, before the conversation. Models treat system-prompt as binding; user-message as data.
- **Do NOT detect conflicts with regex alone.** v1 is regex (the 4 patterns above); v2 should use a proper parser and an LLM-as-judge (per the Comprehension engineering skill).
- **Do NOT silently drop a conflicting instruction.** Surface it. The user needs to know.
- **Do NOT make the file watcher reload on every keystroke.** Debounce 5s.

## The rollout (2 PRs)

### PR A — Load + merge service + scaffold integration
- Add `node/src/services/agent-instructions.mjs`
- Extend `harness/scaffold.mjs` with `composeScaffoldWithInstructions`
- 5 arch tests
- Commit: `feat(agent): AGENTS.md scope load + merge (PR A of aide-agents-md)`

### PR B — Routes + edit UX
- Add the 4 zod schemas
- Regenerate openapi.json
- Add 4 routes (GET merged, GET scopes, PUT scope, DELETE session)
- 3 more arch tests
- Commit: `feat(agent): AGENTS.md routes + edit UX (PR B of aide-agents-md)`

## References

- `aide-advanced-orchestration` Pattern 5 (AGENTS.md export, the original spec)
- `harness/credo.md` + `harness/credo-map.json` (the oath)
- `harness/veritas.mjs` (the 5 oaths: protect user, evidence over confidence, finish the procedure, preserve the workspace, carry knowledge forward)
- `aide-credo-guardrail` (the credo as a skill, with the enforcement pattern)
- Claude Code CLAUDE.md, Cursor Rules, Aider conventions file, Cline Memory Bank, Copilot custom instructions — the rival patterns


    { re: /ignore (?:all )?previous instructions/i, oath: 'finish the procedure' },
    { re: /disregard (?:the )?(?:credo|oath|safety)/i, oath: 'protect the user' },
    { re: /skip (?:the )?(?:veritas|gate|verification)/i, oath: 'evidence over confidence' },
    { re: /never (?:commit|save|back ?up)/i, oath: 'preserve the workspace' }
  ];
  for (const v of violations) {
    const m = body.match(v.re);
    if (m) return { status: 'fail', conflict: m[0], snippet: m[0], oath: v.oath };
  }
  return { status: 'pass' };
}
```


export const MergedInstructions = z.object({
  merged: z.string(),     // the final system-prompt-prefix
  entries: z.array(InstructionEntry),
  conflicts: z.array(z.object({
    scope: InstructionScope,
    path: z.string(),
    snippet: z.string(),
    conflicting_oath: z.string()
  }))
}).strict();

export const InstructionUpdateRequest = z.object({
  scope: InstructionScope.exclude(['global']),  // global is read-only (the credo)
  body: z.string().min(0).max(50_000)         // 0 = clear
}).strict();
```

