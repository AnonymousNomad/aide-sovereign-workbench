import { z } from 'zod';

export const LspServerState = z.enum(['available', 'starting', 'running', 'stopped', 'error', 'not_found']);

export const LspStatusEntry = z
  .object({
    languageId: z.string().min(1),
    name: z.string().min(1),
    status: LspServerState
  })
  .strict();

export const LspStatusResponse = z
  .object({
    servers: z.array(LspStatusEntry)
  })
  .strict();

export const LspStartRequest = z
  .object({
    languageId: z.string().min(1)
  })
  .strict();

export const LspStartResponse = z
  .object({
    languageId: z.string().min(1),
    status: LspServerState
  })
  .strict();

export const LspOpenRequest = z
  .object({
    uri: z.string().min(1),
    languageId: z.string().min(1),
    text: z.string()
  })
  .strict();

export const LspOpenResponse = z
  .object({
    opened: z.boolean()
  })
  .strict();

export const LspCloseRequest = z
  .object({
    uri: z.string().min(1)
  })
  .strict();

export const LspCloseResponse = z
  .object({
    closed: z.boolean()
  })
  .strict();

export const LspChangeRequest = z
  .object({
    uri: z.string().min(1),
    text: z.string(),
    version: z.number().int().positive()
  })
  .strict();

export const LspChangeResponse = z
  .object({
    changed: z.boolean()
  })
  .strict();

export const LspPosition = z
  .object({
    line: z.number().int().nonnegative(),
    character: z.number().int().nonnegative()
  })
  .strict();

export const LspFeatureRequest = z
  .object({
    uri: z.string().min(1),
    position: LspPosition
  })
  .strict();

export const LspCompletionItem = z
  .object({
    label: z.string().min(1),
    kind: z.number().int().optional(),
    detail: z.string().optional(),
    insertText: z.string().optional(),
    sortText: z.string().optional()
  })
  .strict();

export const LspCompletionResponse = z
  .object({
    items: z.array(LspCompletionItem)
  })
  .strict();

export const LspHoverResponse = z
  .object({
    contents: z.string()
  })
  .strict();

export const LspDefinitionLocation = z
  .object({
    uri: z.string().min(1),
    range: z
      .object({
        start: LspPosition,
        end: LspPosition
      })
      .strict()
  })
  .strict();

export const LspDefinitionResponse = z
  .object({
    locations: z.array(LspDefinitionLocation)
  })
  .strict();

export const LspStatusEvent = z
  .object({
    languageId: z.string().min(1),
    status: LspServerState
  })
  .strict();

export type LspServerStateT = z.infer<typeof LspServerState>;
export type LspStatusEntryT = z.infer<typeof LspStatusEntry>;
export type LspStatusResponseT = z.infer<typeof LspStatusResponse>;
export type LspStartRequestT = z.infer<typeof LspStartRequest>;
export type LspStartResponseT = z.infer<typeof LspStartResponse>;
export type LspOpenRequestT = z.infer<typeof LspOpenRequest>;
export type LspOpenResponseT = z.infer<typeof LspOpenResponse>;
export type LspCloseRequestT = z.infer<typeof LspCloseRequest>;
export type LspCloseResponseT = z.infer<typeof LspCloseResponse>;
export type LspChangeRequestT = z.infer<typeof LspChangeRequest>;
export type LspChangeResponseT = z.infer<typeof LspChangeResponse>;
export type LspPositionT = z.infer<typeof LspPosition>;
export type LspCompletionItemT = z.infer<typeof LspCompletionItem>;
export type LspDefinitionLocationT = z.infer<typeof LspDefinitionLocation>;
export type LspStatusEventT = z.infer<typeof LspStatusEvent>;