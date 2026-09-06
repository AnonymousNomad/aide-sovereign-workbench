export type OrchestratorCardMode = 'plan' | 'act';

export type OrchestratorCardService = {
  card(task: string, mode?: OrchestratorCardMode): unknown;
};

export function createOrchestratorCardService(options: { workspace: string }): OrchestratorCardService;
