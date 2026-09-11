export interface ReplayRecord {
  id: string;
  task_class: string;
  model: string;
  status: string;
  checks: Record<string, unknown>;
  created_at: string;
}

export interface ReplaysData {
  schema_version: '1.0';
  privacy: 'metadata-only';
  replays: ReplayRecord[];
}

export declare class ReplayStore {
  constructor(file: string);
  data: ReplaysData;
  load(): Promise<ReplaysData>;
  list(): ReplaysData;
  add(item: { task_class?: string | undefined; model?: string | undefined; status?: string | undefined; checks?: Record<string, unknown> | undefined }): Promise<ReplayRecord>;
}
