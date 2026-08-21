import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { evaluateExecution, renderVeritasReport } from '../harness/veritas.mjs';

const [jsonPath, outPath] = process.argv.slice(2);
if (!jsonPath) {
  console.error('usage: node scripts/veritas-report-from-json.mjs <veritas.json> [output.md]');
  process.exit(2);
}
const raw = readFileSync(jsonPath, 'utf8');
const execution = JSON.parse(raw.slice(Math.max(0, raw.indexOf('{'))));
const taskClass = 'code-change';
const veritas = evaluateExecution({ taskClass, execution });
const report = renderVeritasReport({ taskClass, veritas, execution });
if (outPath) {
  mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  writeFileSync(outPath, `${report}\n`, 'utf8');
  console.log(`wrote ${outPath}`);
} else {
  process.stdout.write(`${report}\n`);
}
