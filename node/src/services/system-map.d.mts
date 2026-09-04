import type { SystemMapSnapshotT } from '../../../common/contracts/system-map.ts';

export interface SystemMapService {
  getSnapshot(): Promise<SystemMapSnapshotT>;
}

export declare function createSystemMapService(options: { workspace: string }): SystemMapService;
