import { type Route, RouteError } from '../server.ts';
import {
  OrchestratorBundleCardQuery,
  OrchestratorBundleCardResponse
} from '../../../common/contracts/orchestrator.ts';

type OrchestratorCardService = {
  card(task: string, mode?: 'plan' | 'act'): unknown;
};

export function routesForOrchestrator(service: OrchestratorCardService): Route[] {
  return [{
    method: 'GET',
    path: '/api/orchestrator/bundle-card',
    query: OrchestratorBundleCardQuery,
    response: OrchestratorBundleCardResponse,
    handler: ({ query }) => {
      const task = query.task;
      if (!task) throw new RouteError('BAD_REQUEST', 'task is required');
      const mode = query.mode === 'plan' ? 'plan' : 'act';
      try {
        return service.card(task, mode);
      } catch (error) {
        throw new RouteError('CHILD_FAILED', `bundle card failed: ${String(error instanceof Error ? error.message : error).slice(0, 300)}`);
      }
    }
  }];
}
