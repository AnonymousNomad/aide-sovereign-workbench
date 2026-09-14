export type OperationRisk = 'read' | 'write' | 'execute' | 'external' | 'permission' | 'revoke';
export interface OperationInput { workspace: string; taskId: string; kind: string; args: unknown }
export interface OperationDescriptor extends Readonly<OperationInput> { readonly risk: OperationRisk; readonly digest: string }
export const OPERATION_POLICY: Readonly<Record<string, OperationRisk>>;
export function normalizeOperation(input: OperationInput): OperationDescriptor;
export function httpOperationKind(method: string, routePath: string): string | null;
export function legacyOperation(workspace: string, request: {method: string; path: string; task_id: string; body?: unknown}, snapshot?: unknown): OperationInput;
