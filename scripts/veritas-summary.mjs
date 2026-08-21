import { readFileSync } from 'node:fs';

const file = process.argv[2];
const data = JSON.parse(readFileSync(file, 'utf8'));
for (const result of data.results ?? []) {
  if (result.passed) continue;
  const raw = result.output ?? [...(result.errors ?? []), ...(result.hits ?? []), ...(result.invalid ?? [])].join('; ');
  const tail = String(raw).slice(-600).replace(/\n/g, ' | ').replace(/%/g, '%25').replace(/\r/g, ' ');
  process.stdout.write(`::error::VERITAS_${result.name}: ${tail}\n`);
}
