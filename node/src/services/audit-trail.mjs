// Audit Trail — unified event log for chassis boundary events.
//
// Per docs/evidence/competitor-research-2026-09-06.md gap #1: "Windsurf's
// pre/post hook model demonstrates that every read, write, command, MCP
// call, prompt, and response should be observable and blockable." AIDE
// currently records tool and approval state, but the audit must verify
// whether all boundary events have one durable trajectory record.
//
// This module is a thin wrapper around `createStateBus(workspace)` (the
// cipher-state.jsonl bus). It adds typed event schemas, a session_id
// correlation key, and a read API that powers the new GET /api/audit/events
// endpoint. Fail-closed: every emit is best-effort try/catch so the audit
// never breaks the operation it audits.
//
// Event taxonomy (the chassis v1 surface):
//   - chat                  : operator sends a chat message
//   - agent.start           : agent session begins
//   - agent.message         : assistant message in the loop
//   - agent.tool.call       : every tool call the agent makes
//   - agent.tool.result     : every tool result
//   - agent.approval        : operator approves/rejects/aborts a tool
//                             (was already captured in agent-loop.mjs; re-emitted
//                             through the new envelope for shape consistency)
//   - agent.bundle.preview  : operator requests a bundle preview
//   - agent.bundle.run      : operator starts a session with a reviewed
//                             bundle_id
//   - subagent.spawn        : child AgentLoop dispatch begins
//   - subagent.done         : child finishes
//   - subagent.error        : child hits a fault
//   - desktop               : desktop control events (was already captured
//                             in desktop-control.mjs; re-emitted for shape
//                             consistency)
//
// Egress is journaled separately in .aide/egress/journal.jsonl (per
// services/egress-journal.mjs) and surfaced by the read endpoint via
// readEgressJournal() so the operator gets one unified view.

import { createStateBus } from '../../../harness/cipher-state.mjs';

// Egress is journaled separately in .aide/egress/journal.jsonl (per
// services/egress-journal.mjs). The audit endpoint surfaces it via a
// readEgressJournal() hook in a follow-up slice; for now the chassis v1
// surface is just the cipher-state.jsonl bus.

// Whitelist of valid event types. The audit endpoint validates against
// this list so malformed entries are rejected at read time too. The
// chassis ships the chassis v1 boundary surface; extending the surface
// requires an explicit type addition here.
const KNOWN_TYPES = new Set([
  'chat',
  'agent.start',
  'agent.message',
  'agent.tool.call',
  'agent.tool.result',
  'agent.approval',
  'agent.bundle.preview',
  'agent.bundle.run',
  'subagent.spawn',
  'subagent.done',
  'subagent.error',
  'desktop',
  // Pre-existing shapes from the older capture (X1.a decisions); kept
  // for backwards compatibility with the [learned] injector.
  'approval',
  'rejection',
  'abort'
]);

function isValidType(t) {
  return typeof t === 'string' && KNOWN_TYPES.has(t);
}

function trim(value, max = 240) {
  if (typeof value !== 'string') return value;
  return value.length > max ? value.slice(0, max) + '...' : value;
}

export function createAuditTrail({ workspace }) {
  if (!workspace) throw new Error('workspace is required for the audit trail');
  // One bus per service. append() is the same cipher-state.append() used
  // elsewhere; we add typed event helpers + a richer read API.
  const bus = createStateBus(workspace);

  // Per-emit helper. Every emit is best-effort: a failed write must
  // NEVER break the operation it audits. The try/catch is in the
  // helper, not the caller, so call sites stay clean.
  async function emit(event) {
    if (!event || typeof event !== 'object') return;
    if (!isValidType(event.type)) return; // unknown type is a no-op, not a throw
    try {
      await bus.append(event);
    } catch {
      // best-effort: never break the operation
    }
  }

  return {
    // Typed event helpers. Each takes the minimum required fields plus
    // a freeform extra object for cross-cutting context (session_id,
    // bundle_id, modelId, tool, etc.). Optional fields are trimmed to
    // 240 chars to keep the JSONL file small.

    /** Operator sends a chat message. */
    async emitChat({ task, modelId, source = 'cockpit', extra = {} } = {}) {
      // 500-char cap on chat.task: the audit file is for operator replay,
      // and the [learned] injector does NOT scan chat.task. The cap keeps
      // the JSONL file small enough that readState's last-100 read is
      // fast even after months of usage.
      await emit({ type: 'chat', task: trim(task, 500), modelId, source, ...extra });
    },

    /** Agent session begins (after chassis adapter compose, before any tool). */
    async emitAgentStart({ sessionId, mode, task, bundleId, chatSource, extra = {} } = {}) {
      await emit({
        type: 'agent.start',
        session_id: sessionId,
        mode,
        task: trim(task, 8000),
        bundle_id: bundleId,
        chat_source: chatSource,
        ...extra
      });
    },

    /** Assistant message emitted by the loop. */
    async emitAgentMessage({ sessionId, role, content, iteration, extra = {} } = {}) {
      await emit({
        type: 'agent.message',
        session_id: sessionId,
        role,
        content: trim(content, 8000),
        iteration,
        ...extra
      });
    },

    /** Every tool call the agent makes (BEFORE the operator approves). */
    async emitToolCall({ sessionId, tool, args, iteration, extra = {} } = {}) {
      await emit({
        type: 'agent.tool.call',
        session_id: sessionId,
        tool,
        args_preview: trim(JSON.stringify(args || {}), 240),
        iteration,
        ...extra
      });
    },

    /** Every tool result (BEFORE the next turn). */
    async emitToolResult({ sessionId, tool, ok, output, iteration, extra = {} } = {}) {
      await emit({
        type: 'agent.tool.result',
        session_id: sessionId,
        tool,
        ok: Boolean(ok),
        output_preview: trim(String(output || ''), 240),
        iteration,
        ...extra
      });
    },

    /** Operator approves / rejects / aborts a tool. Re-emits the older
     *  approval/rejection/abort shape so the [learned] injector still
     *  works on legacy data. The legacy type is the singular noun
     *  ('approval'|'rejection'|'abort'), NOT the decision verb
     *  ('approve'), per the cipher-state-bus X1.a contract. The legacy
     *  shape carries BOTH type and decision (the [learned] injector
     *  reads entry.decision). */
    async emitApproval({ sessionId, tool, decision, argsPreview, extra = {} } = {}) {
      const legacyType = decision === 'approve' ? 'approval' : decision === 'reject' ? 'rejection' : 'abort';
      const legacy = {
        type: legacyType,
        tool,
        pattern: tool,
        decision,
        summary: trim(String(argsPreview || ''), 160)
      };
      const enriched = { ...legacy, session_id: sessionId, ...extra };
      await emit(enriched);
      // The newer envelope: keep the wire field name 'type' for the
      // legacy [learned] injector but tag the human-readable shape
      // alongside it. This is a no-op for old readers (they ignore
      // unknown fields) and a strict superset for new ones.
      await emit({ type: 'agent.approval', session_id: sessionId, tool, decision, ...extra });
    },

    /** Operator requests a bundle preview (chassis → agent adapter). */
    async emitBundlePreview({ task, mode, bundleId, primarySkill, extra = {} } = {}) {
      await emit({
        type: 'agent.bundle.preview',
        task: trim(task, 8000),
        mode,
        bundle_id: bundleId,
        primary_skill: primarySkill,
        ...extra
      });
    },

    /** Operator starts an agent session with a reviewed bundle_id. */
    async emitBundleRun({ bundleId, sessionId, chatSource, extra = {} } = {}) {
      await emit({
        type: 'agent.bundle.run',
        bundle_id: bundleId,
        session_id: sessionId,
        chat_source: chatSource,
        ...extra
      });
    },

    /** Subagent dispatch begins. */
    async emitSubagentSpawn({ parentSessionId, childSessionId, role, policy, extra = {} } = {}) {
      await emit({
        type: 'subagent.spawn',
        parent_session_id: parentSessionId,
        child_session_id: childSessionId,
        role,
        policy_summary: policy ? { allow_read: policy.allow_read, allow_write: policy.allow_write, allow_run_command: policy.allow_run_command } : null,
        ...extra
      });
    },

    /** Subagent finishes (any terminal state). */
    async emitSubagentDone({ parentSessionId, childSessionId, status, filesChanged, extra = {} } = {}) {
      await emit({
        type: 'subagent.done',
        parent_session_id: parentSessionId,
        child_session_id: childSessionId,
        status,
        files_changed: Array.isArray(filesChanged) ? filesChanged.length : 0,
        ...extra
      });
    },

    /** Subagent hits a fault. */
    async emitSubagentError({ parentSessionId, childSessionId, error, extra = {} } = {}) {
      await emit({
        type: 'subagent.error',
        parent_session_id: parentSessionId,
        child_session_id: childSessionId,
        error: trim(error, 500),
        ...extra
      });
    },

    /** Desktop control event (re-emitted for shape consistency with the
     *  newer envelope). */
    async emitDesktop({ action, target, extra = {} } = {}) {
      await emit({ type: 'desktop', action, target, ...extra });
    },

    // Read APIs. The audit endpoint hits these.

    /** Read recent events with optional filters. Newest first. */
    async readEvents({ type, sessionId, bundleId, since, limit = 200 } = {}) {
      const events = await bus.readState({ limit: 5000 });
      let filtered = events;
      if (type) filtered = filtered.filter(e => e.type === type);
      if (sessionId) filtered = filtered.filter(e => e.session_id === sessionId || e.parent_session_id === sessionId);
      if (bundleId) filtered = filtered.filter(e => e.bundle_id === bundleId);
      if (since) filtered = filtered.filter(e => (e.at || e.ts || '') >= since);
      return filtered.slice(0, Math.max(1, Math.min(2000, limit)));
    },

    /** Known event types (the read endpoint surfaces this in its discovery). */
    knownTypes: () => Array.from(KNOWN_TYPES),

    /** Compose a session's full trajectory by session_id (operator audit view). */
    async sessionTrajectory(sessionId, { limit = 500 } = {}) {
      const events = await this.readEvents({ sessionId, limit });
      // Group by type for the operator's "what happened in this session" view.
      const byType = {};
      for (const e of events) {
        if (!byType[e.type]) byType[e.type] = [];
        byType[e.type].push(e);
      }
      return {
        session_id: sessionId,
        event_count: events.length,
        by_type: byType,
        first_at: events.length ? (events[events.length - 1].at || events[events.length - 1].ts) : null,
        last_at: events.length ? (events[0].at || events[0].ts) : null
      };
    },

    /** Compose a bundle's full trajectory by bundle_id (operator audit view). */
    async bundleTrajectory(bundleId, { limit = 500 } = {}) {
      const events = await this.readEvents({ bundleId, limit });
      return {
        bundle_id: bundleId,
        event_count: events.length,
        events
      };
    }
  };
}
