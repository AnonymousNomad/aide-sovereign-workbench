export interface ToolExecResult {
  ok: boolean;
  output: string;
  terminal?: boolean;
}

export interface AgentToolDef {
  name: string;
  description: string;
  params: string[];
  required?: string[];
  readOnly: boolean;
  execute(args: Record<string, string>): Promise<ToolExecResult>;
}

export declare function resolveInsideWorkspace(workspace: string, relativePath: string): string;
export declare function relativeInside(workspace: string, abs: string): string;
export declare function ensureRealInsideWorkspace(workspace: string, abs: string): Promise<string>;
export declare function findInvisibleChars(text: string): string[];
export declare function isProtectedPath(rel: string): boolean;
export declare function isNetworkSuspiciousCommand(commandText: string): boolean;
export declare function computeRisks(workspace: string, toolName: string, args: Record<string, string>): string[];
export declare function parseSearchReplaceBlocks(blocksText: string): Array<{ search: string; replace: string }>;
export declare function applySearchReplace(content: string, blocks: Array<{ search: string; replace: string }>): { content: string; applied: Array<{ block: number; strategy: string }> };
export declare function splitCommandLine(line: string): string[];

export declare function createAgentTools(options: {
  workspace: string;
  rg: {
    available(): boolean;
    search(options: { query: string; maxResults?: number }): Promise<{ matches: Array<{ path: string; line_number: number; line_text: string }>; truncated: boolean }>;
  };
}): { tools: AgentToolDef[]; rootAbs: string };
