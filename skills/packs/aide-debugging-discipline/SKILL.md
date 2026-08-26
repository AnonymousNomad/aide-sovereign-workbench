---
name: aide-debugging-discipline
description: Concrete debugging playbook for the AIDE stack — reproduce minimally, instrument at the boundary, diff pass-vs-fail, one hypothesis at a time. Includes this repo's verified traps (workdir-less commands, chained destructive calls, stale refs, silent EADDRINUSE, LSP null shapes, TDZ ordering, dynamic DOM ids). Use whenever anything misbehaves.
---

# Debugging Discipline

## The Loop

1. REPRODUCE minimally
2. INSTRUMENT at the boundary (log exact bytes, not summaries)
3. DIFF pass vs fail — one variable at a time
4. FIX root cause
5. REGRESSION-TEST the trap
6. ENCODE the lesson here

## Verified Traps

| Trap | Symptom | Law |
|---|---|---|
| Workdir-less commands | Cannot find module E:\app.js | ALWAYS set workdir on repo-relative commands |
| Chained kill+relaunch | Stack dies mid-sequence, stale logs lie | ONE destructive action per call; verify zero between steps |
| Detached stdio ignore | Child produces no output; crashes invisible | Use pipe for stderr during debugging; switch to ignore only after stable |
| Stale origin/main ref | "Everything up-to-date" while remote is behind | git ls-remote is truth |
| .git/index.lock after abort | Commit fails "index.lock exists" | Remove stale lock after verifying no git proc running |
| Silent EADDRINUSE | New server dies, old zombie answers with old code | taskkill ALL, verify zero, THEN relaunch |
| LSP null vs error | result:null = valid empty; error object = bug | Treat differently |
| Strict zod rejects legacy keys | BAD_REQUEST unrecognized_keys | Contract-first: client sends exact contract keys |
| Dynamic DOM ids break static audits | ui-audit fails on createElement ids | Declare ids in HTML; JS updates existing nodes only |
| TDZ ordering | ReferenceError when const used before top-level declaration executes | Shared state declarations must precede init calls in app.js |
| Log metadata ignored | 3 failed fix attempts blaming config files | READ THE TOOL'S OWN DEBUG LOG FIRST — npm's log said `verbose cwd E:\` before any file blame was warranted; verify process cwd before rewriting files |
| Undeclared shared var | Feature silently dead (beforeunload handler threw ReferenceError on every fire) | Enable lint gates — eslint catches 49-reference undeclared vars in seconds; static analysis IS feature work |
| Scope-trapped helper | Click handler at module scope calls fn declared inside another function | Declarations used by top-level wiring must live at module scope |
| Fixed ports in tests | Test suite exits 1 only when production stack runs (bind EADDRINUSE) | Tests bind port 0 / probe freePort(); NEVER hardcode production ports (4173/4777-4779) |

## Server Won't Start — Systematic Checklist

Run these IN ORDER. Stop at the first one that reveals the problem.

```
1. node --check <entry-file>          → syntax OK?
2. node <entry-file>                  → run foreground, capture stderr
3. Check port availability            → netstat -ano | findstr :PORT
4. Check for zombie processes         → tasklist | findstr node
5. Check disk space                   → free RAM + disk
6. Check env vars                     → are required vars set?
7. Run with NODE_DEBUG=*              → verbose internal logging
8. strace-equivalent                  → Process Monitor on Windows
```

## Integration

Feeds continuous-improvement-sop · verification-complete · process-hygiene-sop.
