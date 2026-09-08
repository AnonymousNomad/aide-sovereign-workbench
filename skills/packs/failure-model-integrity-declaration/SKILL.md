---
name: failure-model-integrity-declaration
description: Diagnose and prevent TypeScript `TS7016` failures on project `.mjs` helpers imported by strict TS, and prevent the model-runtime integrity test from asserting a stale error message. Use whenever a new `common/*.mjs` helper is added and `node/src/services/model-runtime.ts` (or another strict TS module) imports it, or whenever the model integrity error contract changes.
---

# Model Integrity Declaration Boundary

## When to use

Trigger whenever any of the following happens in this repo:

- A new `common/*.mjs` helper is added and consumed by strict TypeScript (e.g. `node/src/services/model-runtime.ts`).
- The model integrity error contract changes (e.g. `MODEL_VERIFY ... hash mismatch` instead of `... changed on disk`).
- A focused model-runtime test fails with `TS7016: Could not find a declaration file for module '...'` or with a wrong regex/wording expectation.

## Procedure

1. **Inspect** the implementation file (e.g. `common/model-integrity.mjs`) and list every exported symbol, its parameter types, and its return types. For an `await fn(...)` helper, the declaration uses `Promise<ReturnType>`.
2. **Create a sibling declaration** file (e.g. `common/model-integrity.d.mts`) that mirrors the public API using only `export interface`, `export declare function`, and `export type` (no runtime code). Keep the declaration free of business logic.
3. **Update the test** (`tests/arch/model-runtime.test.ts`) to assert the new contract exactly — the substring of the new error message, e.g. `/hash mismatch/`, not the old `/changed on disk/`. Do NOT weaken to `/.*/`; the assertion exists to catch contract drift.
4. **Verify** with the focused arch test first, then `tsc -p tsconfig.node.json --noEmit` directly, then full local Veritas.
5. **Commit and push** under the Conventional-Commit format (`fix(release): publish model integrity verification`) only after a green local Veritas and a green GitHub run. Do not commit the declaration alone if the test was not updated; both must move together.

## Anti-patterns

- Using `declare module '*'` or `declare module '<path>'` to silence TS7016 — that hides the real type and is a fake-rigor fix.
- Adding `// @ts-ignore` to the import line — that is a different anti-pattern; declare the real type instead.
- Weakening the test regex to `/.*/` or `/error/` so it passes against any error — the assertion exists to catch contract drift; widening it defeats its purpose.
- Importing the `.mjs` helper in a `.ts` file that already has a working declaration for a different helper without updating both.
- Forgetting that `verifySha256` returns a structured result (`{ status, expected, actual }`); the declaration must include that exact status union literal.

## Pitfalls

- The declared status literal must match the runtime's `String(expected).toLowerCase()` comparison — declare `'verified' | 'checksum-mismatch' | 'missing'` exactly.
- The cache type is `Map<string, Sha256CacheEntry> | null` — using `?` only would let `undefined` through and break the runtime's `cache?.get(...)` pattern; use the explicit `| null` union.
- The declaration must be **sibling** to the `.mjs` (same directory, same basename, `.d.mts` extension) so TypeScript's module resolution finds it without `paths` configuration.
- `import { ... } from '../../../common/model-integrity.mjs'` is what triggers TS7016 in strict mode; keep the runtime import path, add the `.d.mts`, and re-run.
- Do not move the declaration into `node/` or `types/` — the project convention is sibling declarations next to the runtime.

## Verified facts (2026-09-04)

- `common/model-integrity.mjs` exports `sha256File` and `verifySha256`; the declaration exists at `common/model-integrity.d.mts` with the exact union of status literals.
- `node/src/services/model-runtime.ts` already imports `verifySha256` from the `.mjs` and now compiles cleanly under `tsc -p tsconfig.node.json --noEmit`.
- The `tests/arch/model-runtime.test.ts:140` assertion was updated to expect the new `MODEL_VERIFY ... hash mismatch` message; the size-change `CONFLICT` path is preserved separately.
- Full local Veritas on the current worktree returned `passed:true`, score `1`, all gates true, after this skill was applied.

## What the operator asked

The operator placed the parked `model-integrity` experiment on the same lane as the rest of the build and asked to continue. This skill is the boundary that makes that safe: it does not require merging the T1/T2 work as a single commit, but it does require that any future change to `common/model-integrity.mjs` (or any sibling) be paired with the declaration and the test update before Veritas is rerun. Treat both as one verifiable unit.
