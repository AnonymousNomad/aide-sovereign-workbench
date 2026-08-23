# R — Resilience Orchestrator (No-Brick-Wall: failover, model roles, harness intelligence)

Phase skill for AIDE R-series. Master router: aide-master-roadmap. THE doctrine phase: the user NEVER hits a wall — any connectivity/capability change produces a helpful, honest continuation path, with a recommendation grounded in project context.

Research base (2026): "Disconnected Agent Mode" (local-on-hot-path inversion; durable outbox w/ idempotency; VISIBLE capability tiers — explicit routing beats silent fallback for trust+debuggability; one product two backends = shared log/memory/tools), deployed.cloud resilience patterns (circuit breaker closed→open→half-open; degradation tiers Normal/Limited/Read-only/Offline; offline safety policy: destructive blocked unless explicit, reversible allowed+audited, security-sensitive blocked), Multigrid "Degraded Modes That Do Not Lie" (route on Capability object not OS flags; remote=reachable only after recent SUCCESS; request classes local-sufficient/degradable/deferrable/refuse-explicitly; cache keys include MODEL IDENTITY; label output not app; offer upgrade, never silently replace), Continue.dev model roles + VS Code `chat.utilityModel` (different models per role).

## The Law

**No-Brick-Wall Law**: every state change (network loss, provider outage, model crash, OOM) triggers an orchestrator response within 2s: state what happened in one sentence, present the best available continuation, and recommend it. Never a dead end, never silent degradation, never a worse answer presented as equivalent.

## 1. Capability State Machine (daemon-owned, recomputed on events)

```ts
Capability = {
  local: 'ready'|'loading'|'unsupported',      // from P6 runtime status
  localModels: ModelFit[],                      // M2 fit probe results, cached
  remote: 'reachable'|'unreachable'|'unauthorised', // EVIDENCE-based: reachable only after a recent successful call
  activeSession: { harness:'local'|'cloud', model:string, roles:ModelRoles }
}
ModelRoles = { plan: ModelRef, act: ModelRef, utility: ModelRef, embed: ModelRef }
```
Events that recompute: runtime start/stop/crash, provider call success/failure (circuit breaker below), settings change, model import/remove.

## 2. Circuit Breaker per Remote Provider

closed → open → half-open. Thresholds: >=30% errors over 60s OR p95 latency >15s, min 5 calls before opening; half-open probes 1 trial call after 30s. While open: all cloud routes short-circuit to orchestrator fallback WITHOUT user-visible retry spam.

## 3. Failover Flow (the popup the user described)

Trigger: mid-session network loss / breaker open / provider 5xx while on cloud model.
1. Detect within one failed turn (breaker marks unreachable + backoff).
2. Orchestrator builds recommendation: score every LOCAL ready model:
   - context-fit: session token estimate <= model ctx (hard gate)
   - task-fit: current activity class (planning needs reasoning-tier; bulk edits need instruction-tier) matched against model metadata tags
   - device-fit: M2 verdict COMFORTABLE > TIGHT > OVER (hard gate at OVER)
   - history-fit: past sessions' acceptance rate per model on this workspace (local counter)
3. Popup: one sentence ("Network lost — Copilot can't be reached.") + recommendation card: "Continue locally with **<model>** — fits your GPU, handles planning tasks. Your conversation carries over." Buttons: [Switch & continue] [Choose another…] [Wait for network].
4. On switch: SAME session object continues (shared conversation log/tool registry — one product two backends). Turn re-runs on local model. Output labeled with model badge (label output, not app). If user later reconnects: unobtrusive "Improve this with <cloud>?" offer — never auto-replace.
5. Refuse case (needs frontier quality NOW, no local fit): explicit non-blaming message + queue-for-retry option (outbox below).

## 4. Durable Outbox (deferred work survives crashes)

Append-only JSONL `.aide/outbox.log`: { idempotency_key(uuid once), created_at, kind:'cloud_turn'|'hook'|'download', payload, state:'pending|sent|reconciled|failed' }. Drain worker on reconnect with jittered backoff; kill -9 safe (replay = idempotent by key); entries referencing superseded input are dropped by hash compare. UI shows queue badge with count.

## 5. Degradation Tiers (visible badge, top bar)

NORMAL (full) → LOCAL-ONLY (cloud down; everything still works via local) → READ-ONLY-REMOTE (queued items pending) → REFUSING (per-request only, never app-wide). Badge text names the tier and why, one line. No announcement when everything is fine.

## 6. Harness Intelligence (orchestrator as smart as the model)

The harness compensates for weaker models and reinforces stronger ones — closed loop plan→execute→verify→repair:
- **Pre-flight**: orchestrator decomposes user intent into a task graph (its own heuristics + A2 index context), picks role-models (plan vs act vs utility — small fast model for titles/utility like VS Code does).
- **Verification loop**: every model output passes deterministic gates BEFORE reaching user: tool args schema-valid, edits produce parseable code (tree-sitter check), commands dry-run where possible, diagnostics delta checked after apply (B2 feed). Failures loop back as corrective context (max 3, then escalate to ask_user with diagnosis).
- **Reinforcement memory**: local-only ledger of what worked per (task-type, model): successful strategies become few-shot priors injected into future prompts of the SAME model; failures become guardrail instructions. This is inference-time learning — the harness gets smarter even when weights are frozen.
- **Escalation ladder**: utility-model failure → act-model retry → plan-model with full context → ask_user. Each rung logged with reason.

## Tests FIRST

1. Breaker unit: thresholds open/close/half-open transitions exact.
2. Mid-stream disconnect chaos: kill socket during SSE -> breaker opens, popup fires <2s, switch to fixture local server completes turn, output badged.
3. Recommendation ranking: fixture device profile + 3 models -> expected order; OVER-model excluded even if popular.
4. Session carry-over: conversation log identical pre/post switch (same session id, same tools offered).
5. Outbox: enqueue -> kill daemon -> restart -> drained exactly once (idempotency key honored), jitter applied.
6. Refuse path: no local model + unreachable remote -> explicit message, queue option, NO fabricated answer.
7. Verification loop: stub model emits broken patch -> gate rejects -> repair context injected -> pass by attempt 2; attempt cap respected.
8. Role router: title-generation goes to utility model (assert by port/model-id in stub), planning to plan model.
9. Arch: capability route contract strict; openapi zero-diff.

## Pitfalls

- NEVER trust OS online flags (captive portal lies) — evidence-based reachability only.
- Cache/replay entries MUST include model identity or you serve stale small-model answers forever.
- Silent fallback is forbidden (debugging hell + user mistrust); visible badge always.
- Offline destructive actions (git push, rm, deploy hooks) require explicit consent EVERY time regardless of tier.
- Do not spin up the embedder for scoring during failover popup — use cached M2 verdicts; popup must render <2s on spinning-rust HDD too.

## Gate

Unit+arch green; chaos e2e suite (disconnect mid-turn/mid-tool/mid-download/high-latency states) all pass with correct tier badges; SLO dashboards local-only: fallback rate, degraded duration, queue depth journaled to AGENT_NOTES. Journal.
