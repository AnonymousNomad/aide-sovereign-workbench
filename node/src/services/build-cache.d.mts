import type { ExecutionAuthority, ExecutionHandle } from './execution-authority.mjs';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
export class CacheBoundaryError extends Error { code: string; detail: Record<string, unknown>; }
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
  constructor(options: { workspace: string; dir?: string; authority?: ExecutionAuthority; maxEntries?: number; maxBytes?: number });
  readonly workspace: string | undefined;
  readonly dir: string;
  has(key: string): boolean;
  describe(action: 'record' | 'get' | 'clear', payload: unknown, taskId: string): OperationInput & { args: { body: Record<string, unknown> } };
  get(key: string, execution?: ExecutionHandle): Promise<CachedRestore | null>;
  record(manifest: CacheManifest, logText: string, problems: unknown[], execution?: ExecutionHandle): Promise<void>;
  clear(execution?: ExecutionHandle): number;
  stats(): CacheStats;
}

export declare function computeCacheKey(parts: Record<string, unknown>): string;
