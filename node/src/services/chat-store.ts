import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface ChatConversation {
  id: string;
  modelId: string;
  title: string;
  messages: Array<{ role: string; content: string }>;
  updatedAt: number;
}

export class ChatStore {
  private readonly filePath: string;
  private conversations: ChatConversation[] = [];
  private loaded = false;

  constructor(workspace: string) {
    this.filePath = path.join(workspace, '.aide', 'chat-history.json');
  }

  async load(): Promise<ChatConversation[]> {
    if (this.loaded) return this.conversations;
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as { conversations?: unknown };
      if (Array.isArray(raw.conversations)) {
        this.conversations = raw.conversations as ChatConversation[];
      }
    } catch {
      this.conversations = [];
    }
    this.loaded = true;
    return this.conversations;
  }

  list(): ChatConversation[] {
    return [...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): ChatConversation | undefined {
    return this.conversations.find(conversation => conversation.id === id);
  }

  async save(conversation: Omit<ChatConversation, 'id' | 'updatedAt'> & { id?: string }): Promise<ChatConversation> {
    await this.load();
    const existing = conversation.id === undefined ? undefined : this.get(conversation.id);
    if (existing !== undefined) {
      existing.modelId = conversation.modelId;
      existing.title = conversation.title;
      existing.messages = conversation.messages;
      existing.updatedAt = Date.now();
      await this.persist();
      return existing;
    }
    const entry: ChatConversation = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      modelId: conversation.modelId,
      title: conversation.title,
      messages: conversation.messages,
      updatedAt: Date.now()
    };
    this.conversations.push(entry);
    this.conversations = this.conversations.slice(-200);
    await this.persist();
    return entry;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true }).catch(() => {});
    await fs.writeFile(this.filePath, JSON.stringify({ conversations: this.conversations }, null, 2), 'utf8');
  }
}