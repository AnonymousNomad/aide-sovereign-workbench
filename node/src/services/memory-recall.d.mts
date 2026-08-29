// Type shim for memory-recall.mjs (the runtime module is pure ESM JS).
export interface MemoryEntry {
  session_id: string;
  ts: string;
  intent?: string;
  summary?: string;
  skills_invoked?: string[];
  files_touched?: string[];
  outcome?: string;
  [key: string]: unknown;
}
export interface MemoryHit {
  session_id: string;
  ts: string;
  intent?: string;
  summary?: string;
  skills_invoked: string[];
  files_touched: string[];
  outcome?: string;
  score: number;
}
export interface RecallResult {
  hits: MemoryHit[];
  degraded: boolean;
  reason?: string;
  approxTokens: number;
}
export interface MemoryStatus {
  count: number;
  file: string;
  lastTs: string | null;
}
export interface MemoryRecallApi {
  recall(query: string, opts?: { topN?: number }): Promise<RecallResult>;
  remember(entry: { session_id?: string; ts?: string; [key: string]: unknown }): Promise<void>;
  status(): Promise<MemoryStatus>;
}
export function createMemoryRecall(opts: { workspace: string }): MemoryRecallApi;

