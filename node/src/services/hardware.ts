import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface HardwareInfo {
  totalRamBytes: number;
  freeRamBytes: number;
  logicalCpus: number;
  vramBytes: number;
  vramSource: 'nvidia-smi' | 'none';
}

let cached: HardwareInfo | null = null;
let cachedAt = 0;
const CACHE_MS = 30_000;

export async function probeHardware(): Promise<HardwareInfo> {
  if (cached !== null && Date.now() - cachedAt < CACHE_MS) return cached;
  const info: HardwareInfo = {
    totalRamBytes: os.totalmem(),
    freeRamBytes: os.freemem(),
    logicalCpus: os.cpus().length,
    vramBytes: 0,
    vramSource: 'none'
  };
  if (process.platform === 'win32') {
    try {
      const { stdout } = await run('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], { timeout: 5000, windowsHide: true });
      const mib = Number(String(stdout).trim().split('\n')[0]);
      if (Number.isFinite(mib) && mib > 0) {
        info.vramBytes = Math.round(mib * 1024 * 1024);
        info.vramSource = 'nvidia-smi';
      }
    } catch {
      // no NVIDIA GPU or nvidia-smi unavailable — CPU-only profile
    }
  }
  cached = info;
  cachedAt = Date.now();
  return info;
}

export function clearHardwareCache(): void {
  cached = null;
  cachedAt = 0;
}