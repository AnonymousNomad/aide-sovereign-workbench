---
name: aide-task-verification-battery
description: The post-task verification battery AIDE uses to prove work is done, derived from Google Testing Blog (Wacker 2015), Martin Fowler's Practical Test Pyramid (Vocke 2018), the Google SRE Book Chapter 8 on Release Engineering, and Jez Humble's 3-question CI Certification. Use at the END of every task that changes code, skill, or evidence files, BEFORE claiming "done". Replaces the "smoke tsc" reflex with a real, time-budgeted, layer-by-layer check. If any layer fails, R8 says: stop, research, fix, retry — never lower the threshold. Pairs with: developer-code-and-credo, professional-developer, production-readiness, hard-rules, project-governance.
---

# AIDE Task Verification Battery — from "smoke" to "proven"

## The failure this skill fixes

Before this skill existed, the post-task reflex in this codebase was: run
`tsc --noEmit` once and call it done. That's a **smoke test**, not verification.
Per Google SRE Chapter 8: "If 90% of e2e tests pass, that's not a release —
that's 10% you don't understand." Per Martin Fowler: "Tests verify behavior,
not implementation." Per the developer-code-and-credo: "A developer does
not speak unless they know. Every claim carries observed evidence." **Smoke
is not evidence.** A real verification battery is.

## Research base (primary sources, verified 2026-08-29)

1. **Mike Wacker, Google Testing Blog (2015)**, "Just Say No to More
   End-to-End Tests" — https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html
   - The test pyramid: most unit, some integration, fewest e2e.
   - Flaky environments corrupt test signal. Tests must run in a stable env.
2. **Ham Vocke, Martin Fowler / Thoughtworks (2018)**, "The Practical Test
   Pyramid" — https://martinfowler.com/articles/practical-test-pyramid.html
   - Layers: unit → integration → contract (CDC) → UI/e2e → exploratory.
   - "Avoid test duplication — each layer tests what ONLY that layer can test."
3. **Google SRE Book, Chapter 8 (Dinah McNutt)**, "Release Engineering"
   — https://sre.google/sre-book/release-engineering/
   - "SREs need to know that the binaries and configurations they use are
     built in a reproducible, automated way so that releases are
     repeatable and aren't 'unique snowflakes.'"
   - "It's cheaper to put good practices and process in place early,
     rather than have to retrofit your system later."
4. **Martin Fowler (2017)**, "Continuous Integration Certification" (citing
   Jez Humble) — https://martinfowler.com/bliki/ContinuousIntegrationCertification.html
   - The 3-question test: (1) every commit triggers automated build+test,
     (2) green in <10 minutes, (3) revert if not. **If your commit build
     takes >10 minutes, the fix is to revert, not to push through.**

## The 10-layer battery (ordered cheapest → most expensive)

Run layers in this order. **If any layer fails, STOP per R8 (twice-fail law).**
Do not skip layers. Do not run later layers before earlier ones pass. Do
not "loosen" a failing check to make it pass.

| # | Layer | What it catches | Time budget | Command in AIDE |
|---|---|---|---|---|
| 1 | **Compile / typecheck** | Type errors, syntax errors, import cycles | <10s | `node_modules\.bin\tsc.cmd --noEmit -p tsconfig.node.json` |
| 2 | **Lint / format** | Style violations, unused vars, common bugs | <10s | `npx eslint . --max-warnings 0` (or skip if not in package.json scripts) |
| 3 | **Unit tests** | Pure logic bugs (no I/O) | <30s | `node --test tests/unit/test-facade.mjs tests/unit/test-memory-spine.mjs tests/unit/test-memory-blocks.mjs` (per `package.json:scripts.test`) |
| 4 | **Arch / contract tests** | Schema drift, response shape violations, type contract mismatches | <60s | `node scripts/run-arch.mjs` (serial, port 0 to avoid EADDRINUSE) |
| 5 | **OpenAPI / contract regen** | API docs match code (per `aide-debugging-discipline` "Contracts regen order" trap) | <30s | `npm run contracts` then `git diff openapi.json` (must be empty or 100% additive) |
| 6 | **Smoke e2e (real backend)** | Does the stack boot and serve 200? | <60s | Stack already up: `curl :4777/api/health` + `curl :4778/api/health` + `curl :4777/api/models/status`. If 503s, abort. |
| 7 | **Integration (engine + chat)** | Does the engine actually answer? | <120s | `POST :4777/api/models/start {id:...}` → poll `:8091/v1/models` → `:200` → `POST :4777/api/chat` with the documented body → `:200` with `{text, modelId, harness.injected:true}`. **The 120s budget accounts for the engine cold-load (72-90s per `aide-inhouse-model-runtime` §0) plus a 30s safety margin.** |
| 8 | **Performance / regression** | Did throughput drop? | <5m | For model changes: `llama-bench -m <model> -p 512 -n 128 -r 5 -o json -ngl -1` (pp512 + tg128 means±stdev). For code changes: `npm run check:arch` (tsc node + tsc browser + eslint + arch). |
| 9 | **Manual / exploratory** | "Does it feel right?" | Variable | User-driven, browser clicks, real chat, real desktop actions. |
| 10 | **Process hygiene** | No stragglers left running, no orphan children, no wedged shells | <5s | `tasklist \| findstr /i "node.exe llama python"` — assert against expected baseline. Per `process-hygiene-sop`. |

## The 3-question CI certification (Jez Humble, via Fowler)

Before claiming "done" for any task, answer these three:

1. **Did every change trigger an automated build + test?** (Layer 1-3 here.)
2. **Did the green happen in <10 minutes from the last commit?**
3. **If the build was red, did you revert, not push through?**

If answer to (3) is "I pushed through because the failure was obviously
unrelated" — that is the failure mode. Stop. Investigate. Fix the check
OR fix the code; never both at once.

## The "smoke" anti-pattern — explicit list of what a smoke test is NOT

A smoke test is:
- One compiler invocation (`tsc --noEmit`) — catches types only
- One test command (`npm test`) — catches unit only
- One HTTP curl (`curl /api/health`) — catches "did the server answer" only
- One engine query (`curl :8091/v1/models`) — catches "is the engine listening" only

None of those prove the system works. The user-facing surface is the
combination: contract + arch + smoke + integration. **Smoke alone is
releasing with 10% of the picture missing.**

## The session-1 lesson encoded (2026-08-29)

The T2 (cline) terminal started running `node_modules\.bin\tsc.cmd --noEmit
-p tsconfig.node.json` as a smoke check and was correctly stopped. The
user said: "Smoke checks just get us in collateral. Do research on how to
do proper verifications of compilations after a task is finished batteries
probes what does big tech say and how the professionals do it. Do we need
to do that and create a skill off that's we know how to properly run tests."

This skill IS that ask. The research is in. The 10-layer battery above
is the "batteries and probes" the user asked for. Apply it from now on.

## When to apply (gates, not optional)

- Every code change (route, service, contract, runtime)
- Every skill file change (R4: "Every skill edit gets a journal entry" + this layer cake)
- Every docs/evidence/ file change (Phase 1 success criteria verification)
- Every `commit -m` (the pre-commit hook runs Layer 1+3+lint; we extend
  the human's check to include Layer 4-5 manually)
- Every `git push` (the CI gate does Layer 1+3+4+5+arch automatically;
  the human's check is to do Layer 6-7 live before declaring done)

## When NOT to apply

- Documentation-only changes (skill, README, plan doc) — Layers 1-3 still
  apply if the doc is generated from code; if it's pure prose, no check
  is needed beyond a "did the file save" read.
- `.aide/` working state (e.g., `backends.json`, `cipher-state.jsonl`) —
  these are untracked live config; the verification is that the daemon
  reads them correctly, which Layer 6 covers.
- One-liner hot fixes during a wedged shell — emergency escape hatch,
  not the rule. Log the skip in AGENT_NOTES.

## Failure protocol (per R8, encoded)

When a layer fails:

1. **STOP** the chain. No "skip and continue" — that's the failure mode.
2. **Read the failure** (one hypothesis at a time, per `aide-debugging-discipline`).
3. **Fix root cause** — never silence the check.
4. **Rerun the layer** until green.
5. **Rerun the dependent layers** (e.g., if Layer 7 fails, you must re-pass
   Layers 1-6 first, because the fix may have broken something earlier).
6. **Log** in `AGENT_NOTES.md` (R1) and `T1-T2_notes.md` (cross-terminal sync).

## Pitfalls (learned the hard way, encoded)

1. **"Smoke tsc is enough."** No. Layer 1 alone proves types compile, nothing else.
2. **"Lint is just style."** No. Lint catches unused vars, shadowed imports,
   and the "this import was supposed to be removed" class of bugs.
3. **"The engine serves 200, ship it."** No. That's Layer 7 partial; the chat
   path may still hang on cold-load (we proved this in 2026-08-29).
4. **"I'll just run the failing test with --force."** No. `aide-debugging-discipline`
   has the same rule under "Twice-fail law": same step failed twice → STOP.
5. **"The pre-commit hook already ran tsc + lint + mjs check, so we're good."**
   That's Layers 1, 2, 3 (mjs syntax). It's a subset. Layers 4-10 are still yours.
6. **"git push to a CI branch and let CI tell me."** That's lazy. CI catches
   issues, but you should know your own work is good before pushing.
7. **"Skipping the chat e2e because the engine takes 90s to load."** That's
   exactly when the chat e2e matters most — it's the bug we just found.
8. **"Layer 6 passed last time, it should pass this time."** State changes.
   Port reuse. Disk. Re-check, don't assume.

## Verification gates for THIS skill (meta-check)

- [ ] A task using this battery has had at least 5 layers run end-to-end
- [ ] At least one task has had ALL 10 layers run end-to-end
- [ ] At least one failure has been caught by Layer 4+ (not Layer 1) — the
  test pyramid works only if the harder layers actually catch things
- [ ] A CI pipeline (Layer 1+2+3+4+5+arch) runs on every commit and
  returns green in <10 minutes (Jez Humble rule)
