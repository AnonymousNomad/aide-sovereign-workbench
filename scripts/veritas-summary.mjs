import { readFileSync, appendFileSync } from 'node:fs';

const file = process.argv[2];
const data = JSON.parse(readFileSync(file, 'utf8'));
const lines = ['### Veritas gates', ''];
for (const result of data.results ?? []) {
  lines.push(`- ${result.passed ? 'PASS' : 'FAIL'} ${result.name}`);
  if (!result.passed) {
    const raw = result.output ?? [...(result.errors ?? []), ...(result.hits ?? []), ...(result.invalid ?? [])].join('; ');
    const tail = String(raw).slice(-600).replace(/\n/g, ' | ');
    if (tail.trim()) lines.push(`  - tail: ${tail}`);
  }
}
const text = `${lines.join('\n')}\n`;
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
else process.stdout.write(text);
