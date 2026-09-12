import type { Route } from '../server.ts';
import { RouteError } from '../server.ts';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
import { ModelRuntimeError, validateRegistrationFilename, type ModelRuntime } from '../services/model-runtime.ts';
import {
  ModelStatusResponse,
  ModelIdRequest,
  ModelStartResponse,
  ModelStopResponse,
  ModelIngestRequest,
  ModelIngestResponse,
  ModelReadyQuery,
  ModelReadyResponse,
  ModelRegisterRequest,
  ModelRegisterResponse,
  ModelProfileRequest,
  ModelProfileResponse,
  type ModelRegisterRequestT,
  type ModelProfileRequestT
} from '../../../common/contracts/models.ts';

// Registration is a bounded local metadata write: the filename must be a safe
// relative .gguf that already exists inside the canonical model directory (the
// exact same validation register() applies), and the normalized descriptor
// body is what the handler executes. Nothing here imports, copies, downloads,
// converts, or executes a model, and BYOK configuration is not involved.
function registrationBody(manager: ModelRuntime, body: unknown): Record<string, unknown> {
  const input = body as ModelRegisterRequestT;
  let filename: string;
  try {
    filename = validateRegistrationFilename(manager.modelDir, input.filename);
  } catch (error) {
    throw toRouteError(error);
  }
  return {
    filename,
    ...(input.repo_id !== undefined ? { repo_id: input.repo_id } : {}),
    ...(input.quant_label !== undefined ? { quant_label: input.quant_label } : {}),
    ...(input.context_tokens !== undefined ? { context_tokens: input.context_tokens } : {})
  };
}

// Profile writes are bounded per-model sidecar patches. The model id must be
// allowlisted by the runtime at execution; the patch is the exact normalized
// value set the handler passes to saveProfile.
function profilePatch(body: unknown): { preset?: string; samplers?: Record<string, number>; runtime?: Record<string, number | string | boolean> } {
  const { preset, samplers, runtime } = body as ModelProfileRequestT;
  const patch: { preset?: string; samplers?: Record<string, number>; runtime?: Record<string, number | string | boolean> } = {};
  if (preset !== undefined) patch.preset = preset;
  if (samplers !== undefined) patch.samplers = samplers;
  if (runtime !== undefined) patch.runtime = runtime;
  return patch;
}

export function routeForModelStatus(manager: ModelRuntime): Route {
  return {
    method: 'GET',
    path: '/api/models/status',
    response: ModelStatusResponse,
    handler: async () => {
      try {
        const status = await manager.status();
        return { runtime: status.runtime, models: status.models };
      } catch (error) {
        throw new RouteError('INTERNAL', error instanceof Error ? error.message : 'model status failed');
      }
    }
  };
}

function toRouteError(error: unknown): RouteError {
  if (error instanceof ModelRuntimeError) return new RouteError(error.code, error.message);
  return new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'model operation failed');
}

export function routeForModelStart(manager: ModelRuntime): Route {
  return {
    method: 'POST',
    path: '/api/models/start',
    body: ModelIdRequest,
    response: ModelStartResponse,
    handler: async ({ body }) => {
      const request = body as { id: string };
      try {
        const result = await manager.start(request.id);
        return { id: result.id, status: result.status as 'running' | 'starting', endpoint: result.endpoint };
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}

export function routeForModelStop(manager: ModelRuntime): Route {
  return {
    method: 'POST',
    path: '/api/models/stop',
    body: ModelIdRequest,
    response: ModelStopResponse,
    handler: async ({ body }) => {
      const request = body as { id: string };
      const result = await manager.stop(request.id);
      return { id: result.id, status: result.status as 'stopped' };
    }
  };
}

export function routeForModelIngest(manager: ModelRuntime): Route {
  return {
    method: 'POST',
    path: '/api/models/ingest',
    body: ModelIngestRequest,
    response: ModelIngestResponse,
    handler: async ({ body }) => {
      const request = body as { path: string };
      try {
        return await manager.ingest(request.path);
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}

export function routeForModelReady(manager: ModelRuntime): Route {
  return {
    method: 'GET',
    path: '/api/model/ready',
    query: ModelReadyQuery,
    response: ModelReadyResponse,
    handler: async ({ query }) => {
      try {
        const request = query as { id: string };
        return await manager.isReady(request.id);
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}

export function routeForModelRegister(manager: ModelRuntime): Route {
  return {
    method: 'POST',
    path: '/api/models/register',
    body: ModelRegisterRequest,
    response: ModelRegisterResponse,
    describeOperation: async ({ body }, taskId): Promise<OperationInput> => ({
      workspace: manager.workspace, taskId, kind: 'capability.write', args: { body: registrationBody(manager, body) }
    }),
    handler: async ({ body }) => {
      const request = registrationBody(manager, body) as Parameters<ModelRuntime['register']>[0];
      try {
        return await manager.register(request);
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}

export function routeForModelProfile(manager: ModelRuntime): Route {
  return {
    method: 'POST',
    path: '/api/models/profile',
    body: ModelProfileRequest,
    response: ModelProfileResponse,
    describeOperation: async ({ body }, taskId): Promise<OperationInput> => {
      const { id } = body as ModelProfileRequestT;
      return { workspace: manager.workspace, taskId, kind: 'capability.write', args: { body: { id, patch: profilePatch(body) } } };
    },
    handler: async ({ body }) => {
      const { id } = body as ModelProfileRequestT;
      try {
        return await manager.saveProfile(id, profilePatch(body));
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}