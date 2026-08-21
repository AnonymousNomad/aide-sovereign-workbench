export interface DatasetMeta {
  id: string;
  name: string;
  count: number;
  bytes: number;
  dup_skipped: number;
  created_at: string;
  updated_at: string;
}

export interface DatasetAppendResult {
  error?: string;
  message?: string;
  accepted?: number;
  rejected_dupes?: number;
  rejected_invalid?: number;
  errors?: string[];
}

export declare class DatasetStore {
  constructor(options: { rootDir: string });
  load(): Promise<DatasetMeta[]>;
  list(): DatasetMeta[];
  get(id: string): DatasetMeta | null;
  create(name: unknown): Promise<DatasetMeta>;
  append(id: string, samples: unknown): Promise<DatasetAppendResult>;
  read(id: string, options?: { offset?: number; limit?: number }): Promise<{ error?: string; total?: number; offset?: number; samples?: Array<Record<string, unknown>> }>;
  delete(id: string): Promise<boolean>;
  jsonlPath(id: string): string;
}
