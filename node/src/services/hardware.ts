import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface HardwareInfo {
  totalRamBytes: number;
  freeRamBytes: number;
  logicalCpus: number;
  vramBytes: number;
  freeVramBytes: number;
  vramSource: 'nvidia-smi' | 'none';
}

let cached: HardwareInfo | null = null;
let cachedAt = 0;
const CACHE_MS = 30_000;

export function parseNvidiaSmiMemory(text: string): { totalMib: number; freeMib: number | null } | null {
  const line = text.trim().split('\n')[0]?.trim() ?? '';
  if (line.length === 0) return null;
  const parts = line.split(',').map(part => Number(part.trim()));
  const totalRaw = parts[0] ?? NaN;
  if (!Number.isFinite(totalRaw) || totalRaw <= 0) return null;
  const freeRaw = parts[1] ?? NaN;
  const totalMib = totalRaw;
  const freeMib = Number.isFinite(freeRaw) && freeRaw > 0 ? freeRaw : null;
  return { totalMib, freeMib };
}

export async function probeHardware(): Promise<HardwareInfo> {
  if (cached !== null && Date.now() - cachedAt < CACHE_MS) return cached;
  const info: HardwareInfo = {
    totalRamBytes: os.totalmem(),
    freeRamBytes: os.freemem(),
    logicalCpus: os.cpus().length,
    vramBytes: 0,
    freeVramBytes: 0,
    vramSource: 'none'
  };
  if (process.platform === 'win32') {
    try {
      const { stdout } = await run('nvidia-smi', ['--query-gpu=memory.total,memory.free', '--format=csv,noheader,nounits'], { timeout: 5000, windowsHide: true });
      const parsed = parseNvidiaSmiMemory(String(stdout));
      if (parsed !== null) {
        info.vramBytes = Math.round(parsed.totalMib * 1024 * 1024);
        info.freeVramBytes = parsed.freeMib === null ? 0 : Math.round(parsed.freeMib * 1024 * 1024);
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