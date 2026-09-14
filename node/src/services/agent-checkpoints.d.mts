import type { ExecutionAuthority, ExecutionHandle } from './execution-authority.mjs';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
export declare class CheckpointError extends Error {
  code: string;
  detail: Record<string, unknown>;
  constructor(message: string, detail?: Record<string, unknown>);
}

export declare function createCheckpointService(options: { workspace: string; authority?: ExecutionAuthority | undefined }): {
  describe(action: 'snapshot' | 'restore', value: string, taskId: string): OperationInput;
  commit(message: string, execution?: ExecutionHandle): Promise<string>;
  restore(hash: string, execution?: ExecutionHandle): Promise<void>;
  headHash(): Promise<string | null>;
  readonly shadowDir: string;
};
