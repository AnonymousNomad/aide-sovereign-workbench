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

export const ModelReadyQuery = z
  .object({
    id: z.string().min(1)
  })
  .strict();

// Same shape the legacy /api/model/ready poll returned: the cockpit reads
// ready + status ('conflict') + error; e2e asserts ready is a boolean.
export const ModelReadyResponse = z
  .object({
    id: z.string().min(1),
    ready: z.boolean(),
    status: z.enum(['running', 'warming', 'conflict', 'not-ready']),
    endpoint: z.string().optional(),
    error: z.string().optional()
  })
  .strict();

export const ModelRegisterRequest = z
  .object({
    filename: z.string().min(1).max(500),
    repo_id: z.string().min(1).max(200).optional(),
    quant_label: z.string().min(1).max(100).optional(),
    context_tokens: z.number().int().min(128).max(262144).optional()
  })
  .strict();

export const ModelRegisterResponse = z
  .object({
    id: z.string().min(1),
    status: z.literal('ready'),
    endpoint: z.string()
  })
  .strict();

export const ModelProfileRequest = z
  .object({
    id: z.string().min(1),
    preset: z.string().min(1).max(50).optional(),
    samplers: z.record(z.string(), z.number()).optional(),
    runtime: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional()
  })
  .strict();

export const ModelProfileResponse = z
  .object({
    id: z.string().min(1),
    preset: z.string(),
    saved: z.literal(true)
  })
  .strict();

export type ModelStateT = z.infer<typeof ModelState>;
export type ModelStatusEntryT = z.infer<typeof ModelStatusEntry>;
export type ModelStatusResponseT = z.infer<typeof ModelStatusResponse>;
export type ModelIngestResponseT = z.infer<typeof ModelIngestResponse>;
export type ModelFitReportT = z.infer<typeof ModelFitReport>;
export type ModelReadyResponseT = z.infer<typeof ModelReadyResponse>;
export type ModelRegisterRequestT = z.infer<typeof ModelRegisterRequest>;
export type ModelRegisterResponseT = z.infer<typeof ModelRegisterResponse>;
export type ModelProfileRequestT = z.infer<typeof ModelProfileRequest>;
export type ModelProfileResponseT = z.infer<typeof ModelProfileResponse>;