import { z } from 'zod';

export const ExercisePublic = z
  .object({
    id: z.string().min(1).max(128),
    skill_id: z.string().min(1).max(128),
    kind: z.string().max(32).optional(),
    prompt: z.string().min(1).max(1000)
  })
  .strict();

export type ExercisePublicT = z.infer<typeof ExercisePublic>;

export const ExerciseNextResponse = z.union([
  z.object({ exercise: ExercisePublic }).strict(),
  z.object({ empty: z.literal(true) }).strict()
]);

export type ExerciseNextResponseT = z.infer<typeof ExerciseNextResponse>;

export const ExerciseAttemptRequest = z
  .object({
    id: z.string().min(1).max(128),
    answer: z.string().max(500)
  })
  .strict();

export type ExerciseAttemptRequestT = z.infer<typeof ExerciseAttemptRequest>;

export const ExerciseReveal = z
  .object({
    answer: z.string(),
    explanation: z.string()
  })
  .strict();

export const ExerciseAttemptResponse = z
  .object({
    passed: z.boolean(),
    revealed: z.union([ExerciseReveal, z.null()])
  })
  .strict();

export type ExerciseAttemptResponseT = z.infer<typeof ExerciseAttemptResponse>;
