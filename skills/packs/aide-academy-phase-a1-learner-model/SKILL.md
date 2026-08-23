# Academy Phase A1 — Learner Model & Spaced Review

## What
Replace binary lesson progress with a persistent learner state: `learner-state.json` holding per-skill mastery estimates (0–1), misconception tags, attempt counts/timestamps, and an SM-2-lite spaced-repetition review queue. Single-writer update API; all updates auditable.

## Why
IntelliCode (EACL 2026) identifies persistent learner modeling as THE foundation of principled tutoring — mastery estimates, misconceptions, review schedules under a single-writer policy. Current `tutor-manager.mjs` progress is completed/not-completed only; no tutoring system can adapt without a learner model.

## Code Plan
- New `academy/learner-state.mjs`: `LearnerState` class — load/save (atomic tmp+rename, corrupt-file backup+reset pattern copied from session-store), `recordAttempt(skillId, {passed, misconceptionTags, at})`, mastery update rule (exponential moving average: m' = m + k*(outcome - m), k=0.3 pass / 0.5 fail-weighted), `dueReviews(now)` returning review queue sorted by SM-2-style interval × ease.
- Schema versioned (`schema_version: 1`); migration from existing tutor-progress file (completed lessons → initial mastery seeds per course-skill mapping).
- Daemon routes (envelope-wrapped): `GET /api/learner/state`, `GET /api/learner/reviews`, `POST /api/learner/attempt`. Regenerate OpenAPI contracts (`npm run contracts`) — drift test enforces.
- TutorManager.complete() calls LearnerState.recordAttempt on lesson completion (single-writer: only learner-state writes mastery).

## Dependencies
Existing: session-store atomic-write/backup pattern, envelope errors, contracts pipeline, TutorManager progress path.
Research: IntelliCode single-writer learner state; SM-2 intervals (SuperMemo-2 algorithm, public domain).

## Threat Matrix
| Threat | Control |
|---|---|
| Corrupt/hand-edited state | atomic writes + `.bak` reset (proven pattern); schema_version check |
| Mastery inflation by re-running checks | attempt records immutable append-log; mastery formula considers recency + failure weight |
| Privacy | file stays in local workspace dotdir; never leaves machine (offline doctrine) |
| Route drift | openapi-drift test fails CI unless regenerated |

## Issues / Bugs Watchlist
- Clock skew: store timestamps as ISO strings; due-review math tolerant to future stamps.
- Course→skill mapping is manual metadata in each course JSON until Curriculum Studio exists; missing mapping = lesson completion records under synthetic skill id `<courseId>:<lessonId>`.
