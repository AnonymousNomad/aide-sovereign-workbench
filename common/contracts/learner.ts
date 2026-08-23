import { z } from 'zod';

export const LEARNER_SCHEMA_VERSION = 1;

export const LearnerSkillState = z
  .object({
    mastery: z.number().min(0).max(1),
    attempts: z.number().int().min(0),
    passes: z.number().int().min(0),
    streak: z.number().int().min(0),
    ease: z.number().min(1).max(3.001),
    interval_days: z.number().int().min(0),
    due_at: z.string().min(1),
    misconceptions: z.record(z.string(), z.number().int().min(1))
  })
  .strict();

export type LearnerSkillStateT = z.infer<typeof LearnerSkillState>;

export const LearnerAttemptLogEntry = z
  .object({
    skillId: z.string().min(1),
    passed: z.boolean(),
    misconceptionTags: z.array(z.string()),
    at: z.string().min(1)
  })
  .strict();

export const LearnerSnapshotResponse = z
  .object({
    schema_version: z.literal(LEARNER_SCHEMA_VERSION),
    updated_at: z.string().nullable(),
    skills: z.record(z.string(), LearnerSkillState),
    attempts: z.array(LearnerAttemptLogEntry)
  })
  .strict();

export type LearnerSnapshotResponseT = z.infer<typeof LearnerSnapshotResponse>;

export const LearnerReviewsResponse = z
  .object({
    reviews: z.array(
      z
        .object({
          skillId: z.string().min(1),
          mastery: z.number(),
          due_at: z.string().min(1)
        })
        .strict()
    )
  })
  .strict();

export type LearnerReviewsResponseT = z.infer<typeof LearnerReviewsResponse>;

export const LearnerAttemptRequest = z
  .object({
    skill_id: z.string().min(1).max(128),
    passed: z.boolean(),
    misconception_tags: z.array(z.string().min(1).max(64)).max(16).optional()
  })
  .strict();

export type LearnerAttemptRequestT = z.infer<typeof LearnerAttemptRequest>;

export const LearnerAttemptResponse = LearnerSkillState.extend({
  skillId: z.string().min(1)
}).strict();

export type LearnerAttemptResponseT = z.infer<typeof LearnerAttemptResponse>;
