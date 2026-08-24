export interface OrchEngineInfo {
  id: string;
  name: string;
  status: string;
  backend: string | null;
  quant: string | null;
  contextTokensDeclared: number | null;
  tokPerSecMeasured: number | null;
  benchSource: string | null;
}

export interface OrchHardwareInfo {
  ramFreeMb: number;
  ramTotalMb: number | null;
  vramTotalMb: number | null;
  vramFreeMb: number | null;
  gpuName: string | null;
  source: string;
}

export interface OrchActivityInfo {
  egressEventsTotal: number;
  egressLast24h: number;
  shipsCount: number;
  lastShipAt: string | null;
  reworkCount: number;
}

export interface OrchContext {
  generatedAt: string;
  hardware: OrchHardwareInfo;
  engines: OrchEngineInfo[];
  activity: OrchActivityInfo;
}

export function createOrchService(opts: { workspace: string; runtime: any }): {
  getContext(): Promise<OrchContext>;
}
