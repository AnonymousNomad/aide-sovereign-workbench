export interface EvalResult {
  passed: boolean;
  reasons: string[];
  final_loss: number | null;
  evaluated_at: string;
}

export interface ExportManifest {
  schema_version: number;
  job_id: string;
  kind: string;
  quant_target: string;
  status: string;
  source_files: Array<{ name: string; bytes: number; sha256: string }>;
  created_at: string;
}

export declare class EvalExportGate {
  constructor(options: { workDir: string; exportsDir: string });
  load(): Promise<string[]>;
  listExports(): string[];
  evaluate(jobId: string, options?: { maxTrainLoss?: number }): Promise<EvalResult>;
  exportAdapter(jobId: string, options?: { quant?: string }): Promise<{ error?: string; message?: string; evaluation?: EvalResult; manifest?: ExportManifest; path?: string }>;
}
