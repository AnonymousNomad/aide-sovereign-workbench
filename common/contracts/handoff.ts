import { z } from 'zod';

export const HandoffTier = z.enum(['brief', 'transcript', 'full']);
export type HandoffTierT = z.infer<typeof HandoffTier>;

export const HandoffBrief = z.object({
  task: z.string(),
  decisions: z.array(z.string()),
  open_questions: z.array(z.string()),
  constraints: z.array(z.string()),
});
export type HandoffBriefT = z.infer<typeof HandoffBrief>;

export const HandoffMessage = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  tool_name: z.string().nullable().default(null),
  ts: z.string().nullable().default(null),
});
export type HandoffMessageT = z.infer<typeof HandoffMessage>;

export const CodeRef = z.object({
  path: z.string(),
  line_start: z.number().int().nonnegative(),
  line_end: z.number().int().nonnegative(),
  excerpt: z.string(),
});
export type CodeRefT = z.infer<typeof CodeRef>;

export const WorkspaceDigestFile = z.strictObject({
  path: z.string(),
  sha256: z.string(),
});

export const HandoffBundle = z.object({
  version: z.literal(1),
  id: z.string(),
  created_at: z.string(),
  generator: z.string(),
  tier: HandoffTier,
  brief: HandoffBrief,
  distillation: z.enum(['auto', 'manual']).default('auto'),
  transcript: z.array(HandoffMessage).max(2000).optional(),
  code_refs: z.array(CodeRef).max(200).optional(),
  workspace_digest: z.object({ files: z.array(WorkspaceDigestFile).max(5000) }).optional(),
});
export type HandoffBundleT = z.infer<typeof HandoffBundle>;

export const HandoffExportRequest = z
  .strictObject({
    tier: HandoffTier.default('brief'),
    session_id: z.string().optional(),
    up_to_message_index: z.number().int().nonnegative().optional(),
    include_code: z.boolean().optional(),
    confirmed: z.boolean().optional(),
    confirmed_secret_scan: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.tier === 'transcript' || value.tier === 'full') && value.confirmed !== true) {
      ctx.addIssue({ code: 'custom', message: 'tier beyond brief requires confirmed: true' });
    }
    if (value.include_code === true && value.tier !== 'full') {
      ctx.addIssue({ code: 'custom', message: "include_code requires tier 'full'" });
    }
  });
export type HandoffExportRequestT = z.infer<typeof HandoffExportRequest>;

export const HandoffExportResponse = z.object({
  bundle_id: z.string(),
  tier: HandoffTier,
  message_count: z.number().int().nonnegative(),
  file_path: z.string(),
  created_at: z.string(),
});
export type HandoffExportResponseT = z.infer<typeof HandoffExportResponse>;

export const HandoffBundleListResponse = z.object({
  bundles: z.array(
    z.object({
      id: z.string(),
      created_at: z.string(),
      tier: HandoffTier,
      message_count: z.number().int().nonnegative(),
      imported: z.boolean(),
    })
  ),
});
export type HandoffBundleListResponseT = z.infer<typeof HandoffBundleListResponse>;

export const HandoffBundleGetQuery = z.strictObject({ id: z.string() });

export const HandoffImportRequest = z.strictObject({ bundle: HandoffBundle });
export type HandoffImportRequestT = z.infer<typeof HandoffImportRequest>;

export const HandoffImportResponse = z.object({
  context_id: z.string(),
  message_count: z.number().int().nonnegative(),
  adopted_at: z.string(),
});
export type HandoffImportResponseT = z.infer<typeof HandoffImportResponse>;
