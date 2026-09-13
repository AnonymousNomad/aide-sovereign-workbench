import { z } from 'zod';

// Information descriptors only: parsing and integrity hashes confer no
// identity, execution permission, approval or permission to transmit data.
const id = z.string().min(1).max(256);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const tokens = z.number().int().min(0).max(10_000_000);
const time = z.string().datetime();
export const ContextRole = z.enum(['planner', 'coder', 'reviewer', 'security', 'research']);
export const ContextExposure = z.enum(['LOCAL_ONLY', 'REMOTE_ALLOWED', 'ASK', 'NEVER_EXPOSE']);
export const ContextSource = z.object({
  id, revision: id.nullable(), locator: z.string().max(2048).nullable()
}).strict();
export const ContextDestination = z.object({
  modelId: id, modelRevision: id, providerId: id,
  locality: z.enum(['local', 'remote']), servedContextLimit: tokens.min(1)
}).strict();

export const ContextItem = z.object({
  id, revision: id,
  type: z.enum(['instruction', 'source', 'fact', 'memory', 'skill', 'tool_result', 'evidence', 'operator_preference']),
  source: ContextSource,
  provenance: z.object({
    producer: id, observedAt: time,
    evidenceRefs: z.array(id).max(128),
    derivedFrom: z.array(ContextSource).max(128),
    transform: z.object({ id, version: id, omissions: z.array(z.string().max(2048)).max(128) }).strict().nullable(),
    basis: z.enum(['observed', 'operator_asserted', 'derived', 'unverified']),
    confidence: z.number().min(0).max(1).nullable()
  }).strict(),
  scope: z.object({ workspaceId: id, taskId: id.nullable(), roles: z.array(ContextRole).min(1).max(5) }).strict(),
  privacy: ContextExposure,
  freshness: z.object({ snapshotRef: id.nullable(), validUntil: time.nullable(), revoked: z.boolean() }).strict(),
  selection: z.object({
    required: z.boolean(), pinned: z.boolean(), relevance: z.number().min(0).max(1),
    dependencies: z.array(id).max(128), conflicts: z.array(id).max(128), redundancyGroup: id.nullable()
  }).strict(),
  content: z.string().max(65_536)
}).strict().superRefine((item, ctx) => {
  const derived = item.provenance.derivedFrom.length > 0 || item.provenance.transform !== null;
  if (derived && !['derived', 'unverified'].includes(item.provenance.basis)) {
    ctx.addIssue({ code: 'custom', message: 'derived content cannot claim observed/operator trust', path: ['provenance', 'basis'] });
  }
  if (item.provenance.transform && item.provenance.derivedFrom.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'compression requires original source references', path: ['provenance', 'derivedFrom'] });
  }
});

export const ContextRequest = z.object({
  taskId: id, attemptId: id, workspaceId: id, snapshotRef: id,
  role: ContextRole, destination: ContextDestination, evaluatedAt: time
}).strict();

export const ContextPolicy = z.object({
  id, revision: id,
  // Eligibility only; local_and_remote does not enable network operations.
  destinations: z.enum(['local_only', 'local_and_remote']),
  maxInputTokens: tokens.min(1), reservedOutputTokens: tokens,
  safetyMarginTokens: tokens, framingReserveTokens: tokens
}).strict();

export const ContextBuildInput = z.object({
  request: ContextRequest, policy: ContextPolicy, items: z.array(ContextItem).max(128)
}).strict();

// This projection contains no excluded IDs, locators, private provenance,
// hidden-item counts or local manifest hash. Eligibility is supplied by the
// future trusted Context Engine; content is never promoted to system authority.
export const ContextWorkerProjection = z.object({
  role: ContextRole, destination: ContextDestination,
  messages: z.array(z.object({ channel: z.literal('untrusted_data'), text: z.string().max(65_536) }).strict()).max(128)
}).strict();

export const ContextBudget = z.object({
  inputTokens: tokens, reservedOutputTokens: tokens, safetyMarginTokens: tokens,
  framingReserveTokens: tokens, servedContextLimit: tokens.min(1), maxInputTokens: tokens.min(1),
  measurement: z.literal('conservative_estimate'), counterVersion: z.literal('utf8-bytes-plus-framing-v1')
}).strict();

export const ContextManifest = z.object({
  request: ContextRequest, requestDigest: digest, policy: ContextPolicy, policyDigest: digest,
  included: z.array(z.object({
    item: ContextItem, contentDigest: digest, itemDigest: digest,
    reason: z.enum(['required', 'dependency', 'ranked'])
  }).strict()).max(128),
  excluded: z.array(z.object({
    itemId: id, revision: id, source: ContextSource,
    reason: z.enum(['privacy', 'release_required', 'expired', 'revoked', 'stale', 'dependency_unavailable', 'conflict', 'redundant', 'budget'])
  }).strict()).max(128),
  budget: ContextBudget
}).strict();

export const ContextEnvelope = z.object({
  schemaVersion: z.literal('1'), serialization: z.literal('covert-context-json-v1'),
  manifest: ContextManifest, worker: ContextWorkerProjection, digest
}).strict();

export type ContextItemT = z.infer<typeof ContextItem>;
export type ContextRequestT = z.infer<typeof ContextRequest>;
export type ContextPolicyT = z.infer<typeof ContextPolicy>;
export type ContextManifestT = z.infer<typeof ContextManifest>;
export type ContextEnvelopeT = z.infer<typeof ContextEnvelope>;
export type ContextWorkerProjectionT = z.infer<typeof ContextWorkerProjection>;
export type ContextBuildInputT = z.infer<typeof ContextBuildInput>;
export type DeepReadonly<T> = T extends readonly (infer V)[] ? readonly DeepReadonly<V>[] :
  T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
