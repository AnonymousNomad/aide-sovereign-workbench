export interface CommandDescriptor {
  id: string;
  title: string;
  category: string;
  icon: string;
  when: string;
  enablement: string;
  hidden: boolean;
}

export declare class CommandRegistry {
  constructor(options?: { onEvent?: ((event: string, body: Record<string, unknown>) => void) | null });
  registerCommand(descriptor: { id: string; title: string; category?: string; icon?: string; when?: string; enablement?: string; hidden?: boolean; handler: (args: unknown) => unknown }): { dispose(): void; descriptor: CommandDescriptor };
  list(): CommandDescriptor[];
  get(id: string): { descriptor: CommandDescriptor; handler: (args: unknown) => unknown } | null;
  invoke(id: string, args: unknown, context?: Record<string, unknown>): Promise<{ result?: unknown; error?: string; message?: string }>;
  fingerprint(): string;
}
