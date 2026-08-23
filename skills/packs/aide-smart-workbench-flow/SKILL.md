---
name: aide-smart-workbench-flow
description: UX law for the AIDE cockpit redesign — one workflow (Describe, Plan, Approve, Build, Verify, Ship), human-in-the-middle orchestration, three-zone layout, states-not-modes, progressive disclosure, teach-by-doing checklist. Use whenever touching ANY AIDE frontend file (HTML/CSS/JS), deciding what is visible where, adding a control, judging "is this confusing", or building the orchestrator loop UI. Encodes the 2026-08 research base (Microsoft first-five-minutes, Userpilot contextual onboarding, VS Code walkthroughs, flow science, Mozzie orchestrator patterns) into enforceable rules.
---

# Smart Workbench Flow — The Cockpit Law

Born 2026-08-24 after the operator (the ONLY user) reported: "Nothing of it is
understandable, it doesn't work properly, it's so confusing." Root cause found
in code, not in the user: four generations of CSS hide-rule overrides
("MODEL-FIRST LOCK" etc.) fighting each other over the same elements — an
accretion fossil, not a design. Patching it further is forbidden.

## Thesis

AIDE is the SUIT; the model is the cognition; the HUMAN is the commander in the
middle. Every pixel must answer: what can I do NOW, what happens if I click
this, and what does AIDE recommend next. The orchestrator (AIDE itself) is
smart: it proposes the next step, never leaves a dead end, never bricks.

## The One Workflow (everything serves this loop)

DESCRIBE -> PLAN -> APPROVE -> BUILD -> VERIFY -> SHIP -> repeat.
The human describes intent and approves checkpoints. AIDE plans, drives tools,
verifies, reports. Model quality varies; the loop stays constant.

## Layout Law — Three Zones (the cockpit)

- LEFT (fixed ~340px): ORCHESTRATOR. Describe box, then the live loop as CARDS:
  Plan card (review/edit) -> APPROVE button -> Build stream -> Verify verdict ->
  Ship/checkpoint. This is the primary daily surface.
- CENTER (flex): WORKBENCH. Editor/diff/preview. Diffs appear here when the
  agent proposes changes; approve/revert lives ON the diff.
- RIGHT (~280px): VERIFY RAIL. Gates, diagnostics count, git branch/status,
  files touched, HARNESS ON badge. Collapses to icons when narrow.
- BOTTOM strip (one line): STATE + NEXT ACTION. Always says the single most
  useful next step ("Model starting…", "Plan ready - review it", "All green -
  say 'ship it'").
- TOPBAR: identity, workspace, model chip (name + ready dot -> click opens
  model sheet), HELP, command palette hint. Nothing else.

## States Not Modes Law

NO mode toggle. NO simple/advanced switch. Visibility comes from STATE:
- COLD (no model ready): center shows one card - device fit line, recommended
  model, ONE button "Start". Left describe box present but disabled with hint.
- READY: full cockpit.
- BLOCKED (any failure): inline recovery card at the point of blockage
  (No-Brick-Wall): what failed, why, the ONE recommended action, plus escape
  hatches. Never a dead spinner.
Advanced tools (terminal, extensions, training, community, BYOK...) exist ONLY
inside the command palette and relevant context moments. If a feature is used
monthly, it is TWO keystrokes deep, not on screen.

## Progressive Disclosure Law (frequency-of-use hierarchy)

- Daily surfaces: describe box, editor, status strip. Permanent.
- Weekly surfaces: files, git detail, tasks: one click from their context
  (click file count in rail -> file list; click branch -> git sheet).
- Monthly surfaces: model hub/import, settings, BYOK, extensions: command
  palette + contextual entry points only.
Every new control MUST declare its frequency tier before being added. If it
argues for "visible always", it had better serve the core loop.

## Teach-By-Doing Law (onboarding)

Replace the modal launch guide with a CONTEXTUAL CHECKLIST that advances on
completion, not on click-through:
1 Pick a model -> auto-done when manifest has selection.
2 Start it -> done on green READY.
3 Describe a task -> done on first submit.
4 Review the plan -> done on first approval.
5 Watch verification pass -> done on first green gate.
Shown inline (right rail bottom or under describe box), each step has its
action button embedded. Re-openable forever via HELP. Never nag completed
steps. First-run may use ONE overlay pointing at the describe box, dismissed
forever after step 1.

## Feedback Law

Every action gets observable feedback <100ms (button press state, optimistic
card, stream start). Long operations show LIVE progress (tokens, download
bytes, gate results), cancellable, with the stop button adjacent. Silence >2s
requires a progress indicator; silence >10s requires an explanation line.

## Honesty Surfaces Law

HARNESS ON badge visible whenever scaffold injection is active. Verify rail
shows REAL gate outcomes; failures render red with reason, never swallowed.
Agent-proposed diffs ALWAYS require explicit human approval before apply
(approval gate is the product, not friction).

## Continuity Law (local<->cloud as one assistant, two engines)

The model chip in the topbar is the seam. Clicking it opens the model sheet:
bundled models first (with fit verdicts), then an OPT-IN section for cloud
subscriptions/BYOK, visually separated, labeled "requires internet - you choose".
- Switching models mid-task carries the SAME conversation/task state (H1
  handoff machinery) — never copy-paste, never restart.
- Cloud actions are always explicit user gestures; every crossing shows a
  one-line "what will be sent" summary and lands in the egress journal.
- Local->cloud->local round trips render as ONE thread; engine badges mark who
  spoke, so cloud and local models visibly collaborate on the same problem.
- Offline or opted-out: zero cloud affordances shown, zero dead buttons —
  the cockpit is fully capable from the bottle alone (In-the-Box).

## Implementation Rules (non-negotiable)

- R1: The redesigned shell REPLACES the root surface (index.html/app.js/
  styles.css rewritten clean; zero inherited hide-rules). Old shell preserved
  in git history + backup copy before overwrite. No fourth override layer,
  ever. New CSS = tokens + components only; any future visibility change edits
  the component rule, not an override appended at file end.
- R2: New shell talks ONLY to verified facade endpoints (:4777). No new daemon
  routes invented in UI work; missing capability = daemon ticket.
- R3: File saves from UI send approved:true BECAUSE the human pressed save;
  agent-proposed writes go through the approval-card path instead.
- R4: One vertical slice walking the full loop beats five polished panels.
  Build order: skeleton+describe+model start (slice 1), plan/approve/build
  cards (2), verify rail+diffs (3), checklist+polish (4), hub/settings sheets (5).
- R5: Every slice ends with the operator able to DO the loop step in a real
  browser session, verified by evidence (their words or screenshots/logs).
  Confusion reported by the operator = P1 bug against THIS skill.
