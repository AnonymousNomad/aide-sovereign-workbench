import { type Route } from '../server.ts';
import { RouteError } from '../server.ts';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createExpertRegistry } = require('../../../harness/micro-experts.mjs');
const { taskRouterFeatures } = require('../../../harness/expert-featurizers.mjs');

export type ExpertsService = {
  intent(message: string): Promise<{ expert: string; phase: string; confidence: number }>;
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
        throw new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'infer failed');
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
      catch (error) { throw new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'freeze failed'); }
    },
    async thaw(name) {
      try { const r = await registry.thaw(name); return { name, state: r.state }; }
      catch (error) { throw new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'thaw failed'); }
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

// ADVISORY layer: results inform orchestration surfaces; they never gate or
// block anything on their own (approval hierarchy unchanged).
export function routesForExperts(service: ExpertsService): Route[] {
  return [
    {
      method: 'POST',
      path: '/api/experts/intent',
      body: IntentBody,
      response: IntentResponse,
      handler: async ({ body }) => service.intent((body as { message: string }).message)
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
      handler: async ({ body }) => service.train((body as { rows: Array<{ features: Record<string, number>; label: string; role: string; domain: string }> }).rows)
    },
    {
      method: 'POST',
      path: '/api/experts/infer',
      body: InferBody,
      response: InferResponse,
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
      response: StateResponse,
      handler: async ({ body }) => service.freeze((body as { name: string }).name)
    },
    {
      method: 'POST',
      path: '/api/experts/thaw',
      response: StateResponse,
      handler: async ({ body }) => service.thaw((body as { name: string }).name)
    }
  ];
}
