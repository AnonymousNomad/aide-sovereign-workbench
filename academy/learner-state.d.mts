export interface LearnerSkillEntry {
  mastery: number;
  attempts: number;
  passes: number;
  streak: number;
  ease: number;
  interval_days: number;
  due_at: string;
  misconceptions: Record<string, number>;
}

export interface LearnerAttemptRecord {
  skillId: string;
  passed: boolean;
  misconceptionTags: string[];
  at: string;
}

export interface LearnerSnapshot {
  schema_version: 1;
  updated_at: string | null;
  skills: Record<string, LearnerSkillEntry>;
  attempts: LearnerAttemptRecord[];
}

export declare class LearnerState {
  constructor(options: { statePath: string });
  load(): Promise<LearnerSnapshot>;
  snapshot(): LearnerSnapshot;
  skill(skillId: string): LearnerSkillEntry | null;
  recordAttempt(
    skillId: string,
    attempt: { passed: boolean; misconceptionTags?: string[]; at?: string }
  ): Promise<LearnerSkillEntry & { skillId: string }>;
  dueReviews(now?: string): Array<{ skillId: string; mastery: number; due_at: string }>;
  seedFromProgress(progressPath: string, courseSkillMap: Record<string, string> | null): Promise<number>;
}
