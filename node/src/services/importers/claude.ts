import { z } from 'zod';

const ClaudeBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('thinking'), thinking: z.string() }),
  z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({ type: z.literal('tool_result'), content: z.union([z.string(), z.array(z.unknown())]).optional() })
]);

const ClaudeMessage = z.object({
  uuid: z.string(),
  sender: z.enum(['human', 'assistant']),
  content: z.array(ClaudeBlock),
  created_at: z.string(),
  parent_message_uuid: z.string().nullable().optional()
});

const ClaudeConversation = z.object({
  uuid: z.string(),
  name: z.string().optional(),
  chat_messages: z.array(ClaudeMessage),
  current_leaf_message_uuid: z.string().optional()
});

export const ClaudeExport = z.object({ conversations: z.array(ClaudeConversation) });

export interface ParsedConversation {
  title: string;
  messages: Array<{ role: string; content: string }>;
  updatedAt: number;
  warnings: string[];
}

export function parseClaudeExport(payload: string): { conversations: ParsedConversation[]; skipped: number; warnings: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    throw new Error('not valid JSON');
  }
  const parsed = ClaudeExport.safeParse(raw);
  if (!parsed.success) {
    throw new Error('not a Claude conversations export (missing "conversations" with "chat_messages")');
  }
  const warnings: string[] = [];
  const out: ParsedConversation[] = [];
  let skipped = 0;
  for (const conversation of parsed.data.conversations.slice(0, 200)) {
    const messages: Array<{ role: string; content: string }> = [];
    let thinkingBlocks = 0;
    let toolBlocks = 0;
    for (const message of conversation.chat_messages) {
      const parts: string[] = [];
      for (const block of message.content) {
        if (block.type === 'text' && block.text.length > 0) {
          parts.push(block.text);
        } else if (block.type === 'thinking') {
          thinkingBlocks += 1;
        } else if (block.type === 'tool_use' || block.type === 'tool_result') {
          toolBlocks += 1;
        }
      }
      if (parts.length === 0) continue;
      messages.push({ role: message.sender === 'human' ? 'user' : 'assistant', content: parts.join('\n') });
    }
    if (messages.length === 0) {
      skipped += 1;
      continue;
    }
    const localWarnings: string[] = [];
    if (thinkingBlocks > 0) localWarnings.push(`dropped ${thinkingBlocks} thinking block(s)`);
    if (toolBlocks > 0) localWarnings.push(`dropped ${toolBlocks} tool block(s)`);
    out.push({
      title: conversation.name?.trim().slice(0, 120) || 'Claude conversation',
      messages,
      updatedAt: Date.parse(conversation.chat_messages[0]?.created_at ?? '') || Date.now(),
      warnings: localWarnings
    });
  }
  if (parsed.data.conversations.length > 200) warnings.push('export had more than 200 conversations; imported the first 200');
  return { conversations: out, skipped, warnings };
}