// node/src/routes/system-map.ts (cline/T4, 2026-09-03)
//
// PR A of aide-system-map. 1 route: GET /api/system-map/snapshot.
// Pattern matches routes/onboarding.ts (same factory shape).

import { type Route } from '../server.ts';
import { SystemMapResponse } from '../../../common/contracts/system-map.ts';
import { createSystemMapService } from '../services/system-map.mjs';

export function routesForSystemMap(workspace: string): Route[] {
  const svc = createSystemMapService({ workspace });
  return [
    { method: "GET", path: "/api/system-map/snapshot", response: SystemMapResponse, handler: async () => {
      const snapshot = await svc.getSnapshot();
      return { snapshot };
    } }
  ];
}
