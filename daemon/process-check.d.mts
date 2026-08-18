export interface ProcessCheckResult {
  alive: boolean;
  code: number | null;
  output: string;
  errorOutput: string;
}

export function checkProcessAlive(
  pid: number,
  options?: {
    platform?: NodeJS.Platform;
    spawnProcess?: (command: string, args: string[], options: unknown) => unknown;
  }
): Promise<ProcessCheckResult>;