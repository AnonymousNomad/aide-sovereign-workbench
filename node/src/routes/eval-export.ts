import path from 'node:path';
import { RouteError, type Route } from '../server.ts';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
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
import { normalizeJobId, type EvalExportGate } from '../../../daemon/eval-export.mjs';

// Export is a bounded local write owned by the accepted EvalExportGate. The
// descriptor binds the same normalized job id and quant the handler executes;
// all containment (lexical grammar, canonical workspace/roots, per-object
// realpath, atomic temp/rename write) stays in the domain owner.
function exportBinding(body: unknown): { job_id: string; quant: string } {
  const input = body as ExportCreateRequestT;
  const jobId = normalizeJobId(input.job_id);
  if (jobId === null) throw new RouteError('BAD_REQUEST', 'invalid job id');
  return { job_id: jobId, quant: input.quant ?? 'Q4_K_M' };
}

function exportWorkspace(gate: EvalExportGate): string {
  const aideDir = path.dirname(gate.workDir);
  if (path.basename(aideDir) !== '.aide') throw new RouteError('NOT_READY', 'export workspace layout unavailable');
  return path.dirname(aideDir);
}

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
    describeOperation: async ({ body }, taskId): Promise<OperationInput> => ({
      workspace: exportWorkspace(gate), taskId, kind: 'capability.write', args: { body: exportBinding(body) }
    }),
    handler: async ({ body }): Promise<ExportCreateResponseT> => {
      const binding = exportBinding(body);
      const result = await gate.exportAdapter(binding.job_id, { quant: binding.quant });
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
