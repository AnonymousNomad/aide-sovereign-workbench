export interface KeybindingRule {
  key: string;
  command: string;
  when?: string;
  source: 'default' | 'user';
}

export declare class KeybindingService {
  constructor(options: { workspace: string; rules?: Array<{ key: string; command: string; when?: string }> });
  load(): Promise<KeybindingRule[]>;
  list(): KeybindingRule[];
  resolve(chords: string[], context?: Record<string, unknown>): { match: string | null; pending: boolean };
  writeUserRules(rules: Array<{ key: string; command: string; when?: string }>): Promise<KeybindingRule[]>;
}
