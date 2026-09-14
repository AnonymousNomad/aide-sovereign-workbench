import type { AgentApprovalT, AgentStatusResponseT } from '../../../common/contracts/agent.ts';
import type { AuditTrailService } from './audit-trail.mjs';
import type { PublishResult } from '../events.ts';
import type { ExecutionAuthority, ExecutionHandle } from './execution-authority.mjs';
import type { createCheckpointService } from './agent-checkpoints.mjs';

export function requiresToolApproval(workspace: string, tool: { name: string; readOnly?: boolean }, args: Record<string, string>): boolean;

export declare class AgentSessionError extends Error {
  code: string;
  constructor(code: string, message: string);
}

export interface AgentLoopService {
  start(task: string, mode?: 'plan' | 'act', chatFnOverride?: ((messages: Array<{ role: string; content: string }>) => Promise<string>) | null, opts?: { execution?: ExecutionHandle | undefined; request?: unknown; architectEditor?: boolean; effectiveContextTokens?: number | null; residentProvider?: () => Promise<string> | string | null; skillProvider?: (task?: string) => Promise<string> | string | null }): { session_id: string };
  decide(sessionId: string, approvalId: string, decision: 'approve' | 'reject' | 'abort', execution?: ExecutionHandle): Promise<{ ok: boolean }>;
  status(sessionId: string): AgentStatusResponseT;
  list(): AgentStatusResponseT[];
  transcriptOf(sessionId: string): Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_name: string | null; ts: string | null }>;
  readonly rootAbs: string;
}

export declare function createAgentLoop(options: {
  workspace: string;
  authority?: ExecutionAuthority | undefined;
  chatFn(messages: Array<{ role: string; content: string }>): Promise<string>;
  rg?: { available(): boolean; search(options: { query: string; maxResults?: number }): Promise<{ matches: unknown[]; truncated: boolean }> } | null;
  checkpoints?: ReturnType<typeof createCheckpointService> | null;
  onEvent?(event: Record<string, unknown> & { event: string; session_id: string }): PublishResult | void;
  maxIterations?: number;
  maxMistakes?: number;
  architectEditor?: boolean;
  audit?: Partial<AuditTrailService> | null;
  residentProvider?: () => Promise<string> | string | null;
  skillProvider?: (task?: string) => Promise<string> | string | null;
  onSessionEnd?(info: { session_id: string; outcome: string; passed: boolean; status: string; evidence_file: string | null }): Promise<void> | void;
  effectiveContextTokens?: number | null;
}): AgentLoopService;

export type { AgentApprovalT };
