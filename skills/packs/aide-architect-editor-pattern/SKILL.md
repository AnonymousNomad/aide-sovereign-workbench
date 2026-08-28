---
name: aide-architect-editor-pattern
description: The two-call decomposition for any agentic surface that needs higher quality from a smaller model — Architect reasons + plans (no file changes, no tools), Editor translates the plan into exact edits. Use when a small/medium model is bottlenecked on direct editing; when chat quality is plateauing on 4B-7B models; when the user asks for "think harder" / "plan first" / "/think"; when a subagent would normally be spawned but the work is small enough to inline. Based on Aider's architect/editor mode (proven with o1 + GPT-4o), generalized for any AIDE surface.
---

# Architect → Editor Pattern

Born 2026-08-28 from rival gap analysis (Cursor, VS Code, Claude Code,
Cline, Aider, Windsurf, Replit all converge on this pattern in some
form). The two-call decomposition is the single highest-leverage
**architectural** improvement AIDE can ship — it lets the small
house model (cipher 4B) reach planning quality that only much larger
cloud models can do directly, because the **editor** is just a
syntax-aware translator, not a planner.

## Research base (verified 2026-08-28)

1. **Aider architect/editor mode** (aider.chat/docs/usage/modes.html):
   architect proposes, editor edits. Two model calls. Default editor
   is auto-selected per architect (e.g. o1 architect + Sonnet editor).
   "Certain LLMs aren't able to propose coding solutions and specify
   detailed file edits all in one go. For these models, architect
   mode can produce better results." Article: "Aider's
   architect/editor mode for detailing changes."
2. **Cursor, Claude Code, VS Code, Cline, Replit**: every rival
   internally has a "think then do" two-phase pattern. Some
   surface it (Plan/Act), some hide it. The principle is the same:
   separate reasoning from mechanical action.
3. **AIDE audit 2026-08-28**: we always do one model call. The agent
   loop calls the model with system + transcript, gets back tool
   calls, runs them. For small models this means the same
   "reasoning budget" is split between (a) deciding WHAT to do and
   (b) producing the exact `<tool>...</tool>` syntax. (b) is
   trivially mechanical; (a) is the hard part. We can use a small

### Concrete rules

1. **Architect and editor CAN be the same model.** Aider explicitly
   says "architect mode can also be helpful when you use the same
   model as both the architect and the editor." The two-call gives
   the model two shots at the problem; the second shot sees the
   first shot's plan and only has to translate, not re-reason.
2. **Architect output is a fenced `## Plan` block.** No tool calls
   in the architect stage. A parser extracts the block from prose.
3. **Editor output is the same XML tool call format we already use.**
   No schema change. The plan becomes a system-prompt prefix: "You
   are the editor. Translate this plan into AIDE tool calls..."
4. **If the architect emits tool calls anyway**, we treat the whole
   thing as editor output and skip the second call. Don't waste
   tokens.
5. **If the plan is empty or unparseable**, fall through to the
   current one-call path. The pattern is opt-in, not a hard cut.
6. **The architect prompt includes the credo and harness scaffold.**
   Same content, different framing. "Read first, plan second, never
   edit" is the only behavioural change.
7. **The editor prompt is the current agent prompt + the plan.**
   The model sees the plan as a contract to fulfill, not as a
   suggestion to re-reason about.
8. **Telemetry records both calls.** The `agent:message` and

## Why it's done this way

- **Quality**: a small model given a clear plan will produce correct
  tool calls more reliably than the same model asked to both
  reason AND emit XML. We remove the cognitive load of XML
  formatting during reasoning.
- **Auditability**: the operator sees the plan BEFORE the editor
  runs. This is the same pattern Cursor + Replit + Aider ship.
  Reviewing a plan is faster than reviewing diffs.
- **Cost**: when architect and editor are the same model, we pay
  for 1 extra call. When the editor is a smaller model, we save
  cost. Same wiring, both modes win.
- **All-local**: the architect and editor are both served from the
  in-house engine. No cloud, no telemetry. The two-call happens
  inside AIDE.
- **Backwards compatible**: the one-call path stays. The pattern
  is opt-in. No existing user workflow breaks.

## Dependencies / issues / bugs

- **Depends on**: agent-loop.mjs (where the chat function is wired),
  harness/scaffold.mjs (the editor uses the same scaffold tier),
  model-runtime (model selection per role). All present and shipped.
- **Existing approval flow**: the editor's first mutating tool call

## Threat matrix

| Threat | Signature | Defense |
|---|---|---|
| Plan is too vague for editor | Editor fabricates details not in plan | Editor's tool calls go through approval; operator can reject + ask for re-plan |
| Plan is wrong (model hallucinated) | Editor executes hallucinated plan | Approval flow: operator reviews plan + diffs together |
| Two-call latency | User waits 2x longer | Editor is a fast/small model by default; opt-in for the use case |
| Plan contains forbidden content (e.g. credential type) | Editor executes | Same input sanitization as the one-call path; the architect prompt forbids credential field targeting per aide-desktop-agent-model-spec |
| Architect and editor are DIFFERENT models with different permissions | Editor does more than architect planned | Editor is constrained to the same agent-policy as architect; no new permissions |
| Cost spike | 2x model calls in a loop | Per-session cap (8 cycles) + 1-call fallback |
| Editor cannot find a path the plan referenced | Tool fails | Existing consecutive-mistake limit + call_user escape |

## Pitfalls

- **Do NOT collapse architect + editor into one call** even if
  they share a model. The two-call structure is the entire value
  prop. Aider's docs are explicit: "Allowing the model two
  requests to solve the problem and edit the files can sometimes
  provide better results."
- **Do NOT add new tool types** for the editor. Same `<tool>` XML.
- **Do NOT cache plans across sessions.** The plan is a contract
  with the transcript; if either changes, the plan is stale.
  Re-derive each turn.
- **Do NOT skip the approval flow** on the editor's tool calls
  just because the architect "already approved." They are
  different models (or at least different calls); the operator
  must see and approve the actual edits.
- **Do NOT surface the plan in the chat reply.** It belongs in the
  pending_approval event so the cockpit renders it as a card,
  not in the transcript the model re-sees next turn.

## Verification

End-to-end test (build before the integration): the test takes a
prompt that on a 4B model usually fails direct editing (large
multi-file refactor) and proves that with architect/editor the
success rate goes up. Measure: edit-shape correctness + the
operator-rejection rate (lower is better).

  must still go through the existing approval flow. The plan
  appears in the approval card so the operator can reject the
  plan before edits are applied.
- **Plan-mode tool whitelist (Gap #3)**: the architect is a
  different problem from plan mode. Plan mode = whole loop is
  read-only. Architect/Editor = just the first call is plan-only.
  Both can co-exist; they're orthogonal.
- **Cost ceiling**: every chat with architect/editor is 2x model
  calls. Operators can opt out via the default config. Set a
  per-session cap (e.g. 8 architect/editor cycles) and fall back
  to one-call after the cap.
- **Planner drift**: a model can produce a plan that, when the
  editor tries to execute it, hits unexpected state (a file
  changed between calls). The editor must treat the plan as
  guidance and recover via call_user if blocked. The existing
  agent loop's `consecutive-mistake limit` (N=3) covers this.
- **Telemetry volume**: 2x events per chat. The memory spine
  already truncates; we add an `architect_plan` slot per session
  for the cockpit, capped at 1 KB per cycle.

   `agent:tool_call` events already cover this; we add a
   `agent:plan` event so the cockpit can render the plan to the
   operator before the editor runs.

### Where it ships first

- `node/src/services/agent-loop.mjs` — the `runSession` function
  gets an optional `architectEditor: true` mode. When set, the
  first chat call goes to the architect; the second goes to the
  editor. The user can request it via:
  - `/architect` slash command in the agent (B6 — already on roadmap)
  - A `?mode=architect` query on `/api/agent/start`
  - A button in the cockpit approval card ("translate plan to
    edits")
- `daemon/model-manager.mjs` / `node/src/services/model-runtime.ts`
  — add a `role: 'architect' | 'editor' | 'chat'` selector so the
  architect and editor can be different models. Same engine slot,
  different sampling profile.
- `daemon/agent-policy.mjs` — the `approval` field can be
  `required-for-apply` per role. Architect emits plans (no apply);
  editor applies (apply requires approval).

   cheap model for (b) and reserve the budget for (a).
4. **AIDE's house model** (cipher v1, 4B): token-efficient for its
   size but bottlenecked on direct editing. Architect/Editor gives
   it a free quality boost.

## What to do (direct)

The pattern, in AIDE's terms:

```
┌─────────────────────────────────────────────────────────────┐
│ Architect call (strong model, max thinking budget)           │
│  input:  system + transcript + user task                    │
│  output: a structured PLAN (a `## Plan` block, no tool calls)│
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Editor call (fast, mechanical, can be a SMALLER model)       │
│  input:  the same transcript + the plan as a system prefix  │
│  output: tool calls, in AIDE's XML format                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                    existing tool dispatch
```
