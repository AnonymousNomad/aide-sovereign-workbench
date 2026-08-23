import { z } from 'zod';

export const EvalResult = z
  .object({
    passed: z.boolean(),
    reasons: z.array(z.string()),
    final_loss: z.number().nullable(),
    evaluated_at: z.string().min(1)
  })
  .strict();

export type EvalResultT = z.infer<typeof EvalResult>;

export const ExportManifest = z
  .object({
    schema_version: z.literal(1),
    job_id: z.string().min(1),
    kind: z.string().min(1),
    quant_target: z.string().min(1),
    status: z.string().min(1),
    source_files: z.array(z.object({ name: z.string(), bytes: z.number().int().min(0), sha256: z.string().length(64) }).strict()),
    created_at: z.string().min(1)
  })
  .strict();

export type ExportManifestT = z.infer<typeof ExportManifest>;

const jobRef = z.object({ job_id: z.string().min(1).max(64) }).strict();

export const EvalRunRequest = jobRef;
export type EvalRunRequestT = z.infer<typeof EvalRunRequest>;

export const EvalRunResponse = EvalResult;
export type EvalRunResponseT = EvalResultT;

export const ExportCreateRequest = z
  .object({ job_id: z.string().min(1).max(64), quant: z.enum(['Q4_K_M', 'Q5_K_M', 'Q8_0']).optional() })
  .strict();
export type ExportCreateRequestT = z.infer<typeof ExportCreateRequest>;

export const ExportCreateResponse = z.object({ manifest: ExportManifest }).strict();
export type ExportCreateResponseT = z.infer<typeof ExportCreateResponse>;

export const ExportsListResponse = z.object({ exports: z.array(z.string()) }).strict();
export type ExportsListResponseT = z.infer<typeof ExportsListResponse>;
