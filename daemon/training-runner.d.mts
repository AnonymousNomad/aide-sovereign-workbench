export interface TrainingPreset {
  label: string;
  r: number;
  lora_alpha: number;
  target_modules: string[];
  learning_rate: number;
  epochs: number;
  per_device_batch: number;
  gradient_accumulation: number;
  max_seq_len: number;
  fp16: boolean;
  bf16: boolean;
}

export interface TrainingJobState {
  state: string;
  id?: string;
  preset?: string;
  dataset_id?: string;
  sample_count?: number;
  started_at?: string | null;
  ended_at?: string | null;
  exit_code?: number | null;
  loss_last?: number | null;
  loss_history?: Array<{ at: number; loss: number }>;
  oom?: boolean;
  oom_advice?: string[];
  error?: string | null;
  output_dir?: string;
  script?: string;
}

export interface TrainingCheckpoint {
  name: string;
  best_eval_loss: number | null;
}

export declare const PRESETS: Readonly<Record<string, TrainingPreset>>;

export declare class TrainingRunner {
  constructor(options: { workDir: string; pythonPath?: string; spawnChild?: unknown; onEvent?: ((channel: string, body: Record<string, unknown>) => void) | null });
  static jobId(): string;
  status(): TrainingJobState;
  start(request: { datasetId: string; datasetPath: string; sampleCount: number; preset?: string; approved?: boolean }): Promise<TrainingJobState & { error?: string; message?: string }>;
  stop(): { stopped: boolean; reason?: string };
  checkpoints(jobId?: string | null): Promise<TrainingCheckpoint[]>;
}
