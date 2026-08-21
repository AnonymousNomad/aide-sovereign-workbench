import { readFileSync } from 'node:fs';

const file = process.argv[2];
let raw = '';
try {
  raw = readFileSync(file, 'utf8');
} catch (error) {
  process.stdout.write(`::error::VERITAS_READ: ${String(error).slice(0, 200)}\n`);
  process.exit(0);
}
let data;
try {
  data = JSON.parse(raw);
} catch {
  process.stdout.write(`::error::VERITAS_PARSE: ${raw.slice(0, 300).replace(/[%\n\r]/g, ' ')}\n`);
  process.exit(0);
}
const results = Array.isArray(data.results) ? data.results : [];
const map = results.map(result => `${result.name}=${result.passed ? 'PASS' : 'FAIL'}`).join(' ') || 'no-results';
process.stdout.write(`::error::VERITAS_MAP: passed=${data.passed} ${map}\n`);
for (const result of results) {
  if (result.passed) continue;
  const rawOut = result.output ?? [...(result.errors ?? []), ...(result.hits ?? []), ...(result.invalid ?? [])].join('; ');
  const tail = String(rawOut).slice(-600).replace(/\n/g, ' | ').replace(/%/g, '%25').replace(/\r/g, ' ');
  if (tail.trim()) process.stdout.write(`::error::VERITAS_${result.name}: ${tail}\n`);
}
