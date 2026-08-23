import { z } from 'zod';

export const CommandDescriptor = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9._\-:]{3,128}$/),
    title: z.string().min(1),
    category: z.string(),
    icon: z.string(),
    when: z.string(),
    enablement: z.string(),
    hidden: z.boolean()
  })
  .strict();

export type CommandDescriptorT = z.infer<typeof CommandDescriptor>;

export const CommandListResponse = z.object({ commands: z.array(CommandDescriptor) }).strict();

export type CommandListResponseT = z.infer<typeof CommandListResponse>;

export const CommandInvokeRequest = z
  .object({
    id: z.string().min(3).max(128),
    args: z.unknown().optional()
  })
  .strict();

export type CommandInvokeRequestT = z.infer<typeof CommandInvokeRequest>;

export const CommandInvokeResponse = z
  .object({
    result: z.unknown().nullable().optional(),
    error: z.string().optional(),
    message: z.string().optional()
  })
  .strict();

export type CommandInvokeResponseT = z.infer<typeof CommandInvokeResponse>;

export const KeybindingRule = z
  .object({
    key: z.string().min(1).max(64),
    command: z.string().min(1),
    when: z.string().optional(),
    source: z.enum(['default', 'user'])
  })
  .strict();

export type KeybindingRuleT = z.infer<typeof KeybindingRule>;

export const KeybindingListResponse = z.object({ rules: z.array(KeybindingRule) }).strict();

export type KeybindingListResponseT = z.infer<typeof KeybindingListResponse>;

export const KeybindingResolveRequest = z
  .object({
    chords: z.array(z.string().min(1).max(32)).min(1).max(4)
  })
  .strict();

export type KeybindingResolveRequestT = z.infer<typeof KeybindingResolveRequest>;

export const KeybindingResolveResponse = z
  .object({
    match: z.string().nullable(),
    pending: z.boolean()
  })
  .strict();

export type KeybindingResolveResponseT = z.infer<typeof KeybindingResolveResponse>;

export const SettingsValues = z.record(z.string(), z.unknown());

export const SettingsGetResponse = z
  .object({
    values: SettingsValues,
    descriptors: z.array(
      z
        .object({
          key: z.string().min(1),
          type: z.string(),
          default: z.unknown(),
          scope: z.string(),
          description: z.string()
        })
        .strict()
    )
  })
  .strict();

export type SettingsGetResponseT = z.infer<typeof SettingsGetResponse>;

export const SettingsPutRequest = z.object({ values: SettingsValues }).strict();

export type SettingsPutRequestT = z.infer<typeof SettingsPutRequest>;

export const SettingsPutResponse = z.object({ values: SettingsValues }).strict();

export type SettingsPutResponseT = z.infer<typeof SettingsPutResponse>;
