export interface SettingDescriptor {
  key: string;
  type: string;
  default: unknown;
  scope: string;
  description: string;
}

export declare class SettingsService {
  constructor(options: { workspace: string });
  load(): Promise<Record<string, unknown>>;
  merged(): Record<string, unknown>;
  descriptors(): SettingDescriptor[];
  restrictedReverted(): string[];
  writeUserValues(values: Record<string, unknown>): Promise<Record<string, unknown>>;
}
