export interface Sha256CacheEntry {
  mtimeMs: number;
  size: number;
  hash: string;
}

export declare function sha256File(
  file: string,
  cache?: Map<string, Sha256CacheEntry> | null
): Promise<string>;

export declare function verifySha256(
  file: string,
  expected: string,
  cache?: Map<string, Sha256CacheEntry> | null
): Promise<{
  status: 'verified' | 'checksum-mismatch' | 'missing';
  expected: string;
  actual: string | null;
}>;
