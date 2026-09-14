import { z } from 'zod';

export const AuthorityPairRequest = z.object({ proof: z.string().min(32).max(256) }).strict();
export const AuthoritySessionResponse = z.object({ token: z.string().min(32), actor_id: z.string(), expires_at: z.number() }).strict();
export const AuthorityDecisionRequest = z.object({ operation_id: z.string().uuid(), decision: z.enum(['approve', 'reject']) }).strict();
export const AuthorityOperationResponse = z.object({
  operation_id: z.string().uuid(), actor_id: z.string(), task_id: z.string(),
  workspace: z.string(), kind: z.string(), digest: z.string(),
  risk: z.enum(['read', 'write', 'execute', 'external', 'permission', 'revoke']),
  state: z.enum(['pending', 'recording', 'approved', 'rejected', 'consuming', 'executing', 'succeeded', 'failed', 'revoked', 'expired']),
  expires_at: z.number(), args: z.unknown()
}).strict();
export const AuthorityDecisionResponse = z.object({ operation: AuthorityOperationResponse }).strict();
export const AuthorityStatusResponse = z.object({ paired: z.boolean(), actor_id: z.string().optional() }).strict();
export const AuthorityPrepareRequest = z.object({
  adapter: z.enum(['ts', 'legacy']).optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
  path: z.string().min(1).max(2048),
  task_id: z.string().min(1).max(256),
  body: z.unknown().optional()
}).strict();
export const AuthorityInspectQuery = z.object({ id: z.string().uuid() }).strict();
