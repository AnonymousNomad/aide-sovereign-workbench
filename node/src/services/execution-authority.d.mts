import type { OperationDescriptor, OperationInput } from '../../../common/security/operation-policy.mjs';
export interface ActorHandle { readonly id: string; readonly kind: 'operator' | 'agent' | 'adapter' | 'service' }
export interface ExecutionHandle { readonly operation_id: string }
export interface TelegramMessageHandle { readonly __telegramMessage?: never }
export interface TelegramAdapterPort { receive(update: unknown): TelegramMessageHandle; close(): void }
export interface AuthorityOperation {
  readonly operation_id: string; readonly actor_id: string; readonly task_id: string;
  readonly workspace: string; readonly kind: string; readonly digest: string; readonly risk: string;
  readonly state: string; readonly expires_at: number; readonly args: unknown;
}
export class AuthorityError extends Error { code: string; detail?: unknown; constructor(code: string, message: string, detail?: unknown) }
export interface ExecutionAuthority {
  control: {
    telegramAdapter(execution: ExecutionHandle, input: { chat_id: number; user_id: number }): Promise<TelegramAdapterPort>;
    createPairing(origin: string): string;
    delegate(owner: ActorHandle, kind: 'agent' | 'adapter' | 'service', scope: string[]): ActorHandle;
    revoke(actor: ActorHandle): void;
    revokePending(): void;
    close(): void;
  };
  pair(proof: string, origin: string): Promise<{ token: string; actor_id: string; expires_at: number }>;
  authenticate(token: string, origin: string): ActorHandle;
  assertActor(actor: ActorHandle): void;
  claimExecution(handle: ExecutionHandle, kind: string, body: unknown): void;
  assertExecution(handle: ExecutionHandle, kind: string, body: unknown): { actor: ActorHandle; owner: ActorHandle; operation: OperationDescriptor };
  claimTelegramMessage(handle: TelegramMessageHandle): { actor: ActorHandle; chatId: number; userId: number; text: string; taskId: string };
  decideTelegram(handle: TelegramMessageHandle, id: string, decision: 'approve' | 'reject'): Promise<AuthorityOperation>;
  prepare(actor: ActorHandle, input: OperationInput): Promise<AuthorityOperation>;
  inspect(actor: ActorHandle, id: string): AuthorityOperation;
  waitForDecision(actor: ActorHandle, id: string): Promise<AuthorityOperation>;
  decide(actor: ActorHandle, id: string, decision: 'approve' | 'reject'): Promise<AuthorityOperation>;
  execute<T>(actor: ActorHandle, id: string, input: OperationInput, executor: (operation: OperationDescriptor, execution: ExecutionHandle) => T | Promise<T>): Promise<T>;
}
export function createExecutionAuthority(options: {
  workspace: string;
  record: (event: Readonly<Record<string, unknown>>) => Promise<{ persisted: boolean; error?: string | null }>;
  clock?: () => number; sessionTtlMs?: number; operationTtlMs?: number; limit?: number;
}): ExecutionAuthority;
