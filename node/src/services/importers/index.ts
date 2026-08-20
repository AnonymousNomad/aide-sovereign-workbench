import type { ChatStore } from '../chat-store.ts';
import { parseChatGptExport } from './chatgpt.ts';
import { parseClaudeExport } from './claude.ts';

export interface ImportOutcome {
  imported: number;
  skipped: number;
  warnings: string[];
}

export async function importChatExport(store: ChatStore, format: 'chatgpt' | 'claude', payload: string): Promise<ImportOutcome> {
  const parsed = format === 'chatgpt' ? parseChatGptExport(payload) : parseClaudeExport(payload);
  const warnings = [...parsed.warnings];
  let imported = 0;
  for (const conversation of parsed.conversations) {
    await store.save({
      modelId: `import:${format}`,
      title: conversation.title,
      messages: conversation.messages,
      updatedAt: conversation.updatedAt
    });
    imported += 1;
    for (const warning of conversation.warnings) warnings.push(warning);
  }
  return { imported, skipped: parsed.skipped, warnings: warnings.slice(0, 50) };
}