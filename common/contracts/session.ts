import { z } from 'zod';

export const SESSION_VERSION = 1;

export const SessionTab = z
  .object({
    uri: z.string().min(1),
    splitId: z.string().min(1).optional(),
    dirty: z.boolean().optional(),
    viewState: z.unknown().optional()
  })
  .strict();

export type SessionTabT = z.infer<typeof SessionTab>;

export const SessionFile = z
  .object({
    version: z.literal(SESSION_VERSION),
    activeTab: z.string().min(1).optional(),
    tabs: z.array(SessionTab).max(200).default([]),
    splits: z.array(z.string().min(1)).max(8).optional()
  })
  .strict();

export type SessionFileT = z.infer<typeof SessionFile>;

export const SessionGetResponse = SessionFile;

export const SessionPutRequest = SessionFile;

export const SessionPutResponse = SessionFile;