#!/usr/bin/env node
// selfheal.mjs (cline/T4, 2026-08-30)
//
// AIDE self-heal: probe the live stack, repair what is dead, report.
// Complements scripts/doctor.mjs (which is static-only: files, JSON,
// binaries). This script probes LIVE services and performs BOUNDED
// repair: at most ONE restart attempt per dead daemon per run.
//
// Probe set: 4173 (ui/vite), 4778 (arch), 4777 (facade), 4779 (legacy),
// optional 8084 (model engine; reported but never restarted here -
// engine restart is owned by scripts/launch-model-engine.cjs).
//
// Usage:
//   node scripts/selfheal.mjs            # probe + repair + report
//   node scripts/selfheal.mjs --probe    # probe + report only (no repair)
//
// Exit codes: 0 = all healthy (or repaired), 1 = something still down.

import net from 'node:net';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = path.join(root, '.aide', 'logs');
const REPAIR = !process.argv.includes('--probe');

const SERVICES = [
  { id: 'arch', port: 4778, cmd: 'node', args: ['node/src/server.ts'], env: { AIDE_ARCH_PORT: '4778' } },
  { id: 'legacy', port: 4779, cmd: 'node', args: ['daemon/server.mjs'], env: { AIDE_DAEMON_PORT: '4779', AIDE_LEGACY_PORT: '4779' } },
  { id: 'facade', port: 4777, cmd: 'node', args: ['scripts/facade.mjs'], env: { AIDE_FACADE_PORT: '4777' } },
  { id: 'ui', port: 4173, cmd: 'node', args: ['node_modules/vite/bin/vite.js', 'preview', '--config', 'browser/vite.config.ts', '--port', '4173', '--host', '127.0.0.1'], env: {} }
];
const ENGINE_PORT = Number(process.env.AIDE_ENGINE_PORT || 8084);

function probePort(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.setTimeout(timeoutMs);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => { s.destroy(); resolve(false); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

async function repair(service) {
  await fs.mkdir(LOG_DIR, { recursive: true });
  const out = await fs.open(path.join(LOG_DIR, `${service.id}-out.log`), 'a');
  const err = await fs.open(path.join(LOG_DIR, `${service.id}-err.log`), 'a');
  const child = spawn(service.cmd, service.args, {
    cwd: root,
    env: { ...process.env, ...service.env, AIDE_WORKSPACE: process.env.AIDE_WORKSPACE || root },
    stdio: ['ignore', out.fd, err.fd],
    detached: true,
    windowsHide: true
  });
  child.unref();
  await out.close().catch(() => {});
  await err.close().catch(() => {});
  return child.pid;
}

const report = { at: new Date().toISOString(), repaired: [], probed: [], engine: null, healthy: false };

for (const svc of SERVICES) {
  let up = await probePort(svc.port);
  const entry = { id: svc.id, port: svc.port, was: up ? 'up' : 'down' };
  if (!up && REPAIR) {
    const pid = await repair(svc);
    entry.repair_pid = pid;
    // give the daemon a moment to bind, then re-probe (arch is slow: allow up to ~20s)
    let recovered = false;
    for (let i = 0; i < 20 && !recovered; i++) {
      await new Promise(r => setTimeout(r, 1000));
      recovered = await probePort(svc.port, 800);
    }
    entry.repaired = recovered;
    up = recovered;
    if (recovered) report.repaired.push(svc.id);
  }
  entry.now = up ? 'up' : 'down';
  report.probed.push(entry);
}

report.engine = { port: ENGINE_PORT, up: await probePort(ENGINE_PORT, 1000) };
report.healthy = report.probed.every(p => p.now === 'up');

console.log(JSON.stringify(report, null, 2));
process.exit(report.healthy ? 0 : 1);
