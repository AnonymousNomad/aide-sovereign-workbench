// Consolidate existing gate records without reinterpreting a failed run as a pass.
import { readFile, readdir, writeFile } from 'node:fs/promises';
const directory = new URL('./', import.meta.url);
const gates = [];
for (const name of (await readdir(directory)).filter(n => /^phase1a-.*\.json$/.test(n)).sort()) {
  const record = JSON.parse(await readFile(new URL(name, directory), 'utf8'));
  if (!Array.isArray(record.args) || !Object.hasOwn(record, 'code')) continue;
  const output = `${record.stdout ?? ''}\n${record.stderr ?? ''}`;
  const counts = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped']) {
    const match = output.match(new RegExp(`(?:ℹ|#) ${key} (\\d+)`));
    if (match) counts[key] = Number(match[1]);
  }
  gates.push({ file: name, args: record.args, started: record.started, ended: record.ended,
    code: record.code, signal: record.signal, pid: record.pid, counts,
    loggerWriteWarnings: (output.match(/\[logger\] write failed:/g) ?? []).length });
}
const ledger = {
  generatedAt: new Date().toISOString(), phase: '1A', gates,
  environmentOverrides: {
    runs: ['environment-focused', 'architecture-full-final', 'acceptance-p0-final'],
    AIDE_PYTHON: 'E:\\Python310\\python.exe', executionPermission: 'approved outside sandbox',
    scope: 'child environment only; no global configuration or installed packages changed'
  },
  classification: {
    static: 'syntax, diff and approved tracked-file boundary', typecheck: 'node and browser',
    unit: 'tier prompt tests; pure contract and state tests within broader runs',
    integration: 'production routes with scripted provider, real sockets and disk failure injection',
    runtime: 'existing local LSP, debugpy, process and model lifecycle fixtures in architecture battery',
    acceptance: 'acceptance-p0 is a scripted-provider integration journey, not real-model coding acceptance',
    realLocalModelCodingAcceptance: 'NOT RUN; separate future gate'
  },
  notes: [
    'Counts overlap across runs and must not be summed as independent coverage.',
    'First architecture run failed and required manual cleanup of two confirmed test children.',
    'No affirmative requirement-bound code-verification capability is claimed.',
    'No Phase 1B/1C, staging, commit or push authorized/performed.'
  ]
};
await writeFile(new URL('phase1a-ledger.json', directory), JSON.stringify(ledger, null, 2));
console.log(JSON.stringify(gates.map(({ file, code, counts, loggerWriteWarnings }) => ({ file, code, counts, loggerWriteWarnings })), null, 2));
