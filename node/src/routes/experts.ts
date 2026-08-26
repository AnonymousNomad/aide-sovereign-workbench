import { type Route } from '../server.ts';
import { RouteError } from '../server.ts';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createExpertRegistry } = require('../../../harness/micro-experts.mjs');
const { taskRouterFeatures } = require('../../../harness/expert-featurizers.mjs');

export type ExpertsService = {
  intent(message: string): Promise<{ expert: string; phase: string; confidence: number }>;
};

export function createExpertsService(workspace: string): ExpertsService {
  const registry = createExpertRegistry({ workspace });
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
    }
  ];
}
