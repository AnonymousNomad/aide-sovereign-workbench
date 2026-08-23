export declare function createIndexService(options: {
  workspace: string;
  embed?: ((texts: string[]) => Promise<number[][]>) | null;
  onEvent?: (event: unknown) => void;
}): {
  reindex(force?: boolean): Promise<{ session_id: string }>;
  hybridSearch(query: string, limit?: number): Promise<{ results: Array<{ path: string; line: number; header: string; rrf_score: number; sparse_rank: number | null; dense_rank: number | null }>; degraded: boolean }>;
  getStatus(): { state: 'idle' | 'scanning' | 'embedding' | 'ready' | 'error'; files_total: number; files_done: number; chunks: number; branch: string | null; last_error: string | null; updated_at: string };
  isRunning(): boolean;
};
