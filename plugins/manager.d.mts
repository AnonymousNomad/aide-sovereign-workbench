export interface PluginPublic {
  id: string;
  name: string;
  version?: string;
  api_version?: string;
  description?: string;
  capabilities?: string[];
  activation_events?: string[];
  contributes?: Record<string, unknown>;
  status?: string;
  entry?: string | null;
  folder?: string;
  trusted: boolean;
  enabled: boolean;
  executable: boolean;
  trust_required: boolean;
  invalid?: string;
}

export interface PluginPreset {
  id: string;
  name: string;
  description?: string;
  capabilities: string[];
  installed: boolean;
}

export declare class PluginManager {
  constructor(options: { pluginsDir: string; statePath: string; presetsPath?: string });
  load(): Promise<PluginPublic[]>;
  list(): PluginPublic[];
  presets(): PluginPreset[];
  scaffold(id: string): Promise<PluginPublic[]>;
  setTrust(id: string, trusted: boolean): Promise<PluginPublic[]>;
  execute(id: string, payload?: unknown): Promise<unknown>;
}