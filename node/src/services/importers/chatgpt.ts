import { z } from 'zod';

const ChatGptMessage = z
  .object({
    author: z.object({ role: z.enum(['system', 'user', 'assistant', 'tool']) }),
    create_time: z.number().nullable().optional(),
    content: z
      .object({
        content_type: z.string(),
        parts: z.array(z.string())
      })
      .nullable()
      .optional()
  })
  .nullable()
  .optional();

const ChatGptNode = z.object({
  message: ChatGptMessage,
  parent: z.string().nullable().optional(),
  children: z.array(z.string()).optional()
});

type ChatGptNodeT = z.infer<typeof ChatGptNode>;

const ChatGptConversation = z.object({
  id: z.string(),
  title: z.string().optional(),
  create_time: z.number().nullable().optional(),
  mapping: z.record(z.string(), ChatGptNode),
  current_node: z.string()
});

export const ChatGptExport = z.union([z.array(ChatGptConversation), z.object({ conversations: z.array(ChatGptConversation) })]);

export type ChatGptConversationT = z.infer<typeof ChatGptConversation>;

export interface ParsedConversation {
  title: string;
  messages: Array<{ role: string; content: string }>;
  updatedAt: number;
  warnings: string[];
}

export function parseChatGptExport(payload: string): { conversations: ParsedConversation[]; skipped: number; warnings: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    throw new Error('not valid JSON');
  }
  const parsed = ChatGptExport.safeParse(raw);
  if (!parsed.success) {
    throw new Error('not a ChatGPT conversations export (missing "mapping"/"current_node" shape)');
  }
  const conversations = Array.isArray(parsed.data) ? parsed.data : parsed.data.conversations;
  const warnings: string[] = [];
  const out: ParsedConversation[] = [];
  let skipped = 0;
  for (const conversation of conversations.slice(0, 200)) {
    const node = conversation.mapping[conversation.current_node];
    if (node === undefined) {
      skipped += 1;
      warnings.push(`conversation ${conversation.id}: current_node not found`);
      continue;
    }
    const chain: ChatGptNodeT[] = [];
    let cursor: string | null = conversation.current_node;
    let guard = 0;
    while (cursor !== null && cursor !== undefined) {
      const entry: ChatGptNodeT | undefined = conversation.mapping[cursor];
      if (entry === undefined) break;
      chain.push(entry);
      cursor = entry.parent ?? null;
      guard += 1;
      if (guard > 10_000) {
        warnings.push(`conversation ${conversation.id}: parent chain too long, truncated`);
        break;
      }
    }
    chain.reverse();
    const messages: Array<{ role: string; content: string }> = [];
    let lastMessageTime: number | null = null;
    for (const entry of chain) {
      const message = entry.message;
      if (message === null || message === undefined) continue;
      if (message.author.role === 'tool') continue;
      const parts = message.content?.parts.filter(part => part.length > 0) ?? [];
      if (parts.length === 0) continue;
      messages.push({ role: message.author.role, content: parts.join('\n') });
      if (message.create_time !== null && message.create_time !== undefined) lastMessageTime = message.create_time;
    }
    if (messages.length === 0) {
      skipped += 1;
      continue;
    }
    out.push({
      title: conversation.title?.trim().slice(0, 120) || 'ChatGPT conversation',
      messages,
      updatedAt: Math.round((lastMessageTime ?? conversation.create_time ?? Date.now() / 1000) * 1000),
      warnings: []
    });
  }
  if (conversations.length > 200) warnings.push('export had more than 200 conversations; imported the first 200');
  return { conversations: out, skipped, warnings };
}