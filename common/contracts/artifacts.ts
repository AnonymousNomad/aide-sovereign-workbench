import { z } from 'zod';

export const ArtifactsResponse = z
  .object({
    artifacts: z.array(z.string())
  })
  .strict();

export type ArtifactsResponseT = z.infer<typeof ArtifactsResponse>;