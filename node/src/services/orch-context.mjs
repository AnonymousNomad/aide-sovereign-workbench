// Orchestrator situation engine — one truth assembled from shipped sources.
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { probeHardware } from './hardware.ts';

const QUANT_RE = /(iq\d[\w]*|q\d[_K](?:_S|_M|_L)?|q\d(?:_0|_1)|f16|bf16|fp16)/i;

function quantFromName(name) {
  const match = QUANT_RE.exec(name || '');
  return match ? match[1].toUpperCase() : null;
}

export function createOrchService({ workspace, runtime }) {
  async function hardware() {
    const probe = await probeHardware();
    return {
      ramFreeMb: Math.round(probe.freeRamBytes / 1048576),
      ramTotalMb: Math.round((probe.totalRamBytes ?? os.totalmem()) / 1048576),
      vramTotalMb: probe.vramBytes ? Math.round(probe.vramBytes / 1048576) : null,
      vramFreeMb: probe.freeVramBytes ? Math.round(probe.freeVramBytes / 1048576) : null,
      gpuName: probe.vramSource === 'nvidia-smi' ? 'discrete GPU' : null,
      source: probe.vramSource
    };
  }

  function engines() {
    return runtime.list().map(entry => {
      const file = entry.file || '';
      const name = path.basename(file || entry.model || entry.id);
      let backend = 'cpu';
      try {
        const profile = JSON.parse(readFileSync(`${file}.profile.json`, 'utf8'));
        if (profile.runtime?.backend) backend = String(profile.runtime.backend).toLowerCase();
        else if (Number.isFinite(profile.runtime?.ngl)) backend = 'gpu-offload';
      } catch { /* no sidecar */ }
      return {
        id: entry.id,
        name: entry.name,
        status: entry.status,
        backend: entry.status === 'running' ? backend : null,
        quant: quantFromName(name),
        contextTokensDeclared: Number(entry.context_tokens) || null,
        tokPerSecMeasured: null,
        benchSource: null
      };
    });
  }

  async function countEgress() {
    try {
      const raw = await fs.readFile(path.join(workspace, '.aide', 'logs', 'egress.log'), 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const cutoff = Date.now() - 24 * 3600 * 1000;
      let last24 = 0;
      for (const line of lines) {
        try { if (Date.parse(JSON.parse(line).at) >= cutoff) last24 += 1; } catch { /* skip malformed */ }
      }
      return { egressEventsTotal: lines.length, egressLast24h: last24 };
    } catch {
      return { egressEventsTotal: 0, egressLast24h: 0 };
    }
  }

  async function ships() {
    try {
      const raw = await fs.readFile(path.join(workspace, '.aide', 'metrics', 'ships.log'), 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      let lastShipAt = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        try { lastShipAt = JSON.parse(lines[i]).at; break; } catch { /* keep scanning */ }
      }
      return { shipsCount: lines.length, lastShipAt };
    } catch {
      return { shipsCount: 0, lastShipAt: null };
    }
  }

  async function getContext() {
    const [hw, egress, shipInfo] = await Promise.all([hardware(), countEgress(), ships()]);
    const activity = { ...egress, ...shipInfo, reworkCount: 0 };
    return {
      generatedAt: new Date().toISOString(),
      hardware: hw,
      engines: engines(),
      activity
    };
  }

  return { getContext };
}
