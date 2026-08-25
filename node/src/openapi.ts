import { promises as fs } from 'node:fs';
import os from 'node:os';
import { logEgress } from '../../node/src/services/egress-journal.mjs';
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
import { routeForTrainingPresets, routeForTrainingStatus, routeForTrainingStart, routeForTrainingStop, routeForTrainingCheckpoints } from './routes/training.ts';
import { routeForEvalRun, routeForExportCreate, routeForExportsList } from './routes/eval-export.ts';
import { routeForCommandList, routeForCommandInvoke, routeForKeybindingList, routeForKeybindingResolve, routeForSettingsGet, routeForSettingsPut } from './routes/commands.ts';
import { routeForRgQuickOpen, routeForRgFiles, routeForRgSearch } from './routes/rg.ts';
import { routeForEditorOptions } from './routes/editor-options.ts';
import { routesForGit } from './routes/git.ts';
import { routesForTasks } from './routes/tasks.ts';
import { routesForProblems } from './routes/problems.ts';
import { routesForNotifications } from './routes/notifications.ts';
import { NotificationService } from '../../node/src/services/notification-service.mjs';
import { createHubService } from '../../node/src/services/modelhub.mjs';
import { routesForModelHub } from './routes/modelhub.ts';
import { routesForOrch } from './routes/orch.ts';
import { createOrchService } from './services/orch-context.mjs';
import { createAgentTools } from './services/agent-tools.mjs';
import { createCheckpointService } from '../../node/src/services/agent-checkpoints.mjs';
import { createAgentLoop } from '../../node/src/services/agent-loop.mjs';
import { routesForAgent } from './routes/agent.ts';
import { createIndexService } from '../../node/src/services/index-service.mjs';
import { routesForIndex } from './routes/index.ts';
import { createHandoffService } from '../../node/src/services/handoff-service.mjs';
import { routesForHandoff } from './routes/handoff.ts';
import { createSecretStore } from '../../node/src/services/secret-store.mjs';
import { createByokService } from '../../node/src/services/byok-service.mjs';
import { routesForByok } from './routes/byok.ts';
import { LearnerState } from '../../academy/learner-state.mjs';
import { TutorManager } from '../../academy/tutor-manager.mjs';
import { ExerciseEngine } from '../../academy/exercise-engine.mjs';
import { DatasetStore } from '../../daemon/dataset-store.mjs';
import { TrainingRunner } from '../../daemon/training-runner.mjs';
import { EvalExportGate } from '../../daemon/eval-export.mjs';
import { CommandRegistry } from './services/command-registry.mjs';
import { KeybindingService } from './services/keybinding-service.mjs';
import { SettingsService } from './services/settings-service.mjs';
import { RgService } from './services/rg-service.mjs';
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
  agentChatFn?: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  indexEmbedFn?: (texts: string[]) => Promise<number[][]>;
  byokSecretStore?: { setKey(id: string, key: string): void; getKey(id: string): string | null; deleteKey(id: string): boolean; listProviderIds(): string[] };
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
  const trainingRunner = new TrainingRunner({
    workDir: path.join(workspace, '.aide', 'training'),
    onEvent: (_channel, body) => options.events?.publish('training', body)
  });
  const evalExportGate = new EvalExportGate({
    workDir: path.join(workspace, '.aide', 'training'),
    exportsDir: path.join(workspace, '.aide', 'exports')
  });
  await evalExportGate.load();
  const commandRegistry = new CommandRegistry({ onEvent: (_event: string, body: Record<string, unknown>) => options.events?.publish('command', body) });
  const BUILTIN_COMMANDS: Array<{ id: string; title: string; category: string }> = [
    { id: 'aide.commandPalette.show', title: 'Show All Commands', category: 'View' },
    { id: 'aide.quickOpen.show', title: 'Go to File...', category: 'File' },
    { id: 'aide.file.save', title: 'Save File', category: 'File' },
    { id: 'aide.view.closeActive', title: 'Close Active Editor', category: 'View' },
    { id: 'aide.view.toggleSidebar', title: 'Toggle Sidebar Visibility', category: 'View' },
    { id: 'aide.terminal.toggle', title: 'Toggle Terminal', category: 'Terminal' },
    { id: 'aide.view.zoomReset', title: 'Reset Zoom', category: 'View' },
    { id: 'aide.git.status', title: 'Show Git Status', category: 'Git' },
    { id: 'aide.training.status', title: 'Training: Show Status', category: 'AIDE Training' },
    { id: 'aide.academy.nextReview', title: 'Academy: Start Next Review', category: 'AIDE Academy' }
  ];
  for (const command of BUILTIN_COMMANDS) {
    commandRegistry.registerCommand({
      ...command,
      when: 'true',
      enablement: 'true',
      hidden: false,
      handler: () => ({ dispatched: command.id, surface: 'workbench' })
    });
  }
  const keybindingService = new KeybindingService({ workspace });
  await keybindingService.load();
  const settingsService = new SettingsService({ workspace });
  await settingsService.load();
  const rgService = new RgService({ workspace });
  const agentCheckpoints = createCheckpointService({ workspace });
  const agentLoop = createAgentLoop({
    workspace,
    rg: rgService.available() ? rgService : null,
    checkpoints: agentCheckpoints,
    chatFn: options.agentChatFn ?? (async messages => {
      const selection = await modelRouter.routeForRole('chat');
      const result = await modelRouter.chat(selection.modelId, messages.map(message => ({ role: message.role as 'system' | 'user' | 'assistant', content: message.content })), {});
      return result.text;
    }),
    onEvent: event => options.events?.publish('agent', event)
  });
  const indexService = createIndexService({
    workspace,
    embed: options.indexEmbedFn ?? null,
    onEvent: event => options.events?.publish('index', event)
  });
  const handoffService = createHandoffService({ workspace, agentLoop });
  const secretStore = options.byokSecretStore ?? createSecretStore({ secretsPath: path.join(os.homedir(), '.aide', 'secrets.json') });
  const byokService = createByokService({ workspace, secretStore, fetchImpl: null, onEgress: entry => logEgress(workspace, { action: entry.kind, url: `https://${entry.host ?? 'unknown'}/`, provider_id: entry.provider_id, role: entry.role }) });
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
    routeForChat(modelRouter, modelRuntime, workspace),
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
    routeForTrainingPresets(),
    routeForTrainingStatus(trainingRunner),
    routeForTrainingStart(trainingRunner, datasetStore),
    routeForTrainingStop(trainingRunner),
    routeForTrainingCheckpoints(trainingRunner),
    routeForEvalRun(evalExportGate),
    routeForExportCreate(evalExportGate),
    routeForExportsList(evalExportGate),
    routeForCommandList(commandRegistry),
    routeForCommandInvoke(commandRegistry),
    routeForKeybindingList(keybindingService),
    routeForKeybindingResolve(keybindingService),
    routeForSettingsGet(settingsService),
    routeForSettingsPut(settingsService),
    routeForRgQuickOpen(rgService),
    routeForRgFiles(rgService),
    routeForRgSearch(rgService),
    routeForEditorOptions(settingsService),
    ...routesForGit(workspace),
    ...buildNotificationWiredRoutes(workspace, options),
    ...routesForProblems(workspace),
    ...routesForOrch(createOrchService({ workspace: workspace, runtime: modelRuntime })),
    ...routesForAgent(agentLoop, {
      resolveProviderChatFn: role => {
        if (!byokService.getConsent()) throw Object.assign(new Error('BYOK egress consent is disabled'), { code: 'FORBIDDEN' });
        return byokService.resolveChatFn(role);
      },
      dispatchTool: async (name: string, args: Record<string, string>, opts: { sandbox?: string }) => {
        const ALIASES: Record<string, string> = { str_replace_editor: 'replace_in_file', execute_bash: 'run_command', think: '__think' };
        const resolved = ALIASES[name] || name;
        const MUTATING = new Set(['write_file', 'replace_in_file', 'run_command']);
        if (MUTATING.has(resolved) && !args.approved && !opts.sandbox) {
          throw Object.assign(new Error(`tool ${resolved} is mutating and requires approved: true`), { code: 'VALIDATION' });
        }
        let rootForTools = workspace;
        if (opts.sandbox) {
          const sandboxPath = path.join(workspace, '.aide', 'sandboxes', opts.sandbox);
          await fs.mkdir(sandboxPath, { recursive: true });
          rootForTools = sandboxPath;
        }
        const toolSet = createAgentTools({ workspace: rootForTools, rg: rgService }) as any;
        const toolMap = new Map(toolSet.tools.map((t: any) => [t.name as string, t]));
        const tool = (toolMap.get(resolved) as any);
        if (!tool) throw Object.assign(new Error(`unknown tool ${name}`), { code: 'VALIDATION' });
        const result = await tool.execute(args);
        return { ok: result.ok !== false, output: String(result.output || ''), terminal: result.terminal === true };
      }
    }),
    ...routesForIndex(indexService),
    ...routesForHandoff(handoffService),
    ...routesForByok(byokService),
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

function buildNotificationWiredRoutes(workspace: string, options: BuildRoutesOptions): Route[] {
  const notifications = new NotificationService({
    workspace,
    onEvent: body => options.events?.publish('notifications', body)
  });
  void notifications.loadHooks().catch(() => {});
  const hub = createHubService({
    workspace,
    modelsDir: path.join(workspace, 'models'),
    onEvent: event => options.events?.publish('modelhub', event)
  });
  return [
    ...routesForNotifications(notifications),
    ...routesForTasks(workspace, {
      onEvent: body => {
        options.events?.publish('tasks', body);
        notifications.ingestTaskEvent(body as Parameters<NotificationService['ingestTaskEvent']>[0]);
      }
    }),
    ...routesForModelHub(hub as any)
  ];
}

function makeHealthRoute(workspace: string, version: string): Route {  return {
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