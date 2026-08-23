import { z } from 'zod';

export const HubSort = z.enum(['downloads', 'likes', 'modified']);

export const HubSearchQuery = z.object({
  q: z.string().min(1).max(200),
  sort: HubSort.optional(),
  limit: z.number().int().gte(1).lte(50).optional()
}).strict();

export const HubModel = z.object({
  repo_id: z.string().min(1),
  downloads: z.number().int().gte(0),
  likes: z.number().int().gte(0),
  tags: z.array(z.string())
}).strict();

export const HubSearchResponse = z.object({
  models: z.array(HubModel)
}).strict();

export const HubFilesQuery = z.object({
  repo_id: z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/, 'repo_id must look like owner/name')
}).strict();

export const HubFileEntry = z.object({
  filename: z.string().min(1),
  size: z.number().int().gte(0).nullable()
}).strict();

export const HubFilesResponse = z.object({
  repo_id: z.string(),
  files: z.array(HubFileEntry)
}).strict();

export const HubFilename = z.string().min(1).max(255).refine(
  value => {
    if (value.includes('\\') || value.startsWith('/') || value.includes('..')) return false;
    return value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
  },
  { message: 'filename must be a relative path of safe segments (no drive, backslash, or dot-dot)' }
);

export const HubDownloadRequest = z.object({
  repo_id: z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/, 'repo_id must look like owner/name'),
  filename: HubFilename,
  quant_label: z.string().max(32).nullable().optional()
}).strict();

export const HubDownloadStartedResponse = z.object({
  job_id: z.string().min(1)
}).strict();

export const HubCancelRequest = z.object({
  job_id: z.string().min(1)
}).strict();

export const HubCancelResponse = z.object({
  cancelled: z.boolean()
}).strict();

export const DownloadJobState = z.enum(['running', 'done', 'error', 'cancelled']);

export const HubDownloadJob = z.object({
  job_id: z.string(),
  repo_id: z.string(),
  filename: z.string(),
  status: DownloadJobState,
  bytes_done: z.number().int().gte(0),
  bytes_total: z.number().int().gte(0).nullable(),
  error: z.string().nullable()
}).strict();

export const HubDownloadsListResponse = z.object({
  jobs: z.array(HubDownloadJob)
}).strict();

export const ModelManifestStatus = z.enum(['ready', 'unsupported-runtime']);
export const ModelSource = z.enum(['hf', 'manual']);

export const ModelManifest = z.object({
  repo_id: z.string(),
  filename: z.string(),
  quant_label: z.string().nullable().optional(),
  size_bytes: z.number().int().gte(0),
  architecture: z.string(),
  sha256: z.string().nullable().optional(),
  etag: z.string().nullable().optional(),
  downloaded_at: z.string(),
  source: ModelSource,
  status: ModelManifestStatus
}).strict();

export const ModelImportRequest = z.object({
  path: z.string().min(1)
}).strict();

export const ModelImportResponse = z.object({
  manifest: ModelManifest
}).strict();

export const HubProgressEvent = z.object({
  event: z.literal('progress'),
  job_id: z.string(),
  bytes_done: z.number().int().gte(0),
  bytes_total: z.number().int().gte(0).nullable(),
  eta_s: z.number().int().gte(0).nullable()
}).strict();

export const HubDoneEvent = z.object({
  event: z.literal('done'),
  job_id: z.string(),
  bytes_done: z.number().int().gte(0),
  bytes_total: z.number().int().gte(0).nullable(),
  filename: z.string(),
  manifest: ModelManifest.optional()
}).strict();

export const HubErrorEvent = z.object({
  event: z.literal('error'),
  job_id: z.string(),
  error: z.string()
}).strict();

export const HubCancelledEvent = z.object({
  event: z.literal('cancelled'),
  job_id: z.string()
}).strict();

export const HubStreamEvent = z.discriminatedUnion('event', [
  HubProgressEvent,
  HubDoneEvent,
  HubErrorEvent,
  HubCancelledEvent
]);

export type HubSearchQueryT = z.infer<typeof HubSearchQuery>;
export type HubDownloadRequestT = z.infer<typeof HubDownloadRequest>;
export type ModelManifestT = z.infer<typeof ModelManifest>;
