import type { AgentSubagentSpawnRequestT, AgentSubagentStatusT } from '../../common/contracts/agent.ts';

export interface AgentSubagentService {
  spawn(request: AgentSubagentSpawnRequestT): Promise<{
    child_session_id: string;
    parent_session_id: string;
    role: string;
    status: 'spawned' | 'running' | 'done' | 'aborted' | 'error';
  }>;
  list(parentSessionId?: string): AgentSubagentStatusT[];
  status(childSessionId: string): AgentSubagentStatusT | null;
}

export declare function createAgentSubagentService(options: {
  workspace: string;
  parentLoop: { status(sessionId: string): unknown };
  chatFn(messages: Array<{ role: string; content: string }>): Promise<string>;
  resolveChatFn?: ((model: string) => ((messages: Array<{ role: string; content: string }>) => Promise<string>) | null) | null;
  rg?: unknown;
  onEvent?(event: Record<string, unknown>): void;
  maxChildren?: number;
}): AgentSubagentService;
