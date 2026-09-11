import { z } from 'zod';

export const PluginCapability = z.enum(['workspace.read', 'workspace.write', 'terminal.run', 'ui.view', 'command.register', 'network.localhost']);

export const PluginPublic = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().optional(),
    api_version: z.string().optional(),
    description: z.string().optional(),
    capabilities: z.array(PluginCapability).optional(),
    activation_events: z.array(z.string()).optional(),
    contributes: z.record(z.string(), z.unknown()).optional(),
    status: z.string().optional(),
    entry: z.string().nullable().optional(),
    folder: z.string().optional(),
    trusted: z.boolean(),
    enabled: z.boolean(),
    executable: z.boolean(),
    trust_required: z.boolean(),
    invalid: z.string().optional()
  })
  .strict();

export type PluginPublicT = z.infer<typeof PluginPublic>;

export const PresetPublic = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    capabilities: z.array(PluginCapability),
    installed: z.boolean()
  })
  .strict();

export type PresetPublicT = z.infer<typeof PresetPublic>;

export const PluginsListResponse = z
  .object({
    api_version: z.literal('1'),
    plugins: z.array(PluginPublic)
  })
  .strict();

export type PluginsListResponseT = z.infer<typeof PluginsListResponse>;

export const PluginPresetsResponse = z
  .object({
    api_version: z.literal('1'),
    presets: z.array(PresetPublic)
  })
  .strict();

export type PluginPresetsResponseT = z.infer<typeof PluginPresetsResponse>;

export const PluginTrustRequest = z
  .object({
    id: z.string().min(1),
    trusted: z.boolean()
  })
  .strict();

export type PluginTrustRequestT = z.infer<typeof PluginTrustRequest>;

export const PluginExecuteRequest = z
  .object({
    id: z.string().min(1),
    payload: z.unknown().optional()
  })
  .strict();

export type PluginExecuteRequestT = z.infer<typeof PluginExecuteRequest>;

export const PluginExecuteResponse = z
  .object({
    result: z.unknown()
  })
  .strict();

export type PluginExecuteResponseT = z.infer<typeof PluginExecuteResponse>;

export const PluginScaffoldRequest = z
  .object({
    id: z.string().min(1),
    approved: z.literal(true)
  })
  .strict();

export type PluginScaffoldRequestT = z.infer<typeof PluginScaffoldRequest>;