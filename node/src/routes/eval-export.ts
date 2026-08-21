import { RouteError, type Route } from '../server.ts';
import {
  EvalRunRequest,
  EvalRunResponse,
  ExportsListResponse,
  ExportCreateRequest,
  ExportCreateResponse,
  type EvalRunRequestT,
  type EvalRunResponseT,
  type ExportsListResponseT,
  type ExportCreateRequestT,
  type ExportCreateResponseT
} from '../../../common/contracts/eval-export.ts';
import type { EvalExportGate } from '../../../daemon/eval-export.mjs';

export function routeForEvalRun(gate: EvalExportGate): Route {
  return {
    method: 'POST',
    path: '/api/training/export-eval',
    body: EvalRunRequest,
    response: EvalRunResponse,
    handler: async ({ body }): Promise<EvalRunResponseT> => await gate.evaluate((body as unknown as EvalRunRequestT).job_id) as unknown as EvalRunResponseT
  };
}

export function routeForExportCreate(gate: EvalExportGate): Route {
  return {
    method: 'POST',
    path: '/api/training/export',
    body: ExportCreateRequest,
    response: ExportCreateResponse,
    handler: async ({ body }): Promise<ExportCreateResponseT> => {
      const input = body as unknown as ExportCreateRequestT;
      const result = await gate.exportAdapter(input.job_id, { quant: input.quant ?? 'Q4_K_M' });
      if (result.error === 'FORBIDDEN') throw new RouteError('FORBIDDEN', result.message ?? 'export blocked by eval gate');
      if (result.error === 'NOT_FOUND') throw new RouteError('NOT_FOUND', result.message ?? 'no adapter for job');
      if (result.error) throw new RouteError('BAD_REQUEST', result.message ?? 'invalid export request');
      return { manifest: result.manifest as NonNullable<ExportCreateResponseT['manifest']> };
    }
  };
}

export function routeForExportsList(gate: EvalExportGate): Route {
  return {
    method: 'GET',
    path: '/api/training/exports',
    response: ExportsListResponse,
    handler: (): ExportsListResponseT => ({ exports: gate.listExports() })
  };
}
