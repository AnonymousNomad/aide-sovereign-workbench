import { z } from 'zod';

export const MultiCursorModifier = z.enum(['ctrlKey', 'altKey', 'metaKey']);

export type MultiCursorModifierT = z.infer<typeof MultiCursorModifier>;

export const EditorOptionsResponse = z
  .object({
    fontSize: z.number().int().min(8).max(48),
    tabSize: z.number().int().min(1).max(8),
    wordWrap: z.boolean(),
    minimap_enabled: z.boolean(),
    stickyScroll_enabled: z.boolean(),
    folding_enabled: z.boolean(),
    bracketPairColorization_enabled: z.boolean(),
    multiCursorModifier: MultiCursorModifier
  })
  .strict();

export type EditorOptionsResponseT = z.infer<typeof EditorOptionsResponse>;
