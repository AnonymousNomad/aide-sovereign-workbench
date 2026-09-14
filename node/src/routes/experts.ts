import { type Route } from '../server.ts';
import { RouteError } from '../server.ts';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createExpertRegistry } = require('../../../harness/micro-experts.mjs');
const { taskRouterFeatures, diffRiskFeatures, requestIntentFeatures } = require('../../../harness/expert-featurizers.mjs');

// Registry validation failures (e.g. an invalid expert identity) are client
// errors: authority approval never overrides domain validation or containment.
function domainRouteError(error: unknown, fallback: string): RouteError {
  if (error instanceof RouteError) return error;
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : fallback;
  if (code === 'VALIDATION') return new RouteError('BAD_REQUEST', message);
  return new RouteError('CHILD_FAILED', message);
}

export type ExpertsService = {
  workspace: string;
  intent(message: string): Promise<{ expert: string; phase: string; confidence: number }>;
  diffRisk(diff: string): Promise<{ expert: string; risk: string; confidence: number }>;
  classifyRequest(message: string): Promise<{ expert: string; intent: string; confidence: number }>;
  list(): Promise<Array<{ name: string; role: string; domain: string; params: number; state: string; updated_at: number | null }>>;
  get(name: string): Promise<unknown | null>;
  train(rows: Array<{ features: Record<string, number>; label: string; role: string; domain: string }>): Promise<{ name: string; agreement: number; params: number }>;
  infer(name: string, features: Record<string, number>): Promise<{ class: string; confidence: number }>;
  stats(name: string): Promise<{ name: string; invocations: number; threshold: number; state: string }>;
  freeze(name: string): Promise<{ name: string; state: string }>;
  thaw(name: string): Promise<{ name: string; state: string }>;
};

export function createExpertsService(workspace: string): ExpertsService {
  const registry = createExpertRegistry({ workspace });
  // Read-side: enumerate on-disk manifests under .aide/experts/*.json so the
  // operator can see what exists without training anything. The registry's
  // hot/cold residency is a write-side concept; list() reports the union.
  const expertsDir = path.join(workspace, '.aide', 'experts');
  async function readManifests() {
    try {
      const names = await fs.readdir(expertsDir);
      const out = [];
      for (const n of names) {
        if (!n.endsWith('.json')) continue;
        try {
          const m = JSON.parse(await fs.readFile(path.join(expertsDir, n), 'utf8'));
          out.push({
            name: m.name || n.replace(/\.json$/, ''),
            role: m.role || 'unknown',
            domain: m.domain || 'unknown',
            params: m.meta?.params || 0,
            state: m.meta?.state || 'hot',
            updated_at: m.meta?.updated_at || null
          });
        } catch { /* ignore unreadable */ }
      }
      return out;
    } catch { return []; }
  }
  return {
    workspace,
    async intent(message) {
      try {
        const expert = await registry.allocate('orchestrator.intent');
        if (!expert) throw new RouteError('NOT_FOUND', 'no micro-expert covers orchestrator.intent');
        const features = taskRouterFeatures(message);
        const result = await registry.infer(expert, features);
        return { expert, phase: result.class, confidence: Number(result.confidence.toFixed(3)) };
      } catch (error) {
        if (error instanceof RouteError) throw error;
        throw new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'intent inference failed');
      }
    },
    async list() { return readManifests(); },
    // Same shape as intent(): allocate -> featurize -> infer. ADVISORY ONLY.
    async diffRisk(diff) {
      try {
        const expert = await registry.allocate('agent.proposal.diff');
        if (!expert) throw new RouteError('NOT_FOUND', 'no micro-expert covers agent.proposal.diff');
        const features = diffRiskFeatures(diff);
        const result = await registry.infer(expert, features);
        return { expert, risk: result.class, confidence: Number(result.confidence.toFixed(3)) };
      } catch (error) {
        if (error instanceof RouteError) throw error;
        throw new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'diff-risk inference failed');
      }
    },
    async classifyRequest(message) {
      try {
        const expert = await registry.allocate('telegram.message');
        if (!expert) throw new RouteError('NOT_FOUND', 'no micro-expert covers telegram.message');
        const features = requestIntentFeatures(message);
        const result = await registry.infer(expert, features);
        return { expert, intent: result.class, confidence: Number(result.confidence.toFixed(3)) };
      } catch (error) {
        if (error instanceof RouteError) throw error;
        throw new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'request-intent inference failed');
      }
    },
    async get(name) {
      try { return await registry._test?.hot?.get(name) ?? null; } catch { return null; }
    },
    async train(rows) {
      try {
        const manifest = registry.trainFromRows(rows);
        const saved = await registry.save(manifest);
        return { name: saved.name, agreement: manifest.meta?.val_agreement || 0, params: saved.params };
      } catch (error) {
        throw new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'train failed');
      }
    },
    async infer(name, features) {
      try {
        const result = await registry.infer(name, features);
        return { class: result.class, confidence: Number(result.confidence.toFixed(3)) };
      } catch (error) {
        throw domainRouteError(error, 'infer failed');
      }
    },
    async stats(name) {
      const manifests = await readManifests();
      const m = manifests.find(x => x.name === name);
      if (!m) throw new RouteError('NOT_FOUND', `unknown expert: ${name}`);
      return { name, invocations: m.params > 0 ? 1 : 0, threshold: 5, state: m.state };
    },
    async freeze(name) {
      try { const r = await registry.freeze(name); return { name, state: r.state }; }
      catch (error) { throw domainRouteError(error, 'freeze failed'); }
    },
    async thaw(name) {
      try { const r = await registry.thaw(name); return { name, state: r.state }; }
      catch (error) { throw domainRouteError(error, 'thaw failed'); }
    }
  };
}

const z = require('zod') as typeof import('zod');
const IntentBody = z.object({ message: z.string().min(1).max(4000) }).strict();
const IntentResponse = z.object({
  expert: z.string(),
  phase: z.enum(['debug', 'question', 'plan', 'code']),
  confidence: z.number().min(0).max(1)
}).strict();
const ExpertListResponse = z.object({ experts: z.array(z.object({
  name: z.string(), role: z.string(), domain: z.string(),
  params: z.number().int().gte(0), state: z.string(),
  updated_at: z.number().int().nullable()
}).strict()) }).strict();
const TrainBody = z.object({
  rows: z.array(z.object({
    features: z.record(z.string(), z.number()),
    label: z.string(),
    role: z.string().default('classify'),
    domain: z.string().default('user')
  }).strict()).min(20)
}).strict();
const TrainResponse = z.object({
  name: z.string(), agreement: z.number().min(0).max(1), params: z.number().int().gte(0)
}).strict();
const InferBody = z.object({
  name: z.string(),
  features: z.record(z.string(), z.number())
}).strict();
const InferResponse = z.object({
  class: z.string(), confidence: z.number().min(0).max(1)
}).strict();
const StatsResponse = z.object({
  name: z.string(), invocations: z.number().int().gte(0),
  threshold: z.number().int().gte(0), state: z.string()
}).strict();
const StateResponse = z.object({ name: z.string(), state: z.string() }).strict();
// ExpertRegistry canonical identity grammar (mirrors the registry's
// assertExpertName): lowercase alphanumerics and hyphens, starting
// alphanumeric, 1-64 characters, and never the reserved registry-state name.
// Validation is identity-only: the accepted string is bound verbatim as the
// operation target, exactly as the registry will use it at actuation.
const EXPERT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TierStateBody = z.object({
  name: z.string().regex(EXPERT_NAME_PATTERN, 'invalid expert name').refine(name => name !== 'signals', 'reserved expert name')
}).strict();
const DiffRiskBody = z.object({ diff: z.string().min(1).max(60_000) }).strict();
const DiffRiskResponse = z.object({
  expert: z.string(),
  risk: z.enum(['low', 'review', 'block']),
  confidence: z.number().min(0).max(1)
}).strict();
const ClassifyBody = z.object({ message: z.string().min(1).max(4000) }).strict();
const ClassifyResponse = z.object({
  expert: z.string(),
  intent: z.enum(['system', 'business', 'code']),
  confidence: z.number().min(0).max(1)
}).strict();

// ADVISORY layer: results inform orchestration surfaces; they never gate or
// block anything on their own (approval hierarchy unchanged). Each advisory
// route carries a read-only authority descriptor binding the exact caller
// input; there is no durable effect, process, or egress.
export function routesForExperts(service: ExpertsService): Route[] {
  return [
    {
      method: 'POST',
      path: '/api/experts/intent',
      body: IntentBody,
      response: IntentResponse,
      describeOperation: async ({ body }, taskId): Promise<OperationInput> => ({
        workspace: service.workspace, taskId, kind: 'capability.read', args: { body: { message: (body as { message: string }).message } }
      }),
      handler: async ({ body }) => service.intent((body as { message: string }).message)
    },
    {
      // ADVISORY: risk class for a proposed diff — evidence for Veritas, never a gate.
      method: 'POST',
      path: '/api/experts/diff-risk',
      body: DiffRiskBody,
      response: DiffRiskResponse,
      describeOperation: async ({ body }, taskId): Promise<OperationInput> => ({
        workspace: service.workspace, taskId, kind: 'capability.read', args: { body: { diff: (body as { diff: string }).diff } }
      }),
      handler: async ({ body }) => service.diffRisk((body as { diff: string }).diff)
    },
    {
      // ADVISORY: local intent classification for inbound bridge messages.
      method: 'POST',
      path: '/api/experts/classify-request',
      body: ClassifyBody,
      response: ClassifyResponse,
      describeOperation: async ({ body }, taskId): Promise<OperationInput> => ({
        workspace: service.workspace, taskId, kind: 'capability.read', args: { body: { message: (body as { message: string }).message } }
      }),
      handler: async ({ body }) => service.classifyRequest((body as { message: string }).message)
    },
    {
      method: 'GET',
      path: '/api/experts',
      response: ExpertListResponse,
      handler: async () => ({ experts: await service.list() })
    },
    {
      method: 'POST',
      path: '/api/experts/train',
      body: TrainBody,
      response: TrainResponse,
      // In-process micro-expert training: pure local compute plus one manifest
      // write under the workspace. The approved operation binds the exact
      // training rows; no process, egress, dataset, or unrelated target is
      // involved.
      describeOperation: async ({ body }, taskId): Promise<OperationInput> => {
        const { rows } = body as { rows: Array<{ features: Record<string, number>; label: string; role: string; domain: string }> };
        return { workspace: service.workspace, taskId, kind: 'capability.execute', args: { body: { rows } } };
      },
      handler: async ({ body }) => service.train((body as { rows: Array<{ features: Record<string, number>; label: string; role: string; domain: string }> }).rows)
    },
    {
      method: 'POST',
      path: '/api/experts/infer',
      body: InferBody,
      response: InferResponse,
      describeOperation: async ({ body }, taskId): Promise<OperationInput> => {
        const { name, features } = body as { name: string; features: Record<string, number> };
        return { workspace: service.workspace, taskId, kind: 'capability.read', args: { body: { name, features } } };
      },
      handler: async ({ body }) => service.infer(
        (body as { name: string }).name,
        (body as { features: Record<string, number> }).features
      )
    },
    {
      method: 'GET',
      path: '/api/experts/stats',
      response: StatsResponse,
      handler: async ({ query }) => {
        const name = (query as { name: string }).name;
        if (!name) throw new RouteError('BAD_REQUEST', 'name query param required');
        return service.stats(name);
      }
    },
    {
      method: 'POST',
      path: '/api/experts/freeze',
      body: TierStateBody,
      response: StateResponse,
      // Operator-initiated tier demotion: the approved operation binds exactly
      // the canonical expert identity. Tier directories, filename suffix,
      // rename direction, containment policy, cache eviction and the response
      // state are server-derived and never caller-controlled.
      describeOperation: async ({ body }, taskId): Promise<OperationInput> => ({
        workspace: service.workspace, taskId, kind: 'capability.write', args: { body: { name: (body as { name: string }).name } }
      }),
      handler: async ({ body }) => service.freeze((body as { name: string }).name)
    },
    {
      method: 'POST',
      path: '/api/experts/thaw',
      body: TierStateBody,
      response: StateResponse,
      // Operator-initiated tier promotion: same exact identity binding. The
      // current preserved semantics (in-memory resurrection, dormant file
      // retained) are unchanged; no caller field selects direction or tier.
      describeOperation: async ({ body }, taskId): Promise<OperationInput> => ({
        workspace: service.workspace, taskId, kind: 'capability.write', args: { body: { name: (body as { name: string }).name } }
      }),
      handler: async ({ body }) => service.thaw((body as { name: string }).name)
    }
  ];
}
