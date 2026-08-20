import { z } from 'zod';
import { ChatMessage } from './chat.ts';

export const RouteProviderType = z.enum(['local', 'cloud']);

export const RouteStatus = z.enum(['ready', 'starting', 'down', 'unverified']);

export const RouteEntry = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    providerType: RouteProviderType,
    baseUrl: z.string().min(1),
    modelString: z.string().min(1),
    contextLength: z.number().int().positive(),
    chatTemplate: z.string().min(1),
    status: RouteStatus,
    probeMs: z.number().int().nonnegative().nullable(),
    roles: z.array(z.string()),
    capabilities: z.array(z.string())
  })
  .strict();

export const RoutesResponse = z
  .object({
    routes: z.array(RouteEntry)
  })
  .strict();

export const RouteRequest = z
  .object({
    role: z.string().min(1)
  })
  .strict();

export const RouteFallback = z
  .object({
    from: z.string().min(1),
    to: z.string().nullable(),
    reason: z.enum(['down', 'busy', 'unsupported', 'context_overflow'])
  })
  .strict();

export const RouteResponse = z
  .object({
    modelId: z.string().min(1),
    displayName: z.string().min(1),
    providerType: RouteProviderType,
    status: RouteStatus,
    contextLength: z.number().int().positive(),
    fellBack: RouteFallback.optional()
  })
  .strict();

export const FitRequest = z
  .object({
    messages: z.array(ChatMessage),
    contextLength: z.number().int().positive(),
    maxTokens: z.number().int().positive().optional()
  })
  .strict();

export const FitResponse = z
  .object({
    messages: z.array(ChatMessage),
    dropped: z.number().int().nonnegative(),
    truncatedSystem: z.boolean(),
    estimatedTokens: z.number().int().nonnegative(),
    overflow: z.boolean()
  })
  .strict();

export type RouteProviderTypeT = z.infer<typeof RouteProviderType>;
export type RouteStatusT = z.infer<typeof RouteStatus>;
export type RouteEntryT = z.infer<typeof RouteEntry>;
export type RoutesResponseT = z.infer<typeof RoutesResponse>;
export type RouteRequestT = z.infer<typeof RouteRequest>;
export type RouteFallbackT = z.infer<typeof RouteFallback>;
export type RouteResponseT = z.infer<typeof RouteResponse>;
export type FitRequestT = z.infer<typeof FitRequest>;
export type FitResponseT = z.infer<typeof FitResponse>;