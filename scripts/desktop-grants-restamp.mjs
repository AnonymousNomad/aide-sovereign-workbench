// Re-stamp grants CLI (P6 desktop-control session renewal).
//
// The .aide/desktop/grants.json `session_started_at` field drives
// the desktop-control service's TTL check (`activeGrants()` in
// desktop-control.mjs: `ageMin > m.ttl_minutes -> EXPIRED`). After
// the operator's 12-hour TTL from a previous session ends, every
// `act()` call returns `EXPIRED` until the session is renewed.
//
// This CLI preserves the existing apps/roots/window_titles and
// just bumps `session_started_at` to now and re-stamps
// `approved_by` to `one-shot-cli-restamp`. It also adds `ping.exe`
// to the apps allowlist if missing (the desktop-battery uses
// `ping.exe 127.0.0.1 -n 30 -w 1000` as its real-task probe and the
// existing wizard grant may not have it).
//
// Usage:
//   node scripts/desktop-grants-restamp.mjs [workspace]
//   node scripts/desktop-grants-restamp.mjs [workspace] --ttl 720
//   node scripts/desktop-grants-restamp.mjs [workspace] --force-ping   # also add ping.exe

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const forcePing = args.includes('--force-ping');
const ttlIdx = args.indexOf('--ttl');
const ttlMinutes = ttlIdx >= 0 ? Number(args[ttlIdx + 1]) : 720;
const positional = args.filter(a => !a.startsWith('--'));
const workspace = path.resolve(positional[0] || process.cwd());

const GRANTS_FILE = path.join(workspace, '.aide', 'desktop', 'grants.json');

async function main() {
  if (!existsSync(GRANTS_FILE)) {
    console.error(`ERROR: ${GRANTS_FILE} not found.`);
    console.error('Run scripts/desktop-grants-enable.mjs first to seed the manifest,');
    console.error('or create one manually.');
    process.exit(2);
  }
  const raw = await fs.readFile(GRANTS_FILE, 'utf8');
  const grants = JSON.parse(raw);
  if (!grants.enabled) {
    console.error('ERROR: grants file is disabled (enabled=false). Re-enable first.');
    process.exit(2);
  }
  if (!grants.grants || typeof grants.grants !== 'object') {
    console.error('ERROR: grants file is malformed (missing grants object).');
    process.exit(2);
  }
  // Stamps
  grants.session_started_at = new Date().toISOString();
  grants.ttl_minutes = ttlMinutes;
  grants.approved_by = 'one-shot-cli-restamp';
  // Ensure ping.exe is on the allowlist (desktop-battery needs it).
  const apps = Array.isArray(grants.grants.apps) ? grants.grants.apps : [];
  if (!apps.includes('ping.exe') && (forcePing || apps.length > 0)) {
    apps.push('ping.exe');
  }
  grants.grants.apps = apps;
  // Write atomically: tmp + rename.
  const tmp = GRANTS_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(grants, null, 2), 'utf8');
  await fs.rename(tmp, GRANTS_FILE);
  console.log(`session restamped at ${GRANTS_FILE}`);
  console.log(`workspace:      ${workspace}`);
  console.log(`apps:           ${grants.grants.apps.join(', ')}`);
  console.log(`roots:          ${grants.grants.roots.length} granted`);
  console.log(`ttl:            ${grants.ttl_minutes} min from now`);
  console.log(`expires:        ${new Date(Date.now() + grants.ttl_minutes * 60_000).toISOString()}`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
