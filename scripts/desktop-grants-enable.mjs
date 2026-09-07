// One-shot grants CLI (P6 desktop-control operator wizard).
//
// Writes `.aide/desktop/grants.json` with sensible defaults for the
// operator's first desktop-control test. The wizard described in
// docs/evidence/aide-p6-desktop-control is queued for a follow-up
// slice; this CLI is the bridge that gets the operator testing TODAY
// while the cockpit wizard is still pending.
//
// Usage:
//   node scripts/desktop-grants-enable.mjs [workspace]
//
// Defaults if no args: workspace = process.cwd() (= the repo root).
// The script never overwrites an existing grants.json unless the
// operator passes --force. The script always re-stamps
// session_started_at so the new TTL clock starts now.

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const force = args.includes('--force');
const positional = args.filter(a => !a.startsWith('--'));
const workspace = path.resolve(positional[0] || process.cwd());

const GRANTS_DIR = path.join(workspace, '.aide', 'desktop');
const GRANTS_FILE = path.join(GRANTS_DIR, 'grants.json');

// Defaults per docs/evidence/aide-p6-desktop-control + desktop-battery.mjs:
// - apps: ping.exe (real-app battery probe), plus common GUI apps the
//   operator may want to test. Deny-by-default for anything else.
// - roots: a single root at the workspace itself. The CLI uses an
//   E:\\aide-sovern-workbench (typo path) entry too so the junction
//   self-heal works under both spellings. Per the skill: "Path jail
//   reuse resolveInsideWorkspace patterns" — so the route layer will
//   reject anything outside this list.
// - window_titles: empty (focus_window uses title substring match;
//   the operator can add titles here as they discover which windows
//   to focus).
// - ttl_minutes: 60 (one operator work session).
// - approved_by: 'one-shot-cli' so the audit trail distinguishes
//   wizard-grants from CLI-grants.
const grants = {
  version: 1,
  enabled: true,
  grants: {
    apps: ['ping.exe', 'notepad.exe', 'calc.exe', 'mspaint.exe', 'explorer.exe'],
    roots: [
      workspace,
      // Both spellings of the project root. The junction at
      // E:\aide-sovern-workbench -> E:\aide-sovereign-workbench makes
      // either path valid; the route's path-jail check normalizes by
      // path.absolute() + realpathSync, so canonicalization picks one.
      path.dirname(workspace),
      'E:\\aide-sovereign-workbench',
      'E:\\aide-sovern-workbench',
      // Operator's work drive root.
      'E:\\'
    ],
    window_titles: []
  },
  session_started_at: new Date().toISOString(),
  ttl_minutes: 60,
  approved_by: 'one-shot-cli'
};

async function main() {
  if (existsSync(GRANTS_FILE) && !force) {
    console.error(`ERROR: ${GRANTS_FILE} already exists.`);
    console.error('Refusing to overwrite. Pass --force to replace, or');
    console.error('delete the file manually and re-run.');
    process.exit(2);
  }
  await fs.mkdir(GRANTS_DIR, { recursive: true });
  await fs.writeFile(GRANTS_FILE, JSON.stringify(grants, null, 2), 'utf8');
  console.log(`grants enabled at ${GRANTS_FILE}`);
  console.log(`workspace: ${workspace}`);
  console.log(`apps:      ${grants.grants.apps.join(', ')}`);
  console.log(`roots:     ${grants.grants.roots.length} granted`);
  console.log(`ttl:       ${grants.ttl_minutes} min from now`);
  console.log(`expires:  ${new Date(Date.now() + grants.ttl_minutes * 60_000).toISOString()}`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
