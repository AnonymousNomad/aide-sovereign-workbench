export declare const SECRET_PATTERNS: RegExp[];
export declare function scanForSecrets(text: string): string[];

export declare function createHandoffService(options: {
  workspace: string;
  generator?: string;
  agentLoop?: { transcriptOf(sessionId: string): Array<{ role: string; content: string; tool_name: string | null; ts: string | null }> } | null;
}): {
  exportBundle(request?: {
    tier?: 'brief' | 'transcript' | 'full';
    session_id?: string;
    up_to_message_index?: number;
    include_code?: boolean;
    confirmed?: boolean;
    confirmed_secret_scan?: boolean;
  }): Promise<{ bundle_id: string; tier: 'brief' | 'transcript' | 'full'; message_count: number; file_path: string; created_at: string }>;
  listBundles(): { bundles: Array<{ id: string; created_at: string; tier: 'brief' | 'transcript' | 'full'; message_count: number; imported: boolean }> };
  getBundle(id: string): unknown;
  importBundle(bundle: unknown): { context_id: string; message_count: number; adopted_at: string };
};
