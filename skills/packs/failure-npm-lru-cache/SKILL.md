---
name: failure-npm-lru-cache
description: Diagnose a broken Windows npm or npx installation whose bundled lru-cache export is missing. Use whenever npm exec, npx, or an npm script fails inside the Node distribution with MODULE_NOT_FOUND under npm/node_modules/lru-cache.
---

# Broken npm lru-cache

## Procedure

1. Stop the gate at the first npm failure. Preserve the exact npm debug-log path
   and do not retry `npm`, `npx`, or `npm install` blindly.
2. Read the npm log and record the actual cwd, Node version, npm version, and
   missing path. Verify that the failure is inside the Node distribution rather
   than the repository dependency tree.
3. Check whether the repository-local executable exists before bypassing npm:
   `node_modules/typescript/bin/tsc`, `node_modules/.bin/eslint`, and any other
   required binary. A missing local binary is a blocker, not permission to
   download or mutate dependencies silently.
4. If a complete local binary exists, invoke it through `node` or its verified
   executable path and record that npm was bypassed. Keep the same arguments and
   failure-propagating `&&` chain.
5. If npm repair is needed, stop and obtain operator approval before changing
   the Node installation, lockfile, cache, or dependency tree. Do not delete
   the npm distribution or run a global reinstall as an unverified fix.
6. Verify all spawned-process cleanup and rerun the original gate only after the
   toolchain path is proven.

## Anti-Patterns

- Repeating `npx` after the same internal `MODULE_NOT_FOUND`.
- Blaming project TypeScript or ESLint code before reading npm's own log.
- Running `npm install` or `npm cache clean` without approval and a rollback path.
- Claiming static checks passed when npm stopped before invoking them.
