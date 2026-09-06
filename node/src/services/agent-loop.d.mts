import type { AgentApprovalT, AgentStatusResponseT } from '../../common/contracts/agent.ts';

export declare class AgentSessionError extends Error {
  code: string;
  constructor(code: string, message: string);
}

export interface AgentLoopService {
  start(task: string, mode?: 'plan' | 'act', chatFnOverride?: ((messages: Array<{ role: string; content: string }>) => Promise<string>) | null, opts?: { architectEditor?: boolean }): { session_id: string };
  decide(sessionId: string, approvalId: string, decision: 'approve' | 'reject' | 'abort'): { ok: boolean };
  status(sessionId: string): AgentStatusResponseT;
  list(): AgentStatusResponseT[];
  transcriptOf(sessionId: string): Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_name: string | null; ts: string | null }>;
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
  toolPolicy?: {
    allow_read?: boolean;
    allow_search?: boolean;
    allow_write?: boolean;
    allow_edit?: boolean;
    allow_run_command?: boolean;
    allow_subagent_spawn?: boolean;
    allow_desktop?: boolean;
    allow_provider?: boolean;
    allow_network?: boolean;
  } | null;
}): AgentLoopService;

export type { AgentApprovalT };
