---
name: aide-desktop-control-cipher
description: Scale AIDE's desktop control from staged data to a working in-house-model act loop — serve Cipher (or the small model) as the desktop-control policy model, expand trajectory categories beyond the current 2, generate verified trajectories with the existing sandbox discipline, wire the act/pending/verdict flow in routes/desktop.ts to the trained model, and keep the grants + panic safety model absolute. Built on T2's 1,098 verified desktop-control rows (explorer/browser/multi-window/calculator queued). Use when advancing desktop automation, generating or serving desktop-control trajectories, integrating the house model into desktop act(), expanding task categories, or reviewing desktop safety.
---

# Desktop Control × Cipher — The House Model Drives the Desktop

Born 2026-08-27 gap analysis: desktop control is MORE built than assumed —
node/src/services/desktop-control.mjs + routes/desktop.ts already implement
status/act/setGrants/panic/pending/verdict (zod-validated, grants-gated) — and
T2 staged 1,098 unique verified desktop-control trajectory rows. What's
missing: (1) the act loop does not use the IN-HOUSE model (policy inference
path unclear/unwired), (2) trajectory breadth is 2 task categories, (3) no
feedback loop from verdicts back into training. This skill closes the loop:
data → train → serve → act → verdict → data.

## Research base (verified 2026-08-27)

1. In-repo: desktop-control service (grants manifest, act, panic, pending
   submit, verdict) — the safety shell is BUILT and routed; AGENT_NOTES
   2026-08-26: "1,098 unique verified desktop-control rows staged; generator
   stabilized 90/90; honest limit = 2 task categories; breadth expansion
   queued (explorer/browser/multi-window/calculator)".
2. Rival context (researched 2026-08-27): desktop/GUI automation is an
   emerging 2026 agent surface (Cursor Mission Control is window oversight;
   OS-level automation remains rare) — AIDE's head start is the verified
   trajectory corpus + grants/panic safety shell, a genuine differentiator.
3. House-model lane: cipher v1 (4B, in-box) + training pipeline (QLoRA Phase D
   queued per AGENT_NOTES 2026-08-26) — the serving target.

## What to do (direct)

1. SERVE THE POLICY MODEL: desktop act() must call an in-box engine (cipher,
   or the small model for tight loops) via the local HTTP endpoint — same
   lifecycle doctrine; NEVER an external API. Wire: desktop-control policy
   hook → model endpoint → structured action JSON, grammar-constrained per
   aide-grammar-constrained-generation (action enum + coords/keys as schema,
   GBNF enforced).
2. BREADTH LOOP (one category per PR): next category (explorer → browser →
   multi-window → calculator); generate trajectories ONLY through the existing
   verified generator (90/90 battery); each row = screenshot/state → action
   JSON → post-state verifier. Reject-and-log is data too.
3. VERDICT FEEDBACK: routes/desktop.ts verdict results append to the training
   corpus (accepted/failed + failure reason) — the act loop becomes the
   labeling machine. Weekly merge into the QLoRA dataset per training SOP.
4. CONFIDENCE GATE: model outputs carry confidence; below threshold → pending
   queue for operator verdict instead of acting (pending/verdict endpoints
   exist — use them).
5. BREADTH GATES: every new category ships with a battery (generator battery
   pattern) BEFORE act() accepts that category from the model.

## Why it's done this way

- The differentiator is NOT "we can drive a desktop" (cloud agents do it) — it
  is "OUR OWN 4B model drives it, locally, with operator-owned safety rails".
  Every decision keeps inference local and safety in-repo.
- Verdict-as-labeling: the operator is already in the loop (pending/verdict);
  reusing those judgments as training data compounds the corpus for free and
  closes the data → train → serve → act → data loop.
- Grammar-constrained actions eliminate the #1 desktop-control failure mode
  (malformed action JSON) at the model level instead of with retries.

## Dependencies / issues / bugs

- Depends on: desktop-control.mjs service + routes (built), grants/panic
  (built), grammar-constrained generation (built), trajectory generator +
  battery (built, 90/90), training pipeline (QLoRA Phase D queued), engine
  lifecycle doctrine (shipped 2026-08-27).
- Memory coexistence: cipher + completion engine + desktop inference — the RAM
  floor law holds; desktop inference REUSES the cipher engine, never a third.
- Screenshot state → prompt size: images need a vision-capable model; current
  corpus is state-serialized (window title, focused element, last action) —
  keep it unless a vision model ships in-box.
- Windows UI automation flakiness: coordinates drift with DPI/resolution —
  trajectories store relative coordinates + target window class, never
  absolute pixels (verify the generator; if not, fix generator first).

## Threat matrix

| Threat | Signature | Defense |
|---|---|---|
| Runaway automation | act loop types into wrong window / infinite loop | grants manifest + panic (built); action-rate ceiling; per-category allowlist |
| Malformed actions from small model | invalid JSON, phantom keys | GBNF grammar-constrained output; schema validation before execute |
| Destructive categories too early | model attempts file-delete class actions | category allowlist in act(); destructive classes require operator-in-loop verdict |
| Training data poisoning via verdicts | hostile app tricks operator verdicts | verdicts carry state + action context; corpus review before merge |
| Screen-content exfiltration | state serialization leaks secrets into prompts | state schema excludes password fields (deny-list by window class/title); prompts never leave the box |
| Coordinate/DPI drift | actions miss targets on resolution change | relative coords + window-class targeting in trajectories |
| Model replacement drift | external API swapped into the policy hook | all-local law: endpoint must be 127.0.0.1; egress audit check in CI |

## Pitfalls

- Do NOT skip the verifier when generating breadth — unverified rows poisoned
  corpora before (anti-trash-data doctrine).
- Do NOT serve desktop policy from the chat model concurrently with chat —
  one engine, queued requests, doctrine-managed.
- Do NOT widen categories before the previous category's battery is green.
- Do NOT log full screenshots to disk uncontrolled — state text + hashes only.
- Do NOT trust model confidence blindly — thresholds are measured from verdict
  data, not guessed.
