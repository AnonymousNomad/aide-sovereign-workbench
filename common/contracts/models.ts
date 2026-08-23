import { z } from 'zod';

export const ModelState = z.enum(['ready', 'running', 'starting', 'stopped', 'pending', 'experimental', 'error']);

export const ModelStatusEntry = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    status: ModelState,
    declared_status: ModelState,
    endpoint: z.string(),
    runtime_available: z.boolean(),
    artifact_available: z.boolean(),
    setup_required: z.boolean(),
    setup_message: z.string().optional(),
    ingested: z.boolean().optional()
  })
  .strict();

export const ModelStatusResponse = z
  .object({
    runtime: z.boolean(),
    models: z.array(ModelStatusEntry)
  })
  .strict();

export const ModelIdRequest = z
  .object({
    id: z.string().min(1)
  })
  .strict();

export const ModelStartResponse = z
  .object({
    id: z.string().min(1),
    status: ModelState,
    endpoint: z.string().optional()
  })
  .strict();

export const ModelStopResponse = z
  .object({
    id: z.string().min(1),
    status: ModelState
  })
  .strict();

export const ModelIngestRequest = z
  .object({
    path: z.string().min(1)
  })
  .strict();

export const ModelFitVerdict = z.enum(['COMFORTABLE', 'TIGHT', 'OVER']);

export const ModelFitReport = z
  .object({
    fileBytes: z.number(),
    modelBytes: z.number(),
    kvBytesPerToken: z.number(),
    contextLength: z.number(),
    maxContextLength: z.number(),
    kvBytesAtContext: z.number(),
    requiredBytes: z.number(),
    availableBytes: z.number(),
    fits: z.boolean(),
    verdict: ModelFitVerdict,
    quant: z.string(),
    recommendedQuant: z.string(),
    parametersB: z.number().nullable()
  })
  .strict();

export const ModelIngestResponse = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    endpoint: z.string(),
    context_tokens: z.number(),
    quant: z.string(),
    sha256: z.string().min(1),
    fit: ModelFitReport
  })
  .strict();

export type ModelStateT = z.infer<typeof ModelState>;
export type ModelStatusEntryT = z.infer<typeof ModelStatusEntry>;
export type ModelStatusResponseT = z.infer<typeof ModelStatusResponse>;
export type ModelIngestResponseT = z.infer<typeof ModelIngestResponse>;
export type ModelFitReportT = z.infer<typeof ModelFitReport>;