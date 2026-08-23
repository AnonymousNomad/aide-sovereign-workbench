export declare function createSecretStore(options?: {
  secretsPath: string;
  protect?: (plaintext: string) => string;
  unprotect?: (ciphertext: string) => string;
}): {
  setKey(providerId: string, apiKey: string): void;
  getKey(providerId: string): string | null;
  deleteKey(providerId: string): boolean;
  listProviderIds(): string[];
};
