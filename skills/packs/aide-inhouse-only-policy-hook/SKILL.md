---
name: aide-inhouse-only-policy-hook
description: The doctrine that AIDE's desktop-control act() MUST route the policy inference through the in-house model (Cipher v1, 4B) — never a cloud model, never a BYOK provider. Why this is the differentiator (a small model fine-tuned on a verified desktop-control trajectory corpus is more reliable on that exact task than a giant cloud model with no domain adaptation), how to gate it in routes/desktop.ts and the agent's desktop_action tool, and how the operator-overrides-the-safety-rails exception works for the rare case where the operator chooses a different model. Use when wiring the policy hook, when the desktop service gains a new caller, when reviewing desktop safety, or when a user asks "why doesn't my cloud provider work for desktop control".
---

# Desktop Control — In-House Model Only

Born 2026-08-28 from the operator's directive: "as of right now the
only model we're going to allow to be used for desktop control is
our in-house model because we have specifically fine tuned for this
kind of workflow." This is the doctrine for that decision and the
mechanics that enforce it.

## Why this is the differentiator

The competitive claim is **not** "AIDE can drive a desktop" — every
cloud agent in 2026 can do that. The claim is **"AIDE's house model
drives the desktop, locally, with operator-owned safety rails."** Three
reasons in priority order:

1. **Domain adaptation beats scale, on narrow tasks.** Cipher v1 is
   a 4B model that we have specifically fine-tuned on verified
   desktop-control trajectories (1,098 rows per AGENT_NOTES
   2026-08-26, 90/90 generator battery). A giant cloud model with
   no desktop-specific training has a higher loss on the exact
   question "given this Windows snapshot and this grants manifest,
   emit the correct desktop_action DSL". A 4B model that's seen
   the task 1,000 times beats a 1T model that's seen it 0 times.

2. **Latency + all-local loop.** The desktop act() cycle is
   sense-parse-execute-snapshot-verify. The model's response is in
   the hot path. A 4B model on the local GPU returns a DSL action
   in 50-200ms; a 1T cloud model takes 1-3s. The hot path gets
   faster, the operator's pending-approval experience improves, and

## What "in-house only" means concretely

- `cipher v1` (4B, fine-tuned on desktop-control trajectories) is the
  **only** model allowed in the desktop policy hook. The hook
  resolves a model by ID and fails closed if the model is not
  `cipher` family.
- BYOK providers are **not** in scope. Even if the operator has
  `OPENAI_API_KEY` set, `desktop_policy.resolveModel('desktop-act')`
  returns Cipher, not GPT-5. The operator can override per-call
  via a wizard that REQUIRES a one-time confirmation; the override
  is logged.
- The fine-tune is the contract. If the operator wants desktop
  control backed by a different model, the workflow is: ship
  verification trajectories + eval battery for the new model, pass
  the battery, then add to the allowlist. There is no "just swap
  the model" path.

## Where this is enforced

The policy hook has to live in three places; missing any one is a
safety hole:

### 1. The desktop service's policy hook (the canonical gate)
`node/src/services/desktop-control.mjs` does NOT currently invoke a

## Threat matrix

| Threat | Signature | Defense |
|---|---|---|
| Operator routes desktop to a cloud model | byok routing includes `desktop-act: 'openai'` | Policy hook fail-closed: model not in cipher allowlist throws BEFORE act() |
| BYOK provider is the chat model at chat time | operator selects a non-cipher chat model | Desktop-only: the chat model is irrelevant; the desktop policy hook is independent. The chat model proposes; the policy model executes. |
| Cipher model itself goes off-policy (rogue generation) | action tries credential field or out-of-scope target | Existing desktop-control safety: grants + panic + DesktopRefusedError codes + zod-validated op enum. Plus the trajectory recorder captures the bad action as refusal-recovery training data. |
| Operator overrides the safety rail for a single call | wizard sets a non-cipher model in the override slot | The override is LOGGED in the trajectory with `policy_override: true, model_id, operator_id, reason`. Override count per session is capped at 3. After 3 overrides in a session, the hook fails closed. |
| Trained model emits a dangerous action | model has been fine-tuned on verified trajectories, but adversarial input could still trick it | Same defenses as above. Plus: any model output that fails to parse becomes a NO_APPROVAL refusal + trajectory entry. The corpus grows with the failure. |
| Cipher model not running when the policy hook fires | `models/manifest.json` lists cipher but no engine is up | Hook returns `POLICY_MODEL_NOT_READY`. The agent's `desktop_action` tool surfaces this as `NOT_READY` and the operator must wait or start cipher. No fallback to a different model. |

## Pitfalls

- **Do NOT add a "fallback to any chat model" path** to the policy
  hook. The whole point of this doctrine is that desktop control is
  NEVER a generic chat completion. If cipher is not ready, the
  hook fails; the operator sees the failure; the operator starts
  cipher. The system teaches the operator to keep cipher running
  for desktop sessions.
- **Do NOT let the override slot persist** between sessions. The
  override is a per-call flag set by the operator through a wizard,
  not a session preference. Each session starts with cipher-only.
- **Do NOT skip the trajectory record on the policy-override path.**
  Override rows are MORE valuable than normal rows — they teach the
  fine-tune what the operator accepts in edge cases.
- **Do NOT let the operator train a non-cipher model on the
  desktop corpus.** The corpus is a competitive asset; it trains
  the house model only. BYOK users do not get the corpus. This is
  encoded in the file permissions on `.aide/desktop/trajectories/`.

model — `act()` takes a pre-formed request. The policy hook is the
new code that comes between the operator / agent and `act()`. It
must:
- Look up the model configured for the `desktop-act` role in
  `models/manifest.json`.
- Fail closed if the model is not in the cipher allowlist
  (allowlist = `cipher` family, currently `cipher v1`).
- Invoke the model with a structured action DSL
  (see `aide-desktop-control-cipher` skill + `aide-grammar-constrained-generation`).
- Validate the response against the same parser the agent uses
  (`parseDesktopAction` in `node/src/services/desktop-policy.mjs`).
- Pass the parsed action to `desktop.act()` with `approved: true`
  (because the operator has approved the policy hook's invocation
  by configuring it; the agent's `desktop_action` tool is NOT
  this hook — the agent goes through its own approval flow).

### 2. The agent's `desktop_action` tool
The agent tool already routes to `desktop.act()`. The policy hook
sits IN FRONT of the agent tool for model-driven proposals (future
work, Phase D per `aide-desktop-control-cipher`). The current
`desktop_action` tool is operator-driven or scripted — the model
drafts a proposal, the operator approves, the tool runs. No change
needed to enforce in-house-only here; the change is in the policy
hook above.

### 3. The telegram /ask brain
`telegram-brain.mjs` builds a system prompt and calls the
cipher-first model. The current `resolveEngineChat` already prefers
cipher. The new rule: when the request is a desktop action, the
brain MUST resolve to cipher even if a cloud model is in the
operator's route config. Add an explicit guard at the call site.

   the model never sees the snapshot leave the box.

3. **Operator-owned training data.** Every action the house model
   proposes, every operator verdict (approve/reject), and every
   refusal-recovery row becomes training data for the next fine-tune.
   Cloud models don't return their inference traces; the in-house
   model does. The corpus compounds. A cloud provider's model is
   fixed at the moment of last training; the house model is alive.
