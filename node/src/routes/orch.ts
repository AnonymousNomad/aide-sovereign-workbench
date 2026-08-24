import { type Route } from '../server.ts';
import { OrchContextResponse } from '../../../common/contracts/orch.ts';

type OrchService = {
  getContext(): Promise<unknown>;
};

export function routesForOrch(service: OrchService): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/orch/context',
      response: OrchContextResponse,
      handler: async () => service.getContext()
    }
  ];
}
