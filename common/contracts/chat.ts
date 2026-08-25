import { z } from 'zod';

export const ChatMessage = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string()
  })
  .strict();

export const ChatOptions = z
  .object({
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    // Gated Best-of-N attempts (harness v2.2): 1 = single sample (default).
    n: z.number().int().min(1).max(4).optional(),
    timeoutMs: z.number().int().positive().optional()
  })
  .strict();

export const ChatRequest = z
  .object({
    modelId: z.string().min(1),
    messages: z.array(ChatMessage).min(1),
    options: ChatOptions.optional(),
    // Battery A/B hook: harness:false bypasses scaffold injection.
    harness: z.boolean().optional()
  })
  .strict();

// Legacy-key compat mapper (anti-corruption layer): the cockpit and older
// clients send {max_tokens, timeout_ms} flat keys. Normalize to the canonical
// options shape BEFORE the strict parse so genuinely-unknown keys still
// reject with BAD_REQUEST.
export const ChatRequestCompat = z.preprocess((raw: unknown) => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const input = raw as Record<string, unknown>;
  const next: Record<string, unknown> = { ...input };
  if ('max_tokens' in next || 'timeout_ms' in next) {
    const legacyMax = Number(next.max_tokens);
    const legacyTimeout = Number(next.timeout_ms);
    const options: Record<string, unknown> = { ...(next.options as Record<string, unknown> | undefined) };
    if (Number.isFinite(legacyMax) && legacyMax > 0 && options.maxTokens === undefined) options.maxTokens = legacyMax;
    if (Number.isFinite(legacyTimeout) && legacyTimeout > 0 && options.timeoutMs === undefined) options.timeoutMs = legacyTimeout;
    delete next.max_tokens;
    delete next.timeout_ms;
    next.options = options;
  }
  return next;
}, ChatRequest);

export const HarnessMeta = z
  .object({
    injected: z.boolean(),
    tier: z.string().optional(),
    bytes: z.number().int().nonnegative().optional(),
    version: z.string().optional(),
    served_context_tokens: z.number().int().nonnegative().nullable().optional(),
    drift_reinjected: z.boolean().optional(),
    approx_prompt_tokens: z.number().int().nonnegative().optional(),
    compose_ms: z.number().optional(),
    reason: z.string().optional()
  })
  .strict();

export const GatedMeta = z
  .object({
    n: z.number().int().positive(),
    picked: z.number().int(),
    all_passed: z.boolean(),
    log: z.array(z.object({ attempt: z.number().int(), temperature: z.number(), pass: z.boolean(), penalty: z.number() }).strict())
  })
  .strict();

export const ChatResponse = z
  .object({
    text: z.string(),
    modelId: z.string().min(1),
    tokens: z.number().int().nonnegative().optional(),
    timingMs: z.number().optional(),
    // Legacy-client alias of text (cockpit reads j.answer).
    answer: z.string().optional(),
    harness: HarnessMeta.optional(),
    gated: GatedMeta.optional()
  })
  .strict();

export const ChatStreamRequest = z
  .object({
    modelId: z.string().min(1),
    messages: z.array(ChatMessage).min(1)
  })
  .strict();

export const ChatStreamDelta = z
  .object({
    delta: z.string()
  })
  .strict();

export const ChatStreamDone = z
  .object({
    done: z.literal(true),
    modelId: z.string().min(1),
    usedApprox: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
    truncatedSystem: z.boolean()
  })
  .strict();

export const ChatStreamError = z
  .object({
    error: z.string().min(1)
  })
  .strict();

export const ChatHistoryConversation = z
  .object({
    id: z.string().min(1),
    modelId: z.string().min(1),
    title: z.string(),
    messages: z.array(ChatMessage),
    updatedAt: z.number()
  })
  .strict();

export const ChatHistoryResponse = z
  .object({
    conversations: z.array(ChatHistoryConversation)
  })
  .strict();

export const ChatHistorySaveRequest = z
  .object({
    id: z.string().min(1).optional(),
    modelId: z.string().min(1),
    title: z.string(),
    messages: z.array(ChatMessage)
  })
  .strict();

export const ChatHistorySaveResponse = z
  .object({
    id: z.string().min(1),
    updatedAt: z.number()
  })
  .strict();

export type ChatMessageT = z.infer<typeof ChatMessage>;
export type ChatRequestT = z.infer<typeof ChatRequest>;
export type ChatResponseT = z.infer<typeof ChatResponse>;
export type ChatStreamRequestT = z.infer<typeof ChatStreamRequest>;
export type ChatStreamDeltaT = z.infer<typeof ChatStreamDelta>;
export type ChatStreamDoneT = z.infer<typeof ChatStreamDone>;
export type ChatHistoryConversationT = z.infer<typeof ChatHistoryConversation>;
export type ChatHistoryResponseT = z.infer<typeof ChatHistoryResponse>;