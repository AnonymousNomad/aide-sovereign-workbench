export interface ExercisePublic {
  id: string;
  skill_id: string;
  kind?: string;
  prompt: string;
}

export interface ExerciseAttemptResult {
  error?: string;
  message?: string;
  passed?: boolean;
  revealed?: { answer: string; explanation: string } | null;
}

export declare class ExerciseEngine {
  constructor(options: { exercisesDir: string; learnerState?: unknown | null; pythonPath?: string });
  load(): Promise<number>;
  list(): ExercisePublic[];
  get(id: string): ExercisePublic | null;
  attempt(id: string, submission: unknown): Promise<ExerciseAttemptResult>;
  next(nowIso?: string): string | null;
}
