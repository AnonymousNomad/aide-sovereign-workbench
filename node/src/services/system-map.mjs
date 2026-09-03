// node/src/services/system-map.mjs (cline/T4, 2026-09-03)
//
// PR A of aide-system-map. Fan-out service: probes the 8 subsystem
// sources in parallel with a 5s timeout each, returns a snapshot.
// READ-ONLY: never mutates state, never caches. One hung card degrades
// only that card; the other 7 still render (per the skill threat matrix).

import { promises as fs } from 'node:fs';
import path from 'node:path';

const TIMEOUT_MS = 5000;

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + " timeout after " + TIMEOUT_MS + "ms")), TIMEOUT_MS))
  ]);
}

async function probeModelStatus(workspace) {
  // In-house model: read the manifest (no daemon call needed for the map
  // to stay alive even when the engine is down).
  const manifestPath = path.join(workspace, "models", "manifest.json");
  const raw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const entries = Array.isArray(raw.models) ? raw.models : (Array.isArray(raw) ? raw : []);
  const inhouse = entries.find(m => m && (m.inhouse === true || m.role === "inhouse")) || entries[0];
  return {
    state: inhouse ? "live" : "offline",
    detail: inhouse ? (inhouse.name || inhouse.id || "in-house model present") : "no in-house model in manifest",
    doctrine: "aide-cipher-house-model"
  };
}

async function probeWorkbenches(workspace) {
  const dir = path.join(workspace, "workbenches");
  const entries = await fs.readdir(dir);
  const bundles = entries.filter(f => f.endsWith(".json"));
  return {
    state: bundles.length > 0 ? "live" : "offline",
    detail: bundles.length + " workbench bundles: " + bundles.join(", "),
    doctrine: "aide-bundle"
  };
}

async function probeSkills(workspace) {
  const dir = path.join(workspace, "skills", "packs");
  const entries = await fs.readdir(dir);
  return {
    state: "live",
    detail: entries.length + " skill packs installed",
    doctrine: "aide-skill-curation"
  };
}

async function probeAgentLoop(workspace) {
  // Agent loop events: read the events file if present.
  const eventsPath = path.join(workspace, ".aide", "logs", "agent-events.jsonl");
  try {
    const raw = await fs.readFile(eventsPath, "utf8");
    const lines = raw.trim() ? raw.trim().split("\n") : [];
    return {
      state: lines.length > 0 ? "live" : "offline",
      detail: lines.length + " agent events journaled",
      doctrine: "aide-offline-agent-loop"
    };
  } catch {
    return { state: "offline", detail: "no agent events yet", doctrine: "aide-offline-agent-loop" };
  }
}

async function probeMicroExperts(workspace) {
  const dir = path.join(workspace, ".aide", "experts");
  try {
    const entries = await fs.readdir(dir);
    const manifests = entries.filter(f => f.endsWith(".json"));
    return {
      state: manifests.length > 0 ? "live" : "offline",
      detail: manifests.length + " expert manifests registered",
      doctrine: "aide-micro-expert-collective"
    };
  } catch {
    return { state: "offline", detail: "no experts registered yet", doctrine: "aide-micro-expert-collective" };
  }
}

async function probeHelixMemory(workspace) {
  const helixPath = path.join(workspace, ".aide", "memory", "helix.jsonl");
  try {
    const raw = await fs.readFile(helixPath, "utf8");
    const lines = raw.trim() ? raw.trim().split("\n") : [];
    return {
      state: lines.length > 0 ? "live" : "offline",
      detail: lines.length + " helix memory entries (X1 spine / X2 join / X3 retention)",
      doctrine: "aide-helix-memory"
    };
  } catch {
    return { state: "offline", detail: "no helix memory yet", doctrine: "aide-helix-memory" };
  }
}

async function probeVeritasSelfheal(workspace) {
  const credoPath = path.join(workspace, "common", "harness", "credocore.md");
  try {
    await fs.access(credoPath);
    return { state: "live", detail: "credo core present (veritas gates + selfheal probe wired)", doctrine: "aide-veritas-layer" };
  } catch {
    return { state: "offline", detail: "credo core missing", doctrine: "aide-veritas-layer" };
  }
}

async function probeByokDesktop(workspace) {
  const byokPath = path.join(workspace, ".aide", "byok", "providers.json");
  const desktopPath = path.join(workspace, ".aide", "desktop", "grants.json");
  let byok = false, desktop = false;
  try { await fs.access(byokPath); byok = true; } catch { /* not configured */ }
  try { await fs.access(desktopPath); desktop = true; } catch { /* not configured */ }
  const parts = [];
  if (byok) parts.push("BYOK configured");
  if (desktop) parts.push("desktop grants present");
  return {
    state: (byok || desktop) ? "live" : "offline",
    detail: parts.length > 0 ? parts.join("; ") : "BYOK not configured, desktop control disabled (offline-first default)",
    doctrine: "aide-cloud-handoff"
  };
}

const PROBES = {
  inhouse_model: probeModelStatus,
  workbenches: probeWorkbenches,
  skills: probeSkills,
  agent_loop: probeAgentLoop,
  micro_experts: probeMicroExperts,
  helix_memory: probeHelixMemory,
  veritas_selfheal: probeVeritasSelfheal,
  byok_desktop: probeByokDesktop
};

export function createSystemMapService({ workspace }) {
  if (!workspace) throw new Error("workspace is required");

  async function getSnapshot() {
    const ids = Object.keys(PROBES);
    const settled = await Promise.allSettled(
      ids.map(id => withTimeout(PROBES[id](workspace), id))
    );
    const subsystems = ids.map((id, i) => {
      const result = settled[i];
      const base = { id, last_updated: Date.now() };
      if (result.status === "fulfilled") {
        return { ...base, state: result.value.state, detail: result.value.detail, doctrine: result.value.doctrine };
      }
      // One hung/failed probe degrades only that card (per the threat matrix).
      const reason = result.reason && result.reason.message ? result.reason.message : String(result.reason);
      return { ...base, state: "degraded", detail: ("probe failed: " + reason).slice(0, 300), doctrine: "aide-system-map" };
    });
    return { generated_at: Date.now(), subsystems };
  }

  return { getSnapshot };
}
