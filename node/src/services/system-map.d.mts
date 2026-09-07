// node/src/services/system-map.d.mts
//
// Type companion for system-map.mjs. The .mjs service is a real
// implementation (fan-out snapshots of the 8 subsystem probes);
// this file declares its shape to TypeScript so .ts importers
// (e.g. node/src/routes/system-map.ts) can use it without `any`.
//
// Pattern: mirror the export surface 1:1 (see worktree.d.mts).
import type { SystemMapSnapshotT } from '../../common/contracts/system-map.ts';

export declare interface SystemMapService {
  getSnapshot(): Promise<SystemMapSnapshotT>;
}

export declare function createSystemMapService(options: { workspace: string }): SystemMapService;