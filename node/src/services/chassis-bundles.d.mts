// chassis-bundles.d.mts
// Type declaration for harness-bundles.mjs sibling. Mirrors the public
// API exposed by createChassisBundlesService. Used by node/src/openapi.ts
// and node/src/routes/agent.ts (TS7016 fix per failure-typescript-mjs-declaration).

export interface ChassisBundleCard {
  bundle_id: string;
  goal: string;
  mode: 'plan' | 'act';
  primary_skill: {
    name: string;
    version: string;
    category: string;
    shim_used: boolean;
    legacy: boolean;
  };
  sop_names: string[];
  tool_set: string[];
  prompt_budget: { lines: number; bytes: number };
  helix: {
    enabled: boolean;
    skipped: boolean;
    skipped_reason: string | null;
    threshold: number;
    min_trajectories: number;
    matches: number;
    bootstrap_visible: boolean;
  };
  rationale: string;
  routing_log: Array<Record<string, unknown>>;
  scaffold: {
    system: string;
    bytes: number;
    lines: number;
    dropped: string[];
  };
}

export interface ReviewedBundleSummary {
  bundle_id: string;
  reviewed_at?: string;
  goal?: string;
  mode?: string;
  primary_skill?: string;
}

export interface ChassisBundlesService {
  preview(task: string, mode?: 'plan' | 'act'): Promise<ChassisBundleCard>;
  getReviewedBundle(bundleId: string): Promise<ChassisBundleCard | null>;
  listReviewedBundles(): Promise<ReviewedBundleSummary[]>;
}

export function createChassisBundlesService(options: { workspace: string }): ChassisBundlesService;
