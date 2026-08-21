import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z, type ZodTypeAny } from 'zod';
import { HealthResponse } from '../../common/contracts/health.ts';
import { WorkspaceListResponse } from '../../common/contracts/workspace.ts';
import { routeForFileRead, routeForFileWrite, routeForSearch, routeForSearchReplace } from './routes/fs.ts';
import { routeForSessionGet, routeForSessionPut } from './routes/session.ts';
import { routeForModelStatus, routeForModelStart, routeForModelStop, routeForModelIngest } from './routes/models.ts';
import { routeForRoutes, routeForRoute, routeForFit } from './routes/routing.ts';
import { routeForChat, routeForChatStream, routeForChatHistory, routeForChatHistorySave } from './routes/chat.ts';
import { ChatStore } from './services/chat-store.ts';
import { routeForLspStatus, routeForLspStart, routeForLspOpen, routeForLspClose, routeForLspChange, routeForLspCompletion, routeForLspHover, routeForLspDefinition, lspDiagnosticsToMarkers } from './routes/lsp.ts';
import {
  routeForDapStatus,
  routeForDapStart,
  routeForDapStop,
  routeForDapLaunch,
  routeForDapBreakpoints,
  routeForDapConfigure,
  routeForDapContinue,
  routeForDapStep,
  routeForDapStack,
  routeForDapScopes,
  routeForDapVariables,
  routeForDapDisconnect
} from './routes/dap.ts';
import { routeForProvidersList, routeForProviderConnect, routeForProviderDisconnect, routeForProviderImport } from './routes/providers.ts';
import { routeForLearnerState, routeForLearnerReviews, routeForLearnerAttempt } from './routes/learner.ts';
import { routeForAcademyHint } from './routes/hint.ts';
import { routeForExerciseNext, routeForExerciseAttempt } from './routes/exercise.ts';
import { routeForDatasetList, routeForDatasetCreate, routeForDatasetAppend, routeForDatasetRead, routeForDatasetDelete } from './routes/dataset.ts';
import { LearnerState } from '../../academy/learner-state.mjs';
import { TutorManager } from '../../academy/tutor-manager.mjs';
import { ExerciseEngine } from '../../academy/exercise-engine.mjs';
import { DatasetStore } from '../../daemon/dataset-store.mjs';
import { ModelRouter } from './services/model-router.ts';
import { ProviderService } from './services/providers.ts';
import { CredentialStore } from './services/credentials.ts';
import { SessionStore } from './services/session-store.ts';
import { WorkspaceService } from './services/workspace.ts';
import { LspManager } from './services/lsp.ts';
import { DapManager, type DapAdapterConfig } from './services/dap.ts';
import { ModelRuntime } from './services/model-runtime.ts';
import type { Logger } from './services/logger.ts';
import type { EventHub } from './events.ts';
import type { Route } from './server.ts';

type SchemaObject = Record<string, unknown>;

export interface BuildRoutesOptions {
  events?: EventHub;
  logger?: Logger;
  lspManager?: LspManager;
  dapManager?: DapManager;
  modelRuntime?: ModelRuntime;
  providerService?: ProviderService;
}

export function lspEntryPath(repoRoot: string): string {
  return path.join(repoRoot, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs');
}

export function createLspManager(repoRoot: string, workspace: string, options: BuildRoutesOptions): LspManager {
  return new LspManager({
    command: lspEntryPath(repoRoot),
    workspace,
    logger: options.logger,
    onDiagnostics: (uri, diagnostics) => {
      options.events?.publish('diagnostics', { uri, markers: lspDiagnosticsToMarkers(diagnostics) });
    },
    onStatusChange: (languageId, status) => {
      options.events?.publish('lsp-status', { languageId, status });
    }
  });
}

export async function dapAdapterConfigs(repoRoot: string): Promise<DapAdapterConfig[]> {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'debuggers', 'manifest.json'), 'utf8')) as {
      adapters?: Array<{ id?: string; name?: string; command?: string; args?: string[]; languages?: string[] }>;
    };
    return (manifest.adapters ?? []).map(adapter => {
      const command = adapter.command ?? '';
      const pathLike = path.isAbsolute(command) || command.includes('/') || command.includes(path.sep);
      return {
        id: adapter.id ?? 'unknown',
        name: adapter.name ?? adapter.id ?? 'unknown',
        command: pathLike ? path.resolve(repoRoot, command) : command,
        args: adapter.args ?? [],
        languages: adapter.languages ?? []
      };
    });
  } catch {
    return [];
  }
}

export async function createDapManager(repoRoot: string, workspace: string, options: BuildRoutesOptions): Promise<DapManager> {
  const adapters = await dapAdapterConfigs(repoRoot);
  return new DapManager({
    workspace,
    adapters,
    logger: options.logger,
    onEvent: (adapterId, event, body) => {
      options.events?.publish('debug', { adapterId, event, body });
    }
  });
}

export async function createModelRuntime(repoRoot: string, workspace: string, options: BuildRoutesOptions): Promise<ModelRuntime> {
  const runtime = new ModelRuntime({
    workspace,
    manifestPath: path.join(repoRoot, 'models', 'manifest.json'),
    ingestedPath: path.join(workspace, '.aide', 'ingested-models.json'),
    modelDir: path.join(repoRoot, 'models'),
    logger: options.logger,
    onStatusChange: (id, status) => {
      const eventStatus = status === 'running' ? 'ready' : status === 'starting' ? 'loading' : status === 'stopped' ? 'stopped' : 'error';
      options.events?.publish('model', { id, status: eventStatus });
    }
  });
  await runtime.load();
  return runtime;
}

export function generateOpenApi(routes: Route[], info: { title: string; version: string }): unknown {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    if (route.raw) continue;
    const method = route.method.toLowerCase();
    const pathItem: Record<string, unknown> = (paths[route.path] ??= {});
    const operation: Record<string, unknown> = {
      responses: {
        '200': {
          description: 'success',
          content: {
            'application/json': {
              schema: z.toJSONSchema(route.response, { target: 'openApi3' }) as SchemaObject
            }
          }
        }
      }
    };
    if (route.query !== undefined) {
      const shape = ((route.query as { shape?: Record<string, ZodTypeAny> }).shape ?? {}) as Record<string, ZodTypeAny>;
      operation.parameters = Object.keys(shape)
        .sort()
        .map(name => ({
          name,
          in: 'query',
          required: shape[name]!.isOptional() === false,
          schema: z.toJSONSchema(shape[name]!, { target: 'openApi3' }) as SchemaObject
        }));
    }
    if (route.body !== undefined) {
      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: z.toJSONSchema(route.body, { target: 'openApi3' }) as SchemaObject
          }
        }
      };
    }
    pathItem[method] = operation;
  }
  const sortedPaths = Object.fromEntries(Object.keys(paths).sort().map(key => [key, paths[key]]));
  return {
    openapi: '3.0.3',
    info,
    paths: sortedPaths
  };
}

export async function buildRoutes(workspace: string, version: string, options: BuildRoutesOptions = {}): Promise<Route[]> {
  const fsService = new WorkspaceService(workspace);
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
  const manager =
    options.lspManager ?? createLspManager(repoRoot, workspace, options);
  const dapManager = options.dapManager ?? (await createDapManager(repoRoot, workspace, options));
  const modelRuntime = options.modelRuntime ?? (await createModelRuntime(repoRoot, workspace, options));
  const chatStore = new ChatStore(workspace);
  const providerService =
    options.providerService ??
    new ProviderService(workspace, {
      credentials: new CredentialStore(workspace),
      logger: options.logger
    });
  const modelRouter = new ModelRouter(modelRuntime, providerService);
  const learnerState = new LearnerState({ statePath: path.join(workspace, '.aide', 'learner-state.json') });
  await learnerState.load();
  const tutorManager = new TutorManager({
    coursesDir: path.join(repoRoot, 'academy', 'courses'),
    progressPath: path.join(workspace, '.aide', 'academy-progress.json'),
    learnerState
  });
  await tutorManager.load();
  const exerciseEngine = new ExerciseEngine({
    exercisesDir: path.join(repoRoot, 'academy', 'exercises'),
    learnerState
  });
  await exerciseEngine.load();
  const datasetStore = new DatasetStore({ rootDir: path.join(workspace, '.aide', 'datasets') });
  await datasetStore.load();
  const core: Route[] = [
    makeHealthRoute(workspace, version),
    makeWorkspaceListRoute(workspace),
    routeForFileRead(fsService),
    routeForFileWrite(fsService),
    routeForSearch(fsService),
    routeForSearchReplace(fsService),
    routeForSessionGet(new SessionStore(workspace)),
    routeForSessionPut(new SessionStore(workspace)),
    routeForModelStatus(modelRuntime),
    routeForModelStart(modelRuntime),
    routeForModelStop(modelRuntime),
    routeForModelIngest(modelRuntime),
    routeForRoutes(modelRouter),
    routeForRoute(modelRouter),
    routeForFit(),
    routeForChat(modelRouter),
    routeForChatStream(modelRouter),
    routeForChatHistory(chatStore),
    routeForChatHistorySave(chatStore),
    routeForProvidersList(providerService),
    routeForProviderConnect(providerService),
    routeForProviderDisconnect(providerService),
    routeForProviderImport(chatStore),
    routeForLearnerState(learnerState),
    routeForLearnerReviews(learnerState),
    routeForLearnerAttempt(learnerState),
    routeForAcademyHint(tutorManager),
    routeForExerciseNext(exerciseEngine),
    routeForExerciseAttempt(exerciseEngine),
    routeForDatasetList(datasetStore),
    routeForDatasetCreate(datasetStore),
    routeForDatasetAppend(datasetStore),
    routeForDatasetRead(datasetStore),
    routeForDatasetDelete(datasetStore),
    routeForLspStatus(manager),
    routeForLspStart(manager),
    routeForLspOpen(manager),
    routeForLspClose(manager),
    routeForLspChange(manager),
    routeForLspCompletion(manager),
    routeForLspHover(manager),
    routeForLspDefinition(manager),
    routeForDapStatus(dapManager),
    routeForDapStart(dapManager),
    routeForDapStop(dapManager),
    routeForDapLaunch(dapManager),
    routeForDapBreakpoints(dapManager),
    routeForDapConfigure(dapManager),
    routeForDapContinue(dapManager),
    routeForDapStep(dapManager),
    routeForDapStack(dapManager),
    routeForDapScopes(dapManager),
    routeForDapVariables(dapManager),
    routeForDapDisconnect(dapManager)
  ];
  const doc = generateOpenApi(core, { title: 'AIDE Arch Daemon API', version });
  return [...core, makeOpenApiRoute(doc)];
}

function makeHealthRoute(workspace: string, version: string): Route {
  return {
    method: 'GET',
    path: '/api/health',
    response: HealthResponse,
    handler: () => ({
      version,
      uptimeMs: Math.round(process.uptime() * 1000),
      workspace: path.resolve(workspace),
      freeMemoryMB: Math.round(os.freemem() / 1048576)
    })
  };
}

function makeWorkspaceListRoute(workspace: string): Route {
  return {
    method: 'GET',
    path: '/api/workspace',
    response: WorkspaceListResponse,
    handler: async () => {
      const entries = await fs.readdir(workspace, { withFileTypes: true });
      return {
        workspace,
        entries: entries
          .filter(entry => !entry.name.startsWith('.'))
          .slice(0, 200)
          .map(entry => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' }))
      };
    }
  };
}

function makeOpenApiRoute(openapi: unknown): Route {
  return {
    method: 'GET',
    path: '/api/openapi.json',
    raw: true,
    response: z.any(),
    handler: () => openapi
  };
}