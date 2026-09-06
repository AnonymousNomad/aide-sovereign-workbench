// harness/orchestrator.d.mts
// Type declaration for harness/orchestrator.mjs. Mirrors the chassis v1 contract.
export interface RoutingLogEntry {
  stage: 'keyword_match' | 'embedding_cosine' | 'helix_similarity' | 'L0.5_credo' | 'legacy_shim' | 'unknown' | string;
  signal: string;
  score: number;
  threshold: number;
  decision: 'kept' | 'rejected' | 'unknown' | string;
  skill?: string;
  [k: string]: unknown;
}

export interface OrchestratorSkill {
  name: string;
  body: string;
  legacy?: boolean;
  [k: string]: unknown;
}

export interface OrchestratorHelix {
  skipped: boolean;
  bootstrap_visible?: boolean;
  [k: string]: unknown;
}

export interface WorkflowBundle {
  primarySkill: OrchestratorSkill;
  sopNames: string[];
  rationale: string;
  routingLog: RoutingLogEntry[];
  helix: OrchestratorHelix;
  [k: string]: unknown;
}

export interface Orchestrator {
  classify(input: string): WorkflowBundle;
}

export function createOrchestrator(options?: { workspace?: string }): Orchestrator;
export const HELIX_CONFIDENCE_THRESHOLD: number;
export const HELIX_MIN_TRAJECTORIES: number;
