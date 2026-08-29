export type CipherStateEntry = {
  type: 'approval' | 'rejection' | 'abort' | 'ship' | 'gate' | 'phase' | 'preference' | 'error' | string;
  at?: string;
  tool?: string;
  pattern?: string;
  summary?: string;
  decision?: string;
  [extra: string]: unknown;
};

export type CipherStateBus = {
  append(event: CipherStateEntry): Promise<void>;
  readState(opts?: { type?: string; since?: string; limit?: number }): Promise<CipherStateEntry[]>;
  getPreferences(minCount?: number, limit?: number): Promise<string[]>;
};

export function createStateBus(workspace: string): CipherStateBus;
