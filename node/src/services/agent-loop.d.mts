import type { AgentApprovalT, AgentStatusResponseT } from '../../common/contracts/agent.ts';

export declare class AgentSessionError extends Error {
  code: string;
  constructor(code: string, message: string);
}

export interface AgentLoopService {
  start(task: string, mode?: 'plan' | 'act'): { session_id: string };
  decide(sessionId: string, approvalId: string, decision: 'approve' | 'reject' | 'abort'): { ok: boolean };
  status(sessionId: string): AgentStatusResponseT;
  list(): AgentStatusResponseT[];
  readonly rootAbs: string;
}

export declare function createAgentLoop(options: {
  workspace: string;
  chatFn(messages: Array<{ role: string; content: string }>): Promise<string>;
  rg?: { available(): boolean; search(options: { query: string; maxResults?: number }): Promise<{ matches: unknown[]; truncated: boolean }> } | null;
  checkpoints?: { commit(message: string): Promise<string>; restore(hash: string): Promise<void>; headHash(): Promise<string> } | null;
  onEvent?(event: Record<string, unknown> & { event: string; session_id: string }): void;
  maxIterations?: number;
  maxMistakes?: number;
}): AgentLoopService;

export type { AgentApprovalT };
