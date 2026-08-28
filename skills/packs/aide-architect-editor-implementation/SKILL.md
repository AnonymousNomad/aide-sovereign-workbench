---
name: aide-architect-editor-implementation
description: The implementation plan for the architect→editor two-call decomposition in AIDE's agent loop. Use when actually building the feature; the companion skill aide-architect-editor-pattern is the doctrine, this is the code map. Covers node/src/services/agent-loop.mjs integration points, the plan parser, the agent:plan event, the /architect slash command, the test cases, the rollout order, and the failure modes to test.
---

# Architect → Editor — Implementation

The doctrine lives in `aide-architect-editor-pattern`. This skill
is the **engineering playbook** for that doctrine: the concrete
files, the exact insertion points, the test cases, the rollout
order, and the failure modes.

## Architecture (recap)

Two model calls per "complex" agent turn:

1. **Architect**: same system prompt + transcript + a framing
   suffix that says "read first, plan second, never emit tool
   calls. Output a `## Plan` block." Returns text with a
   fenced plan block.
2. **Editor**: same system prompt + transcript + the architect's
   plan as a system-prompt prefix. Returns the same XML tool
   calls we already parse.

The agent loop decides "architect then editor" per turn, not
per session. A session can have some turns be architect/editor
and other turns be the one-call path.

## Files to touch

### 1. `node/src/services/agent-loop.mjs`

Add a new option on `start(task, mode, chatFnOverride, options)`:

```ts
type AgentOptions = {
  architectEditor?: boolean;  // opt-in to the two-call pattern
  architectMaxRetries?: number; // default 1
}
```

Modify `runSession` so that, when `architectEditor` is on AND
the model emits no tool calls AND the response contains a
`## Plan` block, the loop:

### 2. `common/contracts/agent.ts`

Add a new event type:

```ts
export const AgentPlanEvent = z.object({
  event: z.literal('plan'),
  session_id: z.string().min(1),
  plan: z.string().max(8192),
  model: z.string().optional(),
  created_at: z.number().int()
}).strict();
```

Add to the `AgentStreamEvent` discriminated union.

### 3. `node/src/routes/agent.ts`

Extend `AgentStartRequest` to accept `architect_editor?: boolean`.

Extend the start handler to read the new field and pass it
through to `service.start()`.

### 4. `daemon/model-manager.mjs` + `node/src/services/model-runtime.ts`

Add a `role: 'architect' | 'editor' | 'chat'` parameter on
the chat function. When set, the runtime resolves the
preferred model for that role (smaller/faster for editor,
stronger/slower for architect). If the role model isn't
allowlisted, fall through to the chat-default model.

This is OPTIONAL for v1 — both architect and editor can use
the same chat-default model. The role is a hint, not a hard
selector.

### 5. `harness/scaffold.mjs`

Add a new scaffold tier `architect` (~400 tokens) with the
framing "read first, plan second, never edit." Used as the
system-prompt prefix when `architectEditor: true`.

Add a new scaffold tier `editor` (~300 tokens) with the
framing "you are the editor. The architect produced this plan.
Translate it into AIDE tool calls. Do not re-reason."

## Rollout

Ship in 2 PRs:

### PR A — architect/editor core (this session, smaller)

- architect/editor option on agent loop
- `agent:plan` event
- plan parser
- 6 arch tests
- skill `aide-architect-editor-pattern` (already done)
- skill `aide-architect-editor-implementation` (this skill)

### PR B — scaffold tiers + role selector (next session)

- `architect` and `editor` scaffold tiers in `harness/scaffold.mjs`
- `role: 'architect' | 'editor'` on the chat function
- `daemon/model-manager.mjs` role-aware resolution
- `/architect` slash command

## Pitfalls

- **Do NOT add a "needs approval for architect" prompt** in
  the agent loop. The architect is reasoning; it's free.
- **Do NOT cache the plan between turns.** Re-derive every
  turn; the transcript may have grown.
- **Do NOT surface the plan as a chat reply.** It goes on the
  `agent:plan` event, not in the assistant message.
- **DO limit the architect output to a single `## Plan`
  block.** Multi-block plans are a parser anti-pattern.
- **DO honour the existing approval flow on the editor's
  tool calls.** The architect did not approve; the operator
  must see the actual tool calls.
- **DO keep the architect loop budget visible** to the
  operator (e.g. "cycle 3/8 of architect/editor"). The
  cockpit renders this on the plan card.

## Verification (end-to-end)

After PR A:
1. Arch battery: `node --test tests/arch/agent-architect-editor.test.ts`
   must report 6 pass / 0 fail.
2. Full arch battery: `scripts/run-arch.mjs` must report
   `ARCH_EXIT=0` (no regression).
3. Live: start an agent session via curl with
   `{"task":"...","mode":"act","architect_editor":true}`.
   Inspect the event stream; the `plan` event must fire
   before the first `tool_call` event.

After PR B:
1. Live: select cipher v1 (4B) as the chat model and
   `aide-cipher-4b-instruct` as the architect model. Start
   a session; verify the runtime logs "architect →
   aide-cipher-4b-instruct" + "editor → aide-cipher-4b".
2. Edit-shape correctness: 10 prompts, 5 with the pattern,
   5 without. Expect the pattern to win on multi-file
   refactors.

- cockpit rendering of the plan card (out of scope here, in
  browser/ branch)

## Threat matrix (concrete test cases)

| Threat | Test |
|---|---|
| Plan is too vague for editor | Inject a plan that says "do the right thing." Editor must not fabricate (verify by counting `chatFn` calls + tool calls). |
| Plan is wrong | Inject a plan that references a nonexistent file. Editor must fail the tool call, agent must hit the consecutive-mistake limit, session must abort cleanly. |
| Two-call latency | Verify the agent-loop wall-clock is the sum of two chatFn times, not 2x. The two calls can run back-to-back; nothing parallelizes. |
| Plan contains forbidden content | Plan that says "type into the credential field." Editor must refuse per the existing desktop-policy guard. |
| Architect and editor are DIFFERENT models | Mock `chatFn` with a counter; verify call 1 and call 2 are recorded separately. |
| Cost spike | With cap=2, run 5 turns; verify the last 3 use the one-call path. |
| Plan-parse fails | Inject "## Plan\nno closing block" text. The plan-parser must return null, the loop must fall through. |
| Loop with two-call inside a checkpoint restore | Restore a checkpoint, the loop must re-derive the plan; not replay a stale one. |


### 6. `tests/arch/agent-architect-editor.test.ts` (new)

Tests to write, in order:

1. **Plan block parser**: given a text response, extract the
   `## Plan` block. If no block, return null.
2. **Architect + editor two-call integration**: with a
   scripted `chatFn` that returns a plan on call 1 and tool
   calls on call 2, verify the agent loop calls `chatFn`
   twice, the plan event fires once, the tool calls run
   normally.
3. **Architect collapsed into editor**: scripted `chatFn`
   returns tool calls on call 1 with no `## Plan` block. The
   loop should call `chatFn` only once and run the tools.
4. **Plan-then-approve flow**: the plan appears in the
   `pending_approval` event before the editor's tool calls
   execute.
5. **Fallback when plan is empty**: empty plan → fall through
   to the one-call path.
6. **Architect + editor cost cap**: after 8 cycles, fall
   through to the one-call path even if `architectEditor` is
   still on.

### 7. `node/src/services/agent-loop.mjs` — `mode` parameter

Today the loop has `mode: 'plan' | 'act'`. Add `mode: 'plan'
| 'act' | 'architect-editor'` as a sub-mode of 'act' that
turns on the two-call pattern per turn. The plan-mode is
orthogonal: in `plan` mode the agent can't write at all; in
`architect-editor` mode the agent first plans, then writes.
The two compose (plan + architect-editor = plan only, ignore
the editor).


1. Emits `{event: 'plan', session_id, plan: <text>}` on the
   event hub.
2. Calls the chat function a second time with the same
   transcript but a system-prompt prefix: "You are the editor.
   The architect produced this plan. Translate it into AIDE
   tool calls. Do not re-reason; the plan is the contract."
3. Parses the second call's tool calls and continues normally.

If the architect emits tool calls anyway, the loop treats the
whole response as editor output and skips the second call
(architect collapsed into editor — same as Aider's "one model
serves both" mode).

If the architect emits neither tool calls nor a `## Plan`
block, the loop falls through to the one-call path.
