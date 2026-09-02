// scripts/_diag-file-encodings.mjs (cline/T4, 2026-09-01) - one-off diagnostic
import { promises as fs } from 'node:fs';
const paths = [
  'node/src/services/worktree.mjs',
  'node/src/services/agent-loop.mjs',
  'harness/micro-experts.mjs',
  'harness/expert-featurizers.mjs',
  'scripts/train-first-experts.mjs',
  'scripts/capture-night-shift-evidence.mjs'
];
for (const p of paths) {
  try {
    const s = await fs.readFile(p, 'utf8');
    const cr = (s.match(/\r/g) || []).length;
    const lf = (s.match(/\n/g) || []).length;
    const crlf = (s.match(/\r\n/g) || []).length;
    const bareCR = cr - crlf;
    const bom = s.charCodeAt(0) === 0xFEFF;
    console.log(p, 'len=' + s.length, 'bom=' + bom, 'crlf=' + crlf, 'bareCR=' + bareCR, 'first=' + JSON.stringify(s.slice(0, 20)));
  } catch (e) { console.log(p, 'ERR', e.message); }
}
