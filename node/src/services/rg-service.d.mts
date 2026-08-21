export interface FileEntry {
  path: string;
  score: number;
}

export interface SearchMatchResult {
  path: string;
  line_number: number;
  line_text: string;
  submatches: Array<{ text: string; start: number; end: number }>;
}

export interface SearchRunResult {
  matches: SearchMatchResult[];
  truncated: boolean;
  elapsed_ms: number;
}

export declare class RgService {
  constructor(options: { workspace: string; spawnChild?: unknown });
  locateRg(): string;
  available(): boolean;
  listFiles(): Promise<{ files: string[]; truncated: boolean; cache_age_ms: number }>;
  quickOpen(q: unknown, limit?: number): Promise<{ files: FileEntry[]; cache_age_ms: number }>;
  search(options: { query: string; isRegex?: boolean; caseSensitive?: boolean; maxResults?: number; fileGlob?: string }): Promise<SearchRunResult>;
  resolveWorkspacePath(relativePath: string): string | null;
}

export export declare function fuzzyScore(query: string, candidate: string): number | null;
