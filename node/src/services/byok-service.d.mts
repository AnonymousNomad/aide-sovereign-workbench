export declare function createByokService(options: {
  workspace: string;
  secretStore: {
    setKey(providerId: string, apiKey: string): void;
    getKey(providerId: string): string | null;
    deleteKey(providerId: string): boolean;
    listProviderIds(): string[];
  };
  fetchImpl?: typeof fetch | null;
  onEgress?: (entry: { kind: string; provider_id?: string; host?: string; role?: string }) => void;
}): {
  status(): { providers: Array<Record<string, unknown> & { key_stored: boolean }>; routing: Record<string, unknown>; consent_enabled: boolean };
  setProvider(provider: Record<string, unknown>): Record<string, unknown>;
  deleteProvider(id: string): { deleted: boolean };
  putKey(providerId: string, apiKey: string): { stored: true };
  deleteKey(providerId: string): { deleted: boolean };
  getRouting(): Record<string, unknown>;
  setRouting(routing: unknown): Record<string, unknown>;
  getConsent(): boolean;
  setConsent(enabled: boolean): boolean;
  testProvider(providerId: string, fetchOverride?: typeof fetch): Promise<{ ok: boolean; detail: string }>;
  resolveChatFn(role: 'plan' | 'act' | 'utility'): ((messages: Array<{ role: string; content: string }>) => Promise<string>) | null;
};
