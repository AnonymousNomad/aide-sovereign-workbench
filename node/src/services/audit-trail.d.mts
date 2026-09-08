// audit-trail.d.mts
// Type declaration for harness/cipher-state.mjs sibling. Mirrors the
// public API exposed by createAuditTrail. Used by node/src/openapi.ts
// and node/src/routes/agent.ts (TS7016 fix per failure-typescript-mjs-declaration).

export interface AuditEvent {
  type: string;
  at?: string;
  ts?: string;
  [k: string]: unknown;
}

export interface AuditTrailService {
  emitChat(event: { task: string; modelId?: string; source?: string; extra?: Record<string, unknown> }): Promise<void>;
  emitAgentStart(event: { sessionId: string; mode: string; task: string; bundleId?: string; chatSource?: string; extra?: Record<string, unknown> }): Promise<void>;
  emitAgentMessage(event: { sessionId: string; role: string; content: string; iteration?: number; extra?: Record<string, unknown> }): Promise<void>;
  emitToolCall(event: { sessionId: string; tool: string; args?: Record<string, unknown>; iteration?: number; extra?: Record<string, unknown> }): Promise<void>;
  emitToolResult(event: { sessionId: string; tool: string; ok: boolean; output?: string; iteration?: number; extra?: Record<string, unknown> }): Promise<void>;
  emitApproval(event: { sessionId: string; tool: string; decision: 'approve' | 'reject' | 'abort'; argsPreview?: string; extra?: Record<string, unknown> }): Promise<void>;
  emitBundlePreview(event: { task: string; mode: string; bundleId: string; primarySkill?: string; extra?: Record<string, unknown> }): Promise<void>;
  emitBundleRun(event: { bundleId: string; sessionId: string; chatSource?: string; extra?: Record<string, unknown> }): Promise<void>;
  emitSubagentSpawn(event: { parentSessionId: string; childSessionId: string; role: string; policy?: Record<string, unknown>; extra?: Record<string, unknown> }): Promise<void>;
  emitSubagentDone(event: { parentSessionId: string; childSessionId: string; status: string; filesChanged?: string[]; extra?: Record<string, unknown> }): Promise<void>;
  emitSubagentError(event: { parentSessionId: string; childSessionId: string; error: string; extra?: Record<string, unknown> }): Promise<void>;
  emitDesktop(event: { action: string; target?: string; extra?: Record<string, unknown> }): Promise<void>;
  readEvents(filter?: { type?: string; sessionId?: string; bundleId?: string; since?: string; limit?: number }): Promise<AuditEvent[]>;
  knownTypes(): string[];
  sessionTrajectory(sessionId: string, options?: { limit?: number }): Promise<{
    session_id: string;
    event_count: number;
    by_type: Record<string, AuditEvent[]>;
    first_at: string | null;
    last_at: string | null;
  }>;
  bundleTrajectory(bundleId: string, options?: { limit?: number }): Promise<{
    bundle_id: string;
    event_count: number;
    events: AuditEvent[];
  }>;
}

export function createAuditTrail(options: { workspace: string }): AuditTrailService;
