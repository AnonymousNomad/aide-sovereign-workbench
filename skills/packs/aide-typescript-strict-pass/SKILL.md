---
name: aide-typescript-strict-pass
description: The AIDE pattern for passing the strict TypeScript gate (`npm run check:arch` = `tsc -p tsconfig.node.json`) when adding a new `.mjs` service + `.d.mts` companion + `.ts` route + arch test. Use when tsc reports TS2304/TS2345/TS18048/TS7016/TS18046/TS7006/TS6133/TS2749/TS2488 errors, when adding a new service under `node/src/services/`, when the test scaffolding uses `(r: any)` casts that fail under `noUnusedLocals`/`noImplicitAny`, or when the repo's two-runtime doctrine (arch + legacy) needs the same shape exported from both.
---

# TypeScript Strict Pass — AIDE Repo Pattern

Born 2026-09-02 from the 45-error `npm run check:arch` failure after T2's 4 wire-in commits. The repo runs `tsc -p tsconfig.node.json` with the strictest practical flags. Every new service/route/test must match the existing pattern or the gate goes red. This skill IS the SOP for making the gate green cleanly.

## The strict-mode policy (read this first)

`tsconfig.base.json` is the truth. The flags that drive the 6 error classes:

| Flag | Effect | Traps it causes |
|---|---|---|
| `strict: true` | enables strictNullChecks + noImplicitAny + strictFunctionTypes | TS7006 implicit any, TS18048 possibly undefined |
| `noUncheckedIndexedAccess: true` | `arr[i]` is `T \| undefined` not `T` | TS18048 on `messages[idx]`, TS2488 on `Object.entries(x?)` |
| `exactOptionalPropertyTypes: true` | `?:` does NOT accept explicit `undefined` | hidden — caught when a Zod optional carries `undefined` |
| `noUnusedLocals: true` | unused imports/vars error | TS6133 'declared but its value is never read' |
| `noUnusedParameters: true` | unused function params error | TS6133 'parameter X implicitly has an any type' (the test-scaffolding kind) |
| `verbatimModuleSyntax: true` | `import type { T }` for type-only | mostly fine, easy to miss on refactors |
| `erasableSyntaxOnly: true` | no enums, no namespaces | respected repo-wide; not a new trap |

`noImplicitOverride` + `noFallthroughCasesInSwitch` are on but rarely surface.

## The 6 error classes (with the repo's established fix)

### Class 1 — TS2304 / TS2345 "Cannot find name / not assignable to parameter of type"

**Symptom:** A new variable is referenced before it's imported, or the type it carries doesn't match the signature it flows into.

**The repo's fix (the two patterns are both used, pick by context):**

(a) **Add the import.** Check the import block at the top of the file. Most services in this repo use **direct ESM import** for `.ts` siblings and `createRequire` for `.mjs` siblings.

```ts
// The .ts route file pattern (e.g. node/src/routes/experts.ts):
import { createExpertsService } from './experts.ts';   // direct ESM
const expertsService = createExpertsService(workspace); // constructed
```

(b) **Tighten the signature.** When the test uses `(r: any)` and the compiler can't infer, declare the type from the **actual runtime shape**, not from a cast.

**Rule:** prefer (a) when the symbol exists; (b) only when you're in test code where the type is genuinely dynamic.

### Class 2 — TS18048 "X is possibly undefined"

**Symptom:** `noUncheckedIndexedAccess` makes every `arr[i]` `T | undefined`. The repo handles it with explicit narrowing:

```ts
// BEFORE (TS18048):
const sysMsg = messages[idx];
return inner([...messages.slice(0, idx), { ...sysMsg, content: ... }, ...messages.slice(idx + 1)]);

// AFTER (the repo's fix):
const sysMsg = messages[idx];
if (sysMsg) {
  return inner([...messages.slice(0, idx), { ...sysMsg, content: block + sysMsg.content }, ...messages.slice(idx + 1)]);
}
return inner([{ role: 'system', content: block }, ...messages]);
```

**Alternative:** use `find` to get a non-undefined return:

```ts
const sysMsg = messages.find(m => m.role === 'system');
```

### Class 3 — TS7016 "Could not find a declaration file for module"

**Symptom:** A `.mjs` service is imported by a `.ts` file but has no `.d.mts` companion.

**The repo's fix (mandatory — every .mjs service has one):**

Create `node/src/services/<name>.d.mts` mirroring the exports. Pattern (from `agent-loop.d.mts`):

```ts
// node/src/services/worktree.d.mts (the new file, mirrors worktree.mjs)
import type { WorktreeInfoT, WorktreeCreateResponseT, WorktreeListResponseT, WorktreeMergeResponseT, WorktreeDiscardResponseT } from '../../common/contracts/workbench.ts';

export declare class WorktreeError extends Error {
  code: 'VALIDATION' | 'NOT_FOUND' | 'ALREADY_EXISTS' | 'BRANCH_HOLD' | 'CONFLICT' | 'GIT_FAILED' | 'INTERNAL';
  constructor(code: string, message: string);
}

export declare interface WorktreeService {
  create(args: { id: string; baseRef?: string }): Promise<WorktreeInfoT>;
  list(): Promise<WorktreeInfoT[]>;
  merge(args: { id: string; strategy: 'merge' | 'squash' | 'rebase'; commit_message?: string }): Promise<{ id: string; strategy: 'merge' | 'squash' | 'rebase'; commit_sha: string; message: string }>;
  discard(args: { id: string }): Promise<{ id: string; state: 'discarded' }>;
}

export declare function createWorktreeService(options: { workspace: string }): WorktreeService;
```

**Rule:** use `declare` for classes and interfaces, plain `export function` for free functions. The `.d.mts` must mirror the runtime shape — no behavior, no business logic.

### Class 4 — TS18046 "X is of type unknown" (in `catch` blocks)

**Symptom:** A `try { ... } catch (error) { ... error.message ... }` block. Under strict mode, `error` is `unknown`.

**The repo's fix (always the same shape):**

```ts
try { ... } catch (error) {
  if (error instanceof RouteError) throw error;
  throw new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'operation failed');
}
```

**Rule:** `error instanceof Error ? error.message : 'fallback'` is the canonical pattern. Never `error.message` without the guard.

### Class 5 — TS7006 "Parameter X implicitly has an 'any' type"

**Symptom:** A test helper like `async function git(args, cwd)` has no types.

**The repo's fix (don't use `any` — use the actual shape):**

```ts
// BEFORE (TS7006):
async function git(args, cwd) { ... }

// AFTER (the repo's fix):
async function git(args: string[], cwd: string): Promise<string> { ... }
```

**In test files** (where the type is genuinely dynamic and the test owns the contract):

```ts
// Acceptable test pattern when probing route shape:
const mod = require('../../node/src/routes/experts.ts') as Record<string, any>;
const { createExpertsService, routesForExperts } = mod;
```

The `as Record<string, any>` on a `require` is the established escape hatch for dynamic probing. Do NOT use it for service functions or `let` declarations.

### Class 6 — TS6133 / TS2749 "declared but never read" / "refers to a value, used as type"

**TS6133 symptoms:** A destructured parameter or local variable is unused.

**The repo's fix (use the value or remove it):**

```ts
// BEFORE (TS6133):
async function withExpertAdvisory({ chatFn, consultExpert, timeoutMs = 200 }) { ... }

// AFTER (the repo's fix — if the value is genuinely used, leave the destructuring; if not, remove):
async function withExpertAdvisory({ chatFn, consultExpert, timeoutMs = 200 }: { chatFn: ChatFn; consultExpert: ConsultExpert; timeoutMs?: number }) { ... }
```

**TS2749 symptom:** Using a class as a type. `e instanceof WorktreeError` is fine; `e: WorktreeError` is wrong.

```ts
// BEFORE (TS2749):
catch (e) { assert.ok(e instanceof WorktreeError); assert.equal((e as WorktreeError).code, 'NOT_FOUND'); }

// AFTER:
catch (e) {
  assert.ok(e instanceof WorktreeError);
  if (e instanceof WorktreeError) {
    assert.equal(e.code, 'NOT_FOUND');
  }
}
```

The `instanceof` narrows the type, so the `as` cast is unnecessary. The `if` guard is required because TS doesn't narrow `e` across the `instanceof` assertion (it does narrow it after, but the test runner's `assert` doesn't carry the narrowing).

## The structural bug pattern (NOT a TS error — found in the audit)

The `agent-expert-advisory.test.ts` file had a **structural bug** (unrelated to TS strictness): lines 126-131 are floating outside the `withExpertAdvisory` function declaration. The function body was incomplete when the test cases were appended below. Per `aide-debugging-discipline` ("one hypothesis at a time" + "read the tool's own debug log first"), the fix is to **rebuild the function in canonical order: declare, then test**. This is NOT a TS error per se but surfaces as TS errors because the parser sees an unfinished function followed by 6 test cases followed by the function's tail.

**The repo's fix (the structural test file pattern from `expert-serve-wirein.test.ts`):**

```ts
// ONE aggregated test() (runner-proven shape). Per-test() files have hung
// under the concurrent T1 batch runner on this box, see the .hang file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// ... helpers above
test('all cases in one test()', async () => {
  // 6 cases as a sub-battery, not 6 separate test() functions
});
```

**Why aggregated test():** the concurrent `node --test` runner on this box (per T2's 8/21 CI hang investigation) hangs per-test() files. The repo's `aide-debugging-discipline` "twice-fail" law says don't keep retrying — switch to the runner-proven shape.

## Files to touch (when wiring this skill)

| File | Change |
|---|---|
| `node/src/services/<name>.d.mts` | NEW: companion declaration file mirroring `<name>.mjs` exports |
| `node/src/services/<name>.mjs` | NO change needed if it was already shipped |
| `node/src/routes/*.ts` | Add the import + construct the service at the call site |
| `tests/arch/*.test.ts` | Use `createRequire` + `as Record<string, any>` only for dynamic probing; otherwise full types |
| `tsconfig.node.json` | NO change — the strict flags are correct |

## The contract pattern (zod-strict, every route file)

Every route file in `node/src/routes/` follows the same zod-strict contract pattern (see `experts.ts` for the canonical example):

```ts
const z = require('zod') as typeof import('zod');
const FooBody = z.object({ ... }).strict();
const FooResponse = z.object({ ... }).strict();
```

The `.strict()` on every zod object is the "no extra keys" law (per `aide-debugging-discipline` "Strict zod rejects legacy keys"). Never `.strict()` missing means the contract allows junk.

## Threat matrix (each error class + the test that catches it)

| Threat | tsc error | Test that catches a regression |
|---|---|---|
| Missing import in route file | TS2304 | `tests/arch/<feature>-routes.test.ts` (uses ArchServer.listen) |
| Undefined from indexed access | TS18048 | covered by the suite that uses the route |
| Missing .d.mts companion | TS7016 | the next strict pass after a new service ships |
| `catch` param treated as Error | TS18046 | the route's own unit test (force an error path) |
| Implicit any in test helper | TS7006 | the next strict pass after a test helper is added |
| Unused parameter in test scaffold | TS6133 | next strict pass |
| WorktreeError used as type | TS2749 | `worktree-isolation.test.ts` line 88 |

## Pitfalls (each one cost time when this skill was written)

- **Do NOT use `as any` to silence TS errors.** It removes the type safety net. Use the declared types from the contracts.
- **Do NOT use `// @ts-ignore`.** It silences errors silently. `// @ts-expect-error` is OK only with a comment naming the line being suppressed AND the reason.
- **Do NOT add `as any` to test helper destructuring.** The repo's `agent-architect-editor.test.ts` and `expert-serve-wirein.test.ts` are the templates — full types, not casts.
- **Do NOT use `?` chained on a possibly-undefined variable inside `findIndex`.** The `find` alternative is cleaner; `noUncheckedIndexedAccess` is the strict flag enforcing this.
- **Do NOT put the `.d.mts` companion in a different directory than the `.mjs`.** The repo convention is sibling files. Path is `node/src/services/<name>.d.mts` next to `node/src/services/<name>.mjs`.
- **Do NOT ship a route that references a service that doesn't exist in the import block.** This is what `c1d4922` (expert advisory) did — added the call site but not the import. The error surfaces in `openapi.ts` not in `routes/agent.ts`.
- **Do NOT use the `as` cast on a class for type narrowing.** `e instanceof WorktreeError` narrows correctly inside the `if` block. The cast is redundant and a TS2749 trap.
- **Do NOT ship a test file with multiple `test()` calls when the runner is the concurrent batch runner.** Per the `aide-debugging-discipline` "twice-fail" law + the 8/21 CI hang investigation, switch to the aggregated single-test shape.

## The rollout (a single PR per strict pass)

1. Read `tsc -p tsconfig.node.json` output; group errors by file.
2. For each file, apply the class-1-to-class-6 fix per the table above.
3. Run `tsc -p tsconfig.node.json` after each file to catch regressions early.
4. Run `tsc -p browser/tsconfig.browser.json` — the browser config extends base + adds DOM lib.
5. Run `eslint .` — the eslint config catches the things tsc doesn't (no-unused-vars as warning, etc.).
6. Run `node scripts/run-arch.mjs` — the arch test suite. The suite uses `node --test --experimental-strip-types --test-concurrency=3` per T2's 8/21 hang fix.
7. If everything green: commit `fix(strict): <file> passes tsc strict pass` per file (or one batch commit if all 6 are small).

## The verification battery (what must pass before claiming done)

```
tsc -p tsconfig.node.json                   → exit 0, zero errors
tsc -p browser/tsconfig.browser.json        → exit 0, zero errors
eslint .                                    → exit 0, zero errors (warnings allowed)
node scripts/run-arch.mjs                   → all arch tests pass
node scripts/run-arch.mjs --test-force-exit → all arch tests exit cleanly (no hang)
```

The `--test-force-exit` is the after() hook safety net per T2's 8/21 investigation (the runner waits on an open handle otherwise).

## Existing assets this skill USES

- `tsconfig.base.json` (the strict flags, source of truth)
- `tsconfig.node.json` / `tsconfig.browser.json` (the two compile targets)
- `node/src/services/*.d.mts` (the companion-file pattern, 23 examples)
- `tests/arch/agent-architect-editor.test.ts` (the runner-proven test pattern with full types)
- `tests/arch/expert-serve-wirein.test.ts` (the aggregated single-test pattern with `as Record<string, any>` only on the dynamic require)
- `aide-debugging-discipline` (the twice-fail law; the .d.mts / strict-zod / TDZ traps)

## References

- TypeScript Handbook: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` (https://www.typescriptlang.org/tsconfig)
- Zod docs: `.strict()` (https://zod.dev)
- Node test runner docs: `test()`, `before/after`, `--test-force-exit` (https://nodejs.org/api/test.html)
- 8/21 CI hang investigation (AGENT_NOTES, the 900s `timeout` exit pattern)
- 8/25 `aide-debugging-discipline` "Strict zod rejects legacy keys" trap
- T2's 4 wire-in commits (ca78360, c1d4922, 4ac1e5e, 6a76351) that introduced the 6 error classes
