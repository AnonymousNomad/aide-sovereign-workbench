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
    temperature: z.number().min(0).max(2).optional()
  })
  .strict();

export const ChatRequest = z
  .object({
    modelId: z.string().min(1),
    messages: z.array(ChatMessage).min(1),
    options: ChatOptions.optional()
  })
  .strict();

export const ChatResponse = z
  .object({
    text: z.string(),
    modelId: z.string().min(1),
    tokens: z.number().int().nonnegative().optional(),
    timingMs: z.number().optional()
  })
  .strict();

export const ChatStreamQuery = z
  .object({
    modelId: z.string().min(1),
    prompt: z.string().min(1).max(4000)
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
    modelId: z.string().min(1)
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
export type ChatStreamDeltaT = z.infer<typeof ChatStreamDelta>;
export type ChatStreamDoneT = z.infer<typeof ChatStreamDone>;
export type ChatHistoryConversationT = z.infer<typeof ChatHistoryConversation>;
export type ChatHistoryResponseT = z.infer<typeof ChatHistoryResponse>;