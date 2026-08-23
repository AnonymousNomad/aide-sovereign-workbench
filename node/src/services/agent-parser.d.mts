export declare class AgentParseError extends Error {
  code: string;
  constructor(message: string);
}

export interface ParsedToolCall {
  name: string;
  args: Record<string, string>;
}

export declare function parseToolCalls(text: string, toolSchemas: Record<string, string[]>): ParsedToolCall[];
