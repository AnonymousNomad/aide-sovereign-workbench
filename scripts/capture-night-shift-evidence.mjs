// scripts/capture-night-shift-evidence.mjs (cline/T4, 2026-09-01)
// Captures real test/syntax output as evidence files for the night-shift
// audit trail. NEVER fabricates; runs the actual commands and saves the
// actual stdout+stderr. Output: docs/evidence/night-shift-2026-09-01/*.txt
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const OUT = path.join(ROOT, 'docs', 'evidence', 'night-shift-2026-09-01');
await fs.mkdir(OUT, { recursive: true });

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err && err.code ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

const targets = [
  { name: 'expert-serve-wirein', cmd: process.execPath, args: ['--test', 'tests/arch/expert-serve-wirein.test.ts'] },
  { name: 'agent-expert-advisory', cmd: process.execPath, args: ['--test', 'tests/arch/agent-expert-advisory.test.ts'] },
  { name: 'experts-battery', cmd: process.execPath, args: ['scripts/experts-battery.mjs'] },
  { name: 'cipher-state-bus', cmd: process.execPath, args: ['--test', 'tests/arch/cipher-state-bus.test.ts'] },
  { name: 'syntax-checks', cmd: 'cmd', args: ['/c', 'node --check node/src/routes/experts.ts && node --check node/src/routes/agent.ts && node --check common/contracts/agent.ts && node --check common/contracts/workbench.ts && node --check node/src/services/worktree.mjs && node --check scripts/train-first-experts.mjs && node --check harness/expert-featurizers.mjs'] }
];

for (const t of targets) {
  const r = await run(t.cmd, t.args);
  const out = `# ${t.name}\n# cmd: ${t.cmd} ${t.args.join(' ')}\n# exit: ${r.code}\n# at: ${new Date().toISOString()}\n\n--- stdout ---\n${r.stdout}\n\n--- stderr ---\n${r.stderr}\n`;
  await fs.writeFile(path.join(OUT, `${t.name}.txt`), out, 'utf8');
  console.log(`CAPTURED ${t.name} exit=${r.code} stdout=${r.stdout.length}b stderr=${r.stderr.length}b`);
}
console.log(`DONE: ${targets.length} evidence files in ${OUT}`);
