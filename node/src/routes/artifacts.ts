import { type Route } from '../server.ts';
import { ArtifactsResponse, type ArtifactsResponseT } from '../../../common/contracts/artifacts.ts';
import type { EvalExportGate } from '../../../daemon/eval-export.mjs';

export function routeForArtifacts(gate: EvalExportGate): Route {
  return {
    method: 'GET',
    path: '/api/artifacts',
    response: ArtifactsResponse,
    handler: async (): Promise<ArtifactsResponseT> => ({
      artifacts: (await gate.listExports()) as unknown as string[]
    })
  };
}