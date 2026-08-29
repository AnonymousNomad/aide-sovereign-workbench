export declare class WorkbenchValidationError extends Error {
  issues: string[];
  constructor(message: string, issues?: string[]);
}

export declare class WorkbenchTrustError extends Error {
  detail: { code: string; server: string };
  constructor(message: string, detail?: { code: string; server: string });
}

export type WorkbenchLogger = {
  info?: (msg: string, meta?: Record<string, unknown>) => void;
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
  error?: (msg: string, meta?: Record<string, unknown>) => void;
};

export declare class WorkbenchManager {
  constructor(options?: {
    workspace?: string;
    logger?: WorkbenchLogger | null;
    egressConsent?: (server: string) => boolean;
  });
  list(): Promise<{ workbenches: Array<Record<string, unknown>> }>;
  get(id: string): Promise<{ workbench: Record<string, unknown> }>;
  install(id: string): Promise<{ workbench: Record<string, unknown> }>;
  setTrust(id: string, server: string, trusted: boolean): Promise<{ workbench: Record<string, unknown> }>;
  uninstall(id: string): Promise<{ removed: string }>;
}