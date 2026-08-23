export declare class GitService {
  constructor(options: { workspace: string });
  run(args: string[], opts?: { timeoutMs?: number; input?: string }): Promise<{ stdout: string; stderr: string }>;
  hasRepo(): Promise<boolean>;
  guard(relativePath: string): string;
  status(): Promise<Record<string, unknown>>;
  diff(pathArg: string | undefined, cached: boolean): Promise<{ text: string; truncated: boolean }>;
  stage(paths: string[]): Promise<void>;
  unstage(paths: string[]): Promise<void>;
  commit(message: string): Promise<{ oid: string }>;
  branches(): Promise<{ branches: Array<{ name: string; current: boolean }> }>;
  log(limit?: number): Promise<{ commits: Array<Record<string, string>> }>;
  fileLog(pathArg: string, limit?: number): Promise<{ commits: Array<Record<string, string>> }>;
  hunks(pathArg: string): Promise<{ hunks: Array<{ index: number; header: string; lines: string[] }>; truncated: boolean }>;
  stageHunks(pathArg: string, indexes: number[]): Promise<{ staged_indexes: number[] }>;
  unstageHunks(pathArg: string, indexes: number[]): Promise<{ staged_indexes: number[] }>;
  blame(pathArg: string): Promise<{ lines: Array<Record<string, unknown>>; truncated: boolean }>;
}

export declare function parseStatusPorcelainV2(text: string): Record<string, unknown>;
export declare function splitUnifiedDiff(text: string): Array<{ index: number; header: string; lines: string[] }>;
export function buildPatch(fileHeaderLines: string[], selectedHunks: Array<{ header: string; lines: string[] }>): string;
export declare function parseBlamePorcelain(text: string): Array<{ commit: string; line_number: number; author?: string; text?: string }>;
