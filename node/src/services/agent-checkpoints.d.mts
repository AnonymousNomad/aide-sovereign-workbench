export declare class CheckpointError extends Error {
  constructor(message: string);
}

export declare function createCheckpointService(options: { workspace: string }): {
  commit(message: string): Promise<string>;
  restore(hash: string): Promise<void>;
  headHash(): Promise<string>;
  readonly shadowDir: string;
};
