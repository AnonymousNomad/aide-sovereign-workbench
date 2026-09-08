---
name: failure-typescript-mjs-declaration
description: Fix strict TypeScript TS7016 failures for project JavaScript modules without weakening compiler settings. Use whenever a .ts file imports a local .mjs module and tsc reports an implicit-any declaration error.
---

# TypeScript MJS Declaration Boundary

When strict TypeScript imports a local `.mjs` module, add a sibling `.d.mts`
declaration describing the exported API. Keep the runtime implementation in
`.mjs`; the declaration is compile-time only.

## Procedure

1. Read the implementation and callers to derive the exact exported functions,
   argument types, return types, and optional fields.
2. Add `<module>.d.mts` beside the module or at the resolver path TypeScript
   checks. Do not use `declare module '*'` or disable `noImplicitAny`.
3. Run the focused tsc project check, then the focused runtime test. A
   declaration that lies about the implementation is a type-safety defect.
4. Keep the declaration and implementation together in the same commit only
   after the feature behavior is separately verified.
