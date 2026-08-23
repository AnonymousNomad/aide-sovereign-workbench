# M-SOP — Model Standard Operating Procedures (the Credo, injected by the suit)

Phase skill for AIDE. Master router: aide-master-roadmap. Source of truth: developer-code-and-credo (C:\Users\Grey_\.agents\skills\developer-code-and-credo\SKILL.md) — the user's Mandalorian-derived Developer's Code. Insight: procedure the harness INJECTS is one less thing the model must remember — every plugged-in model (7B local or frontier cloud) operates under the same discipline, making weak models reliable and strong models trustworthy.

## The Law

Every model session in AIDE runs under the Developer's Code — no opt-out, no per-model exemption ("the helmet never comes off"). The orchestrator enforces it mechanically where possible; prompts carry it everywhere else.

## SOP-1: The Six-Step Task Procedure (injected into EVERY task)

The orchestrator wraps each user task in this procedure block and ENFORCES the gates:

1. **KNOW** — Before any tool call: restate objective + success criteria + what evidence will prove done. [Gate: orchestrator rejects first tool call until a plan exists (PLAN mode default, A1).]
2. **RESEARCH** — Consult workspace before acting: A2 index search + Helix memory recall + relevant file reads precede writes. Never build on guesses. [Gate: write/apply_patch tools blocked until >=1 read/search of the target area this session.]
3. **ARMOR** — Defensive construction: validate inputs at boundaries, protect secrets (no keys in code/logs), fail closed, respect resource limits. [Gate: X2 sandbox + secret-scan regex on diffs; match = blocked with reason.]
4. **BUILD** — Smallest surgical change satisfying criteria. ONE change at a time; conventions matched to surrounding code. [Gate: diff-size advisory >N lines triggers "split?" prompt; multi-intent diffs rejected by Veritas scope check.]
5. **VERIFY** — Prove with the real battery, never a smoke test: parse -> typecheck -> tests via verification ladder (X2). Claim only what ran. [Gate: "done" language without passing verification job = output rewritten as hypothesis with offer to run checks.]
6. **LOG** — What was done, evidence, next step. In AIDE this maps to: session trace artifact (I) + optional commit message draft + task note. If not logged, it did not happen. [Gate: session close without summary => orchestrator drafts one from the trace for user approval.]

## SOP-2: Phase-at-a-Time Completion (the user's own workflow, encoded)

Projects advance one PHASE at a time, like the user builds:
- A phase = named objective with explicit done-criteria (task system B1/B3 gives it structure).
- Rule: no new phase starts while the current one has failing verification or unlogged work. The orchestrator surfaces current-phase status in chat context so any model knows WHERE the project stands.
- Anti-pattern watch (credo: "walk the Way, no circles"): if a model revisits the same subtask 3+ times without state change, escalate to ask_user with diagnosis — circling is creed failure.

## SOP-3: Creed Failure Protocol (when a gate fails or a claim breaks)

1. STOP. 2. Surface honestly to the user (what failed, evidence). 3. Fix root cause (not the symptom, never lower thresholds / stub checks / silence errors). 4. Rerun the failed check. 5. Log the event.
[Enforcement: any attempt to bypass a gate (e.g., edit around sandbox, disable a check) is itself logged as creed-failure event + requires user consent to proceed.]

## Injection Mechanics

- Orchestrator prepends compact procedure block (~300 tokens) per task; full text available via `sop_read` tool so weak models aren't forced to hold it all in-window.
- Procedure-following is MEASURED (trace tags: plan-before-tool, research-before-write, verify-before-done). Per-model compliance rates land in the personalization layer — they drive the escalation ladder and the flywheel's insight extraction (X2).
- The credo text itself ships as a bundled skill file visible/editable in the skill palette (S1 curation) — users can read exactly what governs their models.

## Tests FIRST

1. Gate enforcement: write-before-read blocked w/ envelope reason; allowed after search.
2. Verify-gate: "tests pass" claim with no job id -> rewritten hypothesis output.
3. Secret scan: API-key-shaped string in proposed diff -> blocked, cited line.
4. Scope check: diff touching unrelated module flagged split-or-confirm.
5. Circle detector: 3 repeated identical subtask attempts -> ask_user fires.
6. Compliance metrics: seeded traces -> rates computed exact; low-compliance model routes up escalation ladder.
7. sop_read round-trip; arch strict contracts; openapi zero-diff.

## Pitfalls

- Procedure blocks must stay SHORT — context rot kills small models; gates do the real enforcing, prose is secondary.
- Don't punish exploration in PLAN mode (research IS the point there); gates bind mutating actions only.
- Compliance metrics are LOCAL-only diagnostics, never uploaded (V1 law).

## Gate

Unit+arch green; e2e: fixture task run by stub sloppy model WITH SOP injection completes cleanly vs WITHOUT fails — delta recorded as our own harness-beats-model evidence point in AGENT_NOTES. Journal.
