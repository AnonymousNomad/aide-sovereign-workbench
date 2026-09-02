// scripts/_diag-fix-crlf.mjs (cline/T4, 2026-09-01) - convert CRLF to LF in
// my staged files. ROOT CAUSE of the worktree test + syntax-check failures:
// the editor tool on Windows writes CRLF, and Node's ESM parser chokes on
// `export\r\n` between the keyword and the function name.
import { promises as fs } from 'node:fs';
const targets = [
  'node/src/services/worktree.mjs',
  'scripts/train-first-experts.mjs',
  'scripts/capture-night-shift-evidence.mjs',
  'scripts/_diag-file-encodings.mjs'
];
let totalFixed = 0;
for (const p of targets) {
  const s = await fs.readFile(p, 'utf8');
  const out = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (out !== s) {
    await fs.writeFile(p, out, 'utf8');
    const removed = s.length - out.length;
    console.log('FIXED', p, 'removed', removed, 'CR bytes');
    totalFixed += 1;
  } else {
    console.log('CLEAN', p);
  }
}
console.log('TOTAL FIXED:', totalFixed);
