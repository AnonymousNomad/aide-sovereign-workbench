/**
 * Covert Core v0.1 — hardware capability detection + role-based model
 * recommendation. Slice 1 service (plain ESM).
 *
 * Wraps the existing `hardware.ts` probe and derives device tier + the
 * three Covert roles (planner/coder/reviewer) from the REAL model registry
 * (`models/manifest.json` + files on disk). Never fabricates a recommendation
 * for a model that is not at least published as an optional pack.
 *
 * Tier table (device tiers from the Covert product doctrine):
 *   S  <= 4 GB RAM    (tiny edge: 135M–0.5B)
 *   M  <= 8 GB        (phone/tablet: 0.5B–1.5B)
 *   L  <=16 GB        (laptop: 1.5B–7B)     <- this box: 15.9 GB
 *   XL > 16 GB        (workstation: 7B+)
 */

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeHardware } from './hardware.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const MANIFEST_PATH = path.join(ROOT, 'models', 'manifest.json');

export class HardwareProfileError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function deriveTier(totalRamBytes) {
  const gb = totalRamBytes / 1024 ** 3;
  if (gb <= 4) return 'S';
  if (gb <= 8) return 'M';
  if (gb <= 16) return 'L';
  return 'XL';
}

export function deriveBackend(vramBytes) {
  return vramBytes >= 2 * 1024 ** 3 ? 'vulkan' : 'cpu';
}

function fitFor(fileBytes, totalRamBytes) {
  // Runtime overhead ~30% over weights; COMFORTABLE leaves 1.5GB plus room.
  const required = Math.ceil(fileBytes * 1.3);
  const comfortably = totalRamBytes - required > 1.5 * 1024 ** 3;
  if (required <= totalRamBytes && comfortably) return 'COMFORTABLE';
  if (required <= totalRamBytes) return 'TIGHT';
  return 'OVER';
}

async function loadPacks() {
  try {
    const raw = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
    return Array.isArray(raw?.packs) ? raw.packs : [];
  } catch {
    return [];
  }
}

function modelDirFor(file) {
  // packs list a bare filename under models/; registry entries carry subpaths.
  return path.join(ROOT, 'models', file || '');
}

export async function getDeviceProfile() {
  const hw = await probeHardware();
  return {
    totalRamBytes: hw.totalRamBytes,
    freeRamBytes: hw.freeRamBytes,
    logicalCpus: hw.logicalCpus,
    vramBytes: hw.vramBytes,
    freeVramBytes: hw.freeVramBytes,
    vramSource: hw.vramSource,
    tier: deriveTier(hw.totalRamBytes),
    backend: deriveBackend(hw.vramBytes),
    detectedAt: Date.now()
  };
}

// Canonical role -> pack id preference (deterministic, ordered).
const ROLE_PACK_PREF = {
  planner: ['smollm2-360m-q8'],
  coder: ['qwen-coder-1.5b-q4'],
  reviewer: ['qwen-coder-0.5b-q4']
};

export async function recommendRoles() {
  const hw = await probeHardware();
  const packs = await loadPacks();
  const tier = deriveTier(hw.totalRamBytes);

  const byId = new Map(packs.map(p => [p.id, p]));
  const recommendations = [];

  for (const role of ['planner', 'coder', 'reviewer']) {
    let chosen = null;
    for (const id of ROLE_PACK_PREF[role]) {
      const pack = byId.get(id);
      if (!pack) continue;
      const file = pack.file;
      if (!file) continue;
      const onDisk = existsSync(modelDirFor(file));
      if (!onDisk && chosen) continue; // prefer an installed pack if one exists
      const fileBytes = numberOr(pack.download_bytes_approx, 0);
      chosen = {
        role,
        modelId: pack.id,
        name: pack.name,
        parametersB: Math.round(numberOr(pack.parameters, 0) / 1e9 * 1000) / 1000,
        quant: guessQuant(file),
        fileBytes,
        contextTokens: Math.round(numberOr(pack.context_tokens, 2048)),
        fit: fitFor(fileBytes, hw.totalRamBytes),
        onDisk,
        reason: onDisk
          ? `${pack.role} role — weights on disk (${(fileBytes / 1048576).toFixed(0)} MB), ${
               tier === 'XL' ? 'huge headroom' : tier === 'L' ? 'comfortable on this laptop' : 'fits this device'
            }`
          : `${pack.role} role — pack published; download to install`
      };
    }
    if (!chosen) {
      throw new HardwareProfileError(
        'NOT_FOUND',
        `no published pack covers role ${role}; add one to models/manifest.json`
      );
    }
    recommendations.push(chosen);
  }

  return {
    device: {
      tier,
      backend: deriveBackend(hw.vramBytes),
      totalRamGb: Math.round((hw.totalRamBytes / 1024 ** 3) * 10) / 10,
      logicalCpus: hw.logicalCpus,
      vramMb: Math.round(hw.vramBytes / 1048576)
    },
    recommendations,
    generatedAt: Date.now()
  };
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function guessQuant(file) {
  const m = /(?:-|\.)(q[0-9]_?[k0-9_a-z]*|Q[0-9]_?[K0-9_]*|q8_0|f16|bf16)/i.exec(file || '');
  return m ? m[1].toUpperCase() : 'unknown';
}