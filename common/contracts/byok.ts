import { z } from 'zod';

export const ApiType = z.enum(['chat-completions', 'anthropic-messages']);
export type ApiTypeT = z.infer<typeof ApiType>;

export const ProviderConfig = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  base_url: z.string().url().max(500),
  api_type: ApiType.default('chat-completions'),
  model_id: z.string().min(1).max(200),
  max_input_tokens: z.number().int().positive().max(10_000_000).optional(),
  tool_calling: z.boolean().default(false),
});
export type ProviderConfigT = z.infer<typeof ProviderConfig>;

export const RoleTarget = z.union([
  z.literal('local'),
  z.strictObject({ provider_id: z.string(), model_id: z.string() }),
]);
export type RoleTargetT = z.infer<typeof RoleTarget>;

export const RoleRouting = z.strictObject({
  plan: RoleTarget.default('local'),
  act: RoleTarget.default('local'),
  utility: RoleTarget.default('local'),
});
export type RoleRoutingT = z.infer<typeof RoleRouting>;

export const ProviderEntry = ProviderConfig.extend({ key_stored: z.boolean() });
export type ProviderEntryT = z.infer<typeof ProviderEntry>;

export const ByokStatusResponse = z.strictObject({
  providers: z.array(ProviderEntry),
  routing: RoleRouting,
  consent_enabled: z.boolean(),
});
export type ByokStatusResponseT = z.infer<typeof ByokStatusResponse>;

export const ProviderSetRequest = z.strictObject({ provider: ProviderConfig });
export type ProviderSetRequestT = z.infer<typeof ProviderSetRequest>;

export const IdRequest = z.strictObject({ id: z.string().min(1) });

export const KeyPutRequest = z.strictObject({
  provider_id: z.string().min(1),
  api_key: z.string().min(1).max(4096),
});
export type KeyPutRequestT = z.infer<typeof KeyPutRequest>;

export const KeyPutResponse = z.strictObject({ stored: z.literal(true) });

export const RoutingPutRequest = z.strictObject({ routing: RoleRouting });
export type RoutingPutRequestT = z.infer<typeof RoutingPutRequest>;

export const ConsentPutRequest = z.strictObject({ enabled: z.boolean() });

export const ByokTestRequest = z.strictObject({ provider_id: z.string().min(1) });
export const ByokTestResponse = z.strictObject({ ok: z.boolean(), detail: z.string() });
export type ByokTestResponseT = z.infer<typeof ByokTestResponse>;
