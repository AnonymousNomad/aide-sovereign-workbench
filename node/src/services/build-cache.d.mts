export interface CacheManifest {
  key: string;
  label: string;
  createdAt: number;
  lastHitAt?: number | null;
  exitCode: number;
  sizeBytes: number;
}

export interface CacheStats {
  entries: Array<{
    key: string;
    label: string;
    createdAt: number;
    lastHitAt: number | null;
    exitCode: number;
    sizeBytes: number;
  }>;
  totalBytes: number;
  hits: number;
  misses: number;
}

export interface CachedRestore {
  manifest: CacheManifest & { lastHitAt: number | null };
  logText: string;
  problems: unknown[];
}

export class BuildCache {
  constructor(options?: { workspace?: string; dir?: string; maxEntries?: number; maxBytes?: number });
  readonly workspace: string | undefined;
  readonly dir: string;
  has(key: string): boolean;
  get(key: string): Promise<CachedRestore | null>;
  record(manifest: CacheManifest, logText: string, problems: unknown[]): Promise<void>;
  clear(): number;
  stats(): CacheStats;
}

export declare function computeCacheKey(parts: Record<string, unknown>): string;
