# Academy Phase A2 — Model-Powered Socratic Tutor Engine

## What
Wire local models into the tutor loop with an enforced hint ladder: L1 reframing question → L2 strategy/decomposition → L3 correction direction → worked solution only after explicit user unlock. Post-generation leakage filter rejects runnable code in hints by default. Learner-facing toggle: scaffolded (default) vs direct help.

## Why
STAP (2025): minimum-viable-hint tiers + answer-leakage definition (runnable code completing the subgoal) are the working design for guided discovery. SIGCSE pacing study: slow/Socratic default significantly improves novice learning and retention. ICER N=1059: system prompts ALONE don't change outcomes — structural enforcement (deterministic post-filter, tier gating) + learner agency does. So hints are enforced in code, not just prompted.

## Code Plan
- `academy/socratic-tutor.mjs`: `requestHint({lessonId, level, learnerCode})` → builds constrained prompt per level from lesson metadata + learner state (A1 mastery/misconceptions) → routes through existing model router (`model-runtime` chat) → **leakage filter**: reject responses containing code blocks that parse as runnable (heuristic: fenced code with language tag or >2 statements); on rejection, re-request once at same level with stronger constraint, then degrade to L(n-1) content. All attempts logged.
- Lesson JSON schema gains `hints: [{level: 1|2|3, seed}]` (author-provided fallbacks when no model is ready).
- Escalation rule: L(n+1) unlocked only after ≥2 failed check runs OR explicit request; unlock events recorded to learner state.
- Routes: `POST /api/tutor/hint {courseId, lessonId}` (server picks level from state), `POST /api/tutor/reveal {lessonId}` (explicit solution unlock; always logged). Contracts regen.
- Model down → fall back to author `hints` array; UI shows "static hints" notice. Never block the lesson.

## Dependencies
A1 learner state, model-router/model-runtime chat path, envelope/contracts pipeline.
Research: STAP MVH/leakage definitions; ICER agency finding; pacing study default-slow.

## Threat Matrix
| Threat | Control |
|---|---|
| Answer leakage via hint | deterministic runnable-code filter + one re-request + level degrade; filter unit-tested against synthetic suite |
| Jailbreak-style "just give me the code" | reveal only via explicit `/reveal` route; logged; never through chat prompt |
| Model unavailable/hangs | static-hints fallback; request timeout = existing router timeout |
| Hint quality garbage | hints always grounded in lesson metadata + learner code context; temperature low preset |
| Prompt injection from lesson files | lessons are trusted local files; learner code inserted as quoted data only |

## Issues / Bugs Watchlist
- Filter false positives (legit pseudocode) — allow `pseudo` tagged fences through; test corpus decides.
- Streaming not needed for hints (short outputs); use non-streaming route for simpler filtering.
