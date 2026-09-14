# Audit / Provenance / Observability

## Four different claims

| Claim | Implemented evidence | Limitation |
|---|---|---|
| Emitted/accepted | EventHub validates channel schema; returns accepted true/false | acceptance does not mean a client received it |
| Persisted | cipher-state.append writes JSONL, syncs file, returns persisted/error | some callers ignore receipt; no operation-wide transaction |
| Queryable | audit events/session/bundle APIs | last 5,000 rows read before filtering; older session can appear absent; disk read errors become [] |
| Surfaced | typed chat text/status; Resident health; legacy agent polling | no coherent typed agent/approval/verification display |

Sources: [EventHub](../../../node/src/events.ts#L74), [state bus](../../../harness/cipher-state.mjs#L10), [audit trail](../../../node/src/services/audit-trail.mjs), [agent terminal](../../../node/src/services/agent-loop.mjs#L599).

## Can an action be reconstructed?

| Required question | Current answer |
|---|---|
| Who requested it? | Task/session/mode captured, but no authenticated actor identity |
| Which model planned/executed? | Local chat callback discards actual model/route/usage; agent start lacks per-invocation identity |
| Which skills? | context source/status plus terminal transcript excerpts; no IDs/reasons/version/hash/selection manifest |
| Which memory/context? | Resident text may be in transcript; chat memory has counts only; no retrieved fact IDs/revision binding |
| Which permission? | tool/decision rows; no authority token, actor, approval ID linkage to exact normalized operation in durable tool records |
| Which tool? | name/iteration/short argument preview and result |
| What changed? | “wrote path” and transcript; no authoritative before/after hashes/diff for every mutation |
| What evidence? | terminal trajectory and verification files; preview-limited audit, no complete raw command evidence reference |
| Which verifier/reviewer? | generic verifier name; no independent reviewer invocation on agent path |
| Why final status? | in-memory verification checks help; persisted/event snapshots can lag final callback errors |

## Gaps

- emitChat, emitAgentMessage, emitBundlePreview/Run and subagent audit helpers exist but are not called by the canonical paths examined. A declared taxonomy is not coverage.
- Tool call args and result previews truncate at 240 chars. Loop transcript contains more output but can be trimmed at 80 messages; full commands/changes may not survive.
- Multiple tools in one iteration lack unique invocation IDs; rejected actions do not emit the same result audit path as executed failures.
- Terminal trajectory writes occur before final callbacks. Verification file keeps pending publication/audit; published event also precedes its acceptance result. Later failure can update only status memory.
- Normal chat completion and provider network use do not share the agent session journal.
- Egress splits .aide/egress/journal.jsonl and .aide/logs/egress.log. Orchestrator context counts only the latter; audit read API does not merge the former. A zero count is not proof of no network.
- Audit read errors swallowed as [] cannot distinguish no events from unavailable/corrupt history.
- Agent tool checkpoint can run outside the evidence completion await. Filesystem persistence is not transactionally tied to mutation.

## What is sound

Phase 1A made write receipts observable and EventHub contract rejection explicit. The real verification event survived facade WebSocket validation in this audit. Preserve that separation; do not demand delivery to disconnected clients before recording execution truth.

## Next evidence contract

Introduce stable workflow/invocation/tool/approval/evidence identifiers, actual model and final context manifest, revision/file hashes, explicit actor and authorization decision, verifier policy/version, and terminal reconciliation. Keep event delivery and durable log as separate stores with shared IDs. Record bounded engineering provenance, not uncontrolled transcript or credential capture. Full Ghost replay/visual timeline can wait after these primitives are proven.

