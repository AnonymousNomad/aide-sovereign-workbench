import type { HubSearchResponseT, ModelManifestT } from '../../common/contracts/modelhub.ts';

export interface HubSearchResult {
  models: Array<{ repo_id: string; downloads: number; likes: number; tags: string[] }>;
}

export interface HubDownloadJobSnapshot {
  job_id: string;
  repo_id: string;
  filename: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  bytes_done: number;
  bytes_total: number | null;
  error: string | null;
}

export interface HubEvent {
  event: 'progress' | 'done' | 'error' | 'cancelled';
  job_id: string;
  bytes_done?: number;
  bytes_total?: number | null;
  eta_s?: number | null;
  filename?: string;
  manifest?: ModelManifestT;
  error?: string;
}

export interface StartDownloadArgs {
  repo_id: string;
  filename: string;
  quant_label?: string | null;
  urlTemplate?: string;
}

export declare function createHubService(options: {
  workspace: string;
  modelsDir: string;
  fetchImpl?: typeof fetch;
  onEvent?: (event: HubEvent) => void;
}): {
  search(q: string, sort?: string, limit?: number): Promise<HubSearchResult>;
  startDownload(args: StartDownloadArgs): Promise<void>;
  beginDownload(args: StartDownloadArgs): { job_id: string };
  cancel(jobId: string): Promise<{ cancelled: boolean }>;
  listDownloads(): HubDownloadJobSnapshot[];
  listEvents(): HubEvent[];
  importFromPath(sourcePath: string): Promise<{ manifest: ModelManifestT }>;
  close(): void;
};

export type { HubSearchResponseT };
