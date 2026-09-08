# aid-closed-loop-self-improvement — the AIDE "Iron Man suit" loop

## What this is

AIDE is the harness around the in-house model. The model is the reactor. The closed loop is what makes the suit **self-healing** — model failures become training signal, the model improves, the harness gets better, the user ships more code.

Per user directive (2026-08-31): *"self healing, learn from, and eventually I wanted to have working update its own and work on its own source code and find its own falls in its own source code"*. The model must improve itself through observation of its own failures on the actual user workload.

This skill is the SOP for the entire loop. Per `post-training-closed-loop`: every iteration = evaluate -> collect failures -> verify -> route to correct stage -> retrain -> re-evaluate. But this skill adapts that to a CONTINUOUS background loop running inside the IDE while the user works, not a one-shot training cycle.

## The loop (in production)

```
1. OBSERVE  Every chat turn + every desktop action + every agent tool call writes to `.aide/cipher-state.jsonl`.
              The state bus is the loss function's input.
2. DETECT    `scripts/selfimprove.mjs` scans cipher-state.jsonl for:
              - `rejection` events (the model tried something and was refused)
              - `error` events (the model failed at something)
              - `gate` events with `passed:false` (the model produced output that failed verification)
              - `desktop` events with `decision:refused` (the model asked for an action outside its grants)
3. CLUSTER   Group failures by `source` (the model that produced the failure) + `category` (the kind of failure).
              Failure types we care about:
              - format (wrong output structure, no closing tag, malformed JSON)
              - reasoning (wrong answer but right format)
              - tool-call (wrong tool name, wrong args shape, wrong action DSL)
              - refusal (over-refusal — model says "I can't" when it should be able to)
              - compliance (model emitted credentials or leaked code despite policy)
4. ROUTE     Per post-training-closed-loop routing rule:
              - format failure -> SFT corpus (teach the structure)
              - reasoning failure with a clean passing trace -> distillation corpus
              - reasoning failure where a passing AND a failing trace both exist -> preference corpus
              - systematic gap (model never gets close) -> STOP, surface to operator
              - refusal failure -> preference corpus with abstain-aware pairs
5. EMIT      Write a fine-tune signal JSONL: `.aide/training/signal-YYYY-MM-DD.jsonl`
              Each row is a verifier-stamped (P0 rule) {prompt, failing_completion, passing_completion_or_null, source, category, ts}.
              The signal is the "failed trajectory" -- exactly what the model needs to learn from.
6. DELEGATE  The signal is consumed by a fine-tune lane:
              - Local: `scripts/train-cipher.sh` (CPU-only, slow, doesn't fit 30B base) -- only works for small adapter training
              - Cloud: per `cipher-cloud-training` skill (the recommended path for 30B base)
              - Manual: operator reviews `.aide/training/signal-*.jsonl` and runs their own pipeline
              The fine-tune lane is OUT OF SCOPE for this loop (it's the model-training lane).
              What this loop OWNS: detecting failures, clustering, emitting the signal, verifying the fix.
7. VERIFY    After a new adapter is registered, re-run the capability battery. Compare composite against the previous baseline.
              Per cipher-qlora-finetune §8 gate: composite delta >= +0.02 AND no category regress >0.1.
              If pass: register the new adapter in AIDE manifest as `lora_adapter`, hot-reload the engine.
              If fail: keep the old adapter, emit a "fix attempt N rejected" event to the state bus.
8. JOURNAL   Every iteration writes to AGENT_NOTES: "Self-improvement iteration N: failures=42, signal=signal-2026-09-12.jsonl, adapter=v2, gate=+0.03, registered=true|false"
              The journal is auditable. Per developer-code-and-credo rule 5: "what we deliver must do what we said it does."

## Why AIDE has an edge on this

Cursor/Windsurf/VS Code: ALL their closed-loop pieces are server-side. They can capture YOUR failures and train on YOUR data, but they do it invisibly and you can't see the loop. The user is the data source; the company owns the model.

AIDE: the loop is LOCAL. The failures, the signal, the fine-tune, the verification — all happen on the user's machine. The data is theirs. The improvement is theirs. The model gets better for THEM, not for the vendor. This is the sovereign compute principle applied to model improvement: **your in-house model, improving on your failures, on your hardware, forever**.

## The Iron Man suit (what this loop is for)

Without the harness, a 30B model is "good but uncoordinated." With AIDE's harness:
- Memory (X1 spine + X2 join + X3 retention) prevents the model from re-making the same decisions
- Gates (veritas) prevent the model from shipping unverified output
- Micro-experts (routed per phase) let the model specialize
- Desktop control (with grants) gives the model hands to act
- Trajectory capture (state bus) gives the model feedback on every action
- This loop closes the cycle: the model's failures become its training data

The model becomes better BECAUSE the harness observed it. The harness becomes better BECAUSE the model's failures exposed the gaps. **A co-evolutionary loop where AIDE and the model improve each other.**

## Files this loop owns (in scope for the T2 lane)

- `scripts/selfimprove.mjs` (NEW) -- the runner: reads cipher-state, clusters failures, emits signal, runs verification
- `harness/closed-loop.mjs` (NEW, optional) -- pure functions for the loop logic, testable in isolation
- `harness/signal-format.mjs` (NEW) -- verifier-stamped signal row schema
- `tests/unit/test-selfimprove.mjs` (NEW) -- unit tests for the loop with a mock state bus
- `docs/evidence/selfimprove-iteration-N.md` (NEW) -- iteration evidence per cipher-qlora-finetune §8 gate

## Files this loop does NOT own (out of scope)

- Fine-tune lane (the actual model weight updates) -- T1's lane per `cipher-cloud-training` or `cipher-qlora-finetune`
- Engine start/stop (T1's lane per `aide-engine-lifecycle-doctrine`)
- Chat route (chat.ts is the model's interface, not the loop)
- Agent loop (agent-loop.mjs is the model's behavior, not the loop)
- Desktop grants (operator-controlled)

## Pitfalls (encoded from prior failures)

1. **Don't feed unverified model output into the loop.** Per the 8/3 STaR-poisoning lesson: the model's own raw completions, without a real verifier stamp, become poison. Every signal row must have: verifier name + exact pass result + source (model + sampling params) + prompt-erasure state. No stamp, no entry.
2. **Don't loop the same stage twice if it didn't help.** Per the post-training-closed-loop: "If an iteration yields no improvement after 2 tries on the same gap: escalate to capacity decision (new pretraining data / architecture), do not loop." Respect the ceiling.
3. **Don't run the loop on every chat turn.** It's a background task, scheduled (cron-style) or invoked manually. Running it on every turn would add latency to chat and waste compute. Recommended cadence: every 100 user turns OR every 24h, whichever first.
4. **Don't claim "model improved" without the gate pass.** Per the cipher-qlora-finetune §8: composite delta >= +0.02 AND no category regress >0.1. If gate fails, the loop emits a "fix attempt rejected" event and the operator decides what to do next. The loop does NOT auto-rollback (that's the operator's call).
5. **Don't leak the signal to a third party.** The signal JSONL contains the user's failures on the user's tasks. It stays in `.aide/training/`, which the `.gitignore` should exclude. Per the No-Phone-Home law.

## Tooling

- **Runner**: `node scripts/selfimprove.mjs --dry-run` (read-only scan + report) or `node scripts/selfimprove.mjs` (full loop with signal emission)
- **Verify**: `npm run check:arch` (existing 200+ test suite) + `node scripts/run-harness-battery.mjs` (the 10-layer battery)
- **Inspect state bus**: `node -e "console.log(JSON.stringify(require('fs').readFileSync('.aide/cipher-state.jsonl','utf8').split('\n').slice(-20).map(JSON.parse).filter(e=>e.decision==='refused'||e.passed===false).slice(0,5),null,2))"`
- **Inspect signal**: `ls -la .aide/training/signal-*.jsonl | tail -5` then head one to verify verifier stamps are present

## Skill category: closed-loop / model-improvement
## Author: opencode (T2, 2026-08-31)
## Verified by: not yet — this is a design skill; the loop must be wired and run on real data to verify. Per the user's "no shortcuts" rule, the next session runs the loop end-to-end with a known-bad prompt and confirms the fix shows up in the next battery.
