import type { HealthResponseT } from '../../../common/contracts/health.ts';
import type { WorkspaceListResponseT } from '../../../common/contracts/workspace.ts';
import type { SessionFileT } from '../../../common/contracts/session.ts';

export type Activity = 'editor' | 'learn' | 'map' | 'exp' | 'run';

export interface AppState {
  booted: boolean;
  activity: Activity;
  health: HealthResponseT | null;
  workspace: WorkspaceListResponseT | null;
  session: SessionFileT;
  error: { code: string; message: string } | null;
}

export const INITIAL_STATE: AppState = {
  booted: false,
  activity: 'editor',
  health: null,
  workspace: null,
  session: { version: 1, tabs: [] },
  error: null
};