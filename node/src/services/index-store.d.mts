export declare const INDEX_VERSION: number;

export interface ScannedFile {
  rel: string;
  abs: string;
}

export interface StoredChunk {
  id: string;
  path: string;
  line: number;
  header: string;
  body: string;
}

export declare function indexDir(workspace: string): string;
export declare function scanWorkspace(workspace: string): ScannedFile[];
export declare function hashFile(absPath: string): string;
export declare function loadIndex(workspace: string): { files: Record<string, string>; branch: string | null; chunks: StoredChunk[]; dim: number; vectors: Float32Array[] } | null;
export declare function persistIndex(workspace: string, index: { branch: string | null; files: Record<string, string>; chunks: StoredChunk[]; dim: number; vectors: Float32Array[] }): void;
export declare function normalize(vec: ArrayLike<number>): Float32Array;
