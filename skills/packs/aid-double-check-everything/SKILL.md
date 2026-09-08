# aid-double-check-everything — Verification Protocol

User directive (verbatim, paraphrased for context): *"Make sure nothing gets left undone, everything gets wired together properly... do some research on what professionals do, how do they stay in line, how do they ship actual working products."* — AIDE production-readiness ask, 2026-09-01.

## The rule (per the user's directive, encoded as an operating procedure)

**No PR ships without a T1/T2 second-checker review against the AIDE audit checklist. No commit lands on `main` without the local-test battery passing end-to-end. No skill edit lands without an AGENT_NOTES entry naming the change.**

This is a process gate, not a code change. The gap it closes is exactly the one the user named: "nothing gets left undone." AIDE is a two-terminal operation (T1 = engine/UI lane, T2 = model-training/corpus lane). With two terminals and one human, the human becomes the only verification — and the human is also the one shipping to grants. The professional solution is a protocol that distributes the verification across the two terminals with the human as approver, never as verifier.

## What this skill is

1. A pre-PR checklist that any terminal (T1 or T2) runs on its own change before opening a PR.
2. A cross-checker protocol: the other terminal reviews the PR against the audit checklist before the human approves.
3. A weekly re-audit of the 12-item wiring gap (per `docs/AUDIT-2026-08-31.md`) to catch drift.

This is **NOT**:
- Code (no test framework, no CI changes, no new dependencies)
- A replacement for human review (the human still approves the final ship)
- A slowdown (the cross-check happens in the same session the PR is opened; it's not a separate meeting)

## Research base (verified 2026-09-01)

- **Jez Humble / Martin Fowler CI certification** (3-question test): every commit triggers build, green in <10 min, revert immediately on red. AIDE's CI fails #2 (the 15-min hang) and #3 (the 3 PRs sit red for days). This skill codifies the "revert immediately" half — every agent must surface a red build, not paper over it.
- **Trunk-Based Development** (Fowler, 2020): short-lived branches, merge to mainline at least daily, no long-running PRs. The 3 open PRs violate this. This skill enforces "PR lifetime < 24 hours from branch open to merge" — anything older auto-fails the cross-check.
- **Definition of Done** (Humble, "Continuous Delivery" 2010): "DONE means released. RELEASED means in production. If it's not in production, it's not DONE." AIDE is pre-production, so DONE here = "deployed locally, exercised by the human on a real task, written up in T1-T2_notes.md with the test logs and the screenshots." A PR without that log is not done.
- **Pair Programming / Mob Programming** (Beck, Extreme Programming 2004): two people on one keyboard. The terminal pair (T1+T2) is the digital equivalent — when one terminal is in flow, the other reviews in parallel.

## The 3-step pre-PR checklist (run by the author before opening a PR)

1. **Self-test battery runs green.**
   - `npm run check` exits 0 (tsc + eslint + node --check)
   - `node scripts/run-arch.mjs` exits 0 with all arch tests passing
   - The new code is exercised by at least one test that FAILS without the change
   - Logged in T1-T2_notes.md with timestamps

2. **Audit-checks against the 12 un-wired items (per `docs/AUDIT-2026-08-31.md`).**
   - Does the PR touch any of the 12 un-wired items? If yes, the audit doc must be updated in the SAME commit.
   - Does the PR close any item? Add a line to the "What Got Wired" section of the audit.
   - Does the PR open a new gap? Add a line to the "What Got Discovered" section.

3. **AGENT_NOTES.md gets an entry.**
   - Per `hard-rules` R1: append-only, timestamped `YYYY-MM-DD HH:MM`, actor named.
   - Per `hard-rules` R4: every skill edit/creation is logged in AGENT_NOTES with the skill path and what changed.
   - The entry MUST include: the commit SHA (after push), the test output (real, not paraphrased), and the next step (what the other terminal should do).

## The cross-check step (run by the OTHER terminal, before human review)

When the other terminal sees the PR open:
1. Pulls the branch, runs `npm run check` and `node scripts/run-arch.mjs` locally
2. Reads the AGENT_NOTES.md entry for the change
3. Checks against the 12-item audit: did the author update the audit doc? did they find a new gap?
4. Either approves ("LGTM, ship it") or requests changes (specific, actionable, cites the audit item)
5. Posts the cross-check comment on the PR

**Hard rule:** if the cross-check comment is missing after 24 hours, the PR is auto-flagged. The author pings the other terminal in T1-T2_notes.md.

## The weekly re-audit (every Monday morning, 30 minutes)

The 12-item audit in `docs/AUDIT-2026-08-31.md` is a living document. The terminals take turns running it weekly:
- T1 does it on Monday morning
- T2 verifies on Tuesday morning
- The result is appended to AGENT_NOTES.md as an audit entry

The audit gets a status: GREEN (no new gaps), YELLOW (new gap, not blocking), RED (new gap, blocks ship). RED triggers an immediate cross-check session.

## Threat matrix

| Threat | Likelihood | Impact | Control |
|---|---|---|---|
| Commit lands with broken test | High (we've had this) | High (red CI, blocks PRs) | Self-test battery in step 1 |
| Commit claims a feature that doesn't work | Medium | High (trust damage) | Real-task exercise in step 1 |
| Skill edit doesn't get logged in AGENT_NOTES | Medium | Medium (silent drift) | Step 3 explicit requirement |
| Two terminals make conflicting changes | Low | High | Cross-check step forces the other terminal to read the change |
| PR lifetime exceeds 24 hours | Medium (we have 3-day-old PRs now) | Medium (TBD violation) | 24-hour auto-flag |
| Audit doc gets stale | High (the 8 prior planning docs all did) | High | Weekly re-audit, mandatory |

## Operational integration

This skill composes with:
- `continuous-improvement-sop` (find-fix-encode-log for any failure)
- `hard-rules` R1/R4/R7 (append-only notes, every skill edit logged, every action appended)
- `project-governance` (the existing persistence protocol)
- `aide-release-engineering` (the release-gate rules; the CI-hang fix is the FIRST step in STAGE 2)
- `aide-advanced-orchestration` (multi-lens review — same pattern, different surface)
- `docs/AUDIT-2026-08-31.md` (the living 12-item gap audit)

## Files this skill produces (recommended)

- `docs/PROTOCOL-double-check.md` (optional) — human-readable summary, links to this skill
- An entry in `skills/registry.json` so the cross-check step appears in the workbench UI
- A `docs/PR-TEMPLATE-checklist.md` if the user wants a copy-paste pre-PR checklist

## Skill category: process / discipline
## Author: opencode (T2, 2026-09-01, per user directive 2026-09-01)
## Verified by: not yet — this is a process definition; the first cross-check session (next PR) verifies it works
