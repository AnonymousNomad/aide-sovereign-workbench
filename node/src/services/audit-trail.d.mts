import type { PersistenceResult } from '../../../harness/cipher-state.mjs';
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
  emitChat(event: { task: string; modelId?: string; source?: string; extra?: Record<string, unknown> }): Promise<PersistenceResult>;
  emitAgentStart(event: { sessionId: string; mode: string; task: string; bundleId?: string; chatSource?: string; extra?: Record<string, unknown> }): Promise<PersistenceResult>;
  emitAgentMessage(event: { sessionId: string; role: string; content: string; iteration?: number; extra?: Record<string, unknown> }): Promise<PersistenceResult>;
  emitToolCall(event: { sessionId: string; tool: string; args?: Record<string, unknown>; iteration?: number; extra?: Record<string, unknown> }): Promise<PersistenceResult>;
  emitToolResult(event: { sessionId: string; tool: string; ok: boolean; output?: string; iteration?: number; extra?: Record<string, unknown> }): Promise<PersistenceResult>;
  emitApproval(event: { sessionId: string; tool: string; decision: 'approve' | 'reject' | 'abort'; argsPreview?: string; extra?: Record<string, unknown> }): Promise<PersistenceResult>;
  emitBundlePreview(event: { task: string; mode: string; bundleId: string; primarySkill?: string; extra?: Record<string, unknown> }): Promise<PersistenceResult>;
  emitBundleRun(event: { bundleId: string; sessionId: string; chatSource?: string; extra?: Record<string, unknown> }): Promise<PersistenceResult>;
  emitSubagentSpawn(event: { parentSessionId: string; childSessionId: string; role: string; policy?: Record<string, unknown>; extra?: Record<string, unknown> }): Promise<PersistenceResult>;
  emitSubagentDone(event: { parentSessionId: string; childSessionId: string; status: string; filesChanged?: string[]; extra?: Record<string, unknown> }): Promise<PersistenceResult>;
  emitSubagentError(event: { parentSessionId: string; childSessionId: string; error: string; extra?: Record<string, unknown> }): Promise<PersistenceResult>;
  emitDesktop(event: { action: string; target?: string; extra?: Record<string, unknown> }): Promise<PersistenceResult>;
  emitVerification(event: { sessionId: string; outcome: string; passed: boolean; status: string; score?: number; threshold?: number; evidenceLevel?: string; failedChecks?: string[]; extra?: Record<string, unknown> }): Promise<PersistenceResult>;
  emitResident(event: { status: string; projectType: string; conditionCount: number; recommendation: string; extra?: Record<string, unknown> }): Promise<PersistenceResult>;
  emitContext(event: { sessionId: string; source: string; status: string; error?: string | null }): Promise<PersistenceResult>;
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
