import { z } from 'zod';

export const ProviderKind = z.enum(['openai-compatible', 'anthropic']);

export const ProviderConnectionStatus = z.enum(['not_connected', 'connected', 'invalid_key', 'unreachable', 'checking']);

export const ProviderInfo = z.object({
  id: z.string(),
  name: z.string(),
  kind: ProviderKind,
  baseUrl: z.string(),
  models: z.array(z.string()),
  status: ProviderConnectionStatus
});

export const ProviderListResponse = z.object({
  providers: z.array(ProviderInfo)
});

export const ProviderConnectRequest = z.object({
  providerId: z.string(),
  key: z.string().min(1),
  baseUrl: z.string().url().optional(),
  model: z.string().min(1).optional(),
  approveHost: z.boolean().optional()
});

export const ProviderConnectResponse = z.object({
  status: ProviderConnectionStatus,
  message: z.string()
});

export const ProviderDisconnectRequest = z.object({
  providerId: z.string()
});

export const ProviderDisconnectResponse = z.object({
  ok: z.boolean()
});

export const ProviderImportRequest = z.object({
  format: z.enum(['chatgpt', 'claude']),
  payload: z.string().max(10_000_000)
});

export const ProviderImportResponse = z.object({
  imported: z.number(),
  skipped: z.number(),
  warnings: z.array(z.string())
});

export type ProviderKindT = z.infer<typeof ProviderKind>;
export type ProviderConnectionStatusT = z.infer<typeof ProviderConnectionStatus>;
export type ProviderInfoT = z.infer<typeof ProviderInfo>;
export type ProviderListResponseT = z.infer<typeof ProviderListResponse>;
export type ProviderConnectRequestT = z.infer<typeof ProviderConnectRequest>;
export type ProviderConnectResponseT = z.infer<typeof ProviderConnectResponse>;
export type ProviderDisconnectRequestT = z.infer<typeof ProviderDisconnectRequest>;
export type ProviderDisconnectResponseT = z.infer<typeof ProviderDisconnectResponse>;
export type ProviderImportRequestT = z.infer<typeof ProviderImportRequest>;
export type ProviderImportResponseT = z.infer<typeof ProviderImportResponse>;