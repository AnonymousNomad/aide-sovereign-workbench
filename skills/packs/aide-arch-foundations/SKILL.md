---
name: aide-arch-foundations
description: Phase 0 SOP for the AIDE offline-first IDE rebuild — the project skeleton: TypeScript strict toolchain, Vite build with a separate tsc --noEmit type gate, ESLint, node:test harness, Theia-style common/browser/node directory structure, and the zod/OpenAPI contract skeleton. Use at the START of the rebuild (Phase 0), whenever scaffolding any new module or test, and whenever a build/type/compile gate fails or must be set up. Research-grounded (vite.dev, typescriptlang.org, theia-ide.org, api-contract-testing.com).
---

# AIDE Architecture — Phase 0: Foundations

## Doctrine (applies to EVERY phase skill in this program)

1. **Offline-first, online opt-in.** AIDE is an OFFLINE IDE. Everything (Monaco, fonts, workers, models, marketplace, docs) MUST be bundled/served locally. NO CDN, NO telemetry, NO remote fetches unless the user has explicitly opted in for a specific feature (e.g. marketplace sync). Default deny for all network.
2. **Verify before claiming.** Nothing is "done" until the compile gate, unit tests, and where possible live verification pass.
3. **Contract first.** Every frontend/backend boundary is a typed contract (zod at the runtime edge). No untyped JSON crossing processes.
4. **Full rebuild.** New modular TypeScript frontend + modular daemon backend replace the app.js/server.mjs monoliths. Only verified engine pieces are ported: model-manager gates (warmup/identity/RAM), workspace-manager, undo-stack logic, groups, replay-store.
5. **Fail closed.** Errors return a fixed envelope; unvalidated input is rejected; processes die cleanly with children.

## What

Phase 0 creates the skeleton the whole rebuild grows inside. It is NOT feature work. Deliverables:

- `package.json` — ESM (`"type": "module"`), engines pin, all deps local (no CDN ever).
- `tsconfig.json` + `tsconfig.node.json` — strict mode, `noEmit`, `isolatedModules`, `verbatimModuleSyntax`.
- Vite project (frontend) with dev proxy to the daemon (avoid CORS in dev).
- ESLint flat config (typescript-eslint recommended).
- `node --test` harness (backend + shared tests), coverage thresholds.
- Directory structure `common/ browser/ node/` per Theia (see below).
- Contract skeleton: `common/contracts/*.ts` with zod schemas for the first routes + OpenAPI doc generated from schemas.
- Build gates script: `npm run check` = `tsc --noEmit` (frontend AND backend) + `eslint` + `node --test` + `vite build`.

## How

### 1. Toolchain (verified facts)

- Vite (current, Rolldown) transpiles with esbuild/Rolldown — it does NOT type-check. Type checking is a SEPARATE gate: `tsc --noEmit`. Never rely on `vite build` for type safety.
- TypeScript flags that must be on: `"strict": true`, `"noEmit": true`, `"isolatedModules": true`, `"verbatimModuleSyntax": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"target": "ES2022"`, `"skipLibCheck": true`.
- Frontend and backend get separate tsconfigs sharing a base. Backend (`node/`) compiles with `moduleResolution: "nodenext"` (or is checked via `tsc --noEmit` only, since it runs as ESM directly — check both: type gate + runtime smoke).
- Backend daemon runs ESM natively under `node server.mjs`/`node --experimental-*` (Node 20+). No build step for backend at runtime; type gate only.
- Tests: `node --test` (Node 20+ built-in runner) for backend/common; frontend logic tests also run under `node --test` with pure TS via a test harness (tsx or node --experimental-strip-types on Node 22+; pin the harness in package.json scripts).
- ESLint: `typescript-eslint` flat config (`eslint.config.js`), recommended + strict rules; run in `npm run check`.

### 2. Directory structure (Theia-inspired, proven by theia-ide.org)

```
aide-sovereign-workbench/
  common/        # shared: zod schemas, contract types, constants, event names (usable by BOTH sides, no Node APIs)
    contracts/
      chat.ts  workspace.ts  file.ts  git.ts  lsp.ts  ...
    events.ts
    errors.ts  # error envelope types + codes
  browser/      # FRONTEND ONLY — no Node.js APIs, no fs, no child_process (VS Code renderer rule)
    src/
      app.ts  shell/  services/  editor/  views/  store/
    index.html
    vite.config.ts
  node/         # BACKEND ONLY — daemon + services
    src/
      server.ts  routes/  services/  process/  logging/
    daemon/      # launch scripts (server.mjs entry, keep existing verified files here until ported)
  tests/        # node --test suites + shared fixtures for contract tests
  e2e/          # Playwright suites (Phase 4)
```

Rule: `common/` must import nothing from `browser/` or `node/`. `browser/` must not import Node builtins (grep gate: `fs`, `child_process`, `path`, `os` forbidden in browser src — enforce with ESLint `no-restricted-imports`).

### 3. Contract skeleton (Phase 0 delivers the PATTERN, phases deliver the routes)

- Every route has a zod schema: `RequestSchema.strict()` + `ResponseSchema.strict()`.
- Single source of truth: `z.infer<typeof X>` produces the TS type; OpenAPI is GENERATED from schemas (zod-openapi or hand-maintained alongside, with a drift test that regenerates and diffs).
- Contract tests (Phase 4, but skeleton now): shared fixtures in `tests/fixtures/` that BOTH the daemon's unit tests and the frontend client's tests consume, so the two sides can never drift silently.
- Error envelope (fixed, all routes): `{ ok: true, data }` | `{ ok: false, error: { code: string, message: string, detail?: unknown } }`. Codes from `common/errors.ts`.

### 4. Build gates

`npm run check` (must pass before ANY commit):
1. `tsc -p browser --noEmit` and `tsc -p node --noEmit`
2. `eslint .`
3. `node --test tests/` (backend + common + contracts)
4. `vite build` (frontend production bundle, all assets LOCAL)
5. Optional gate: Playwright smoke (Phase 4+)

`npm run dev` — vite dev server + daemon, with `server.proxy` in vite.config.ts mapping `/api` to the daemon port (no CORS in dev).

## Why (research grounding)

- Vite docs: build-time transpile only; type checking is a separate step. Skipping `tsc --noEmit` = type bugs ship.
- TypeScript docs: strict family is the supported safe mode; `verbatimModuleSyntax` + `isolatedModules` make each file independently transpilable (required by esbuild/Rolldown).
- VS Code engineering docs: the renderer is a browser process — no Node APIs. Theia docs: frontend/backend split with DI and JSON-RPC; `common/browser/node` separation is their proven structure.
- api-contract-testing.com + OpenAPI practice: schemas as executable contracts at the runtime edge; generated types prevent drift. z.infer gives the TS type for free.
- Node docs: `node --test` is the built-in, zero-dependency runner with coverage (`--experimental-test-coverage`) and mocking (`node:test` mock).

## Dependencies

- Node.js 20+ (LTS), npm. Vite + typescript + zod + eslint + typescript-eslint (dev). zod-openapi or equivalent for OpenAPI generation. tsx (or Node 22 strip-types) for running TS tests. Playwright (dev only, browsers cached offline — do NOT re-download per install; keep `npx playwright install` cache).
- Monaco arrives in Phase 3 — do NOT add yet.
- All deps must install offline-capable (npm cache). No postinstall scripts that fetch remote content.

## Known issues / bugs (watch these)

- `verbatimModuleSyntax` forces `import type` for type-only imports — forgetting it breaks the gate. Let eslint (consistent-type-imports) catch it.
- `noUncheckedIndexedAccess` makes array indexing `T | undefined` — write code accordingly (this is a feature, not a bug).
- Vite dev proxy: only forwards configured paths; un-proxied paths hit the vite server and 404 — misconfigured proxy looks like "backend down".
- Windows: `"type": "module"` + `.mjs` vs `.ts` handling; `tsc --noEmit` on Windows is fine, but script paths in package.json need `node ./` not bare `./`.
- Zod `.strict()` strips nothing — it REJECTS unknown keys. Apply at the network edge ONLY; do not apply to internal objects or you'll break on future fields.
- `skipLibCheck` hides third-party type errors — acceptable for now, but never skip checking YOUR code.
- npm install of Playwright downloads browsers — on this offline-first machine, run `npx playwright install` ONCE and keep the browser cache; never on every CI/install.

## Phase 0 audit checklist (applied to the existing repo)

1. package.json is ESM with engines pin; no remote/CDN deps; scripts: dev, check, test, build.
2. tsconfig base strict + all flags above; separate browser/node configs; type gate in `npm run check`.
3. ESLint flat config with no-restricted-imports (Node builtins in browser/) and consistent-type-imports.
4. `common/ browser/ node/ tests/` structure exists (old app.js/server.mjs get ported INTO this structure during Phases 1-3, not kept as monoliths at root).
5. At least one contract (workspace list or file read) with zod .strict() both sides + error envelope + a fixture consumed by both sides.
6. `npm run check` passes end-to-end on the skeleton.