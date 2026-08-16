import { spawn } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const testScript = pkg.scripts.test;
const commands = testScript.split('&&').map(part => part.trim()).filter(Boolean);

const results = [];
for (const command of commands) {
  const [bin, ...args] = command.split(/\s+/);
  const outcome = await new Promise(resolve => {
    const child = spawn(bin, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.once('exit', code => resolve(code === 0));
    child.once('error', error => resolve(`${error.message}`));
  });
  results.push({ command, ok: outcome === true, detail: outcome === true ? '' : String(outcome) });
  if (outcome !== true) console.log(`\n[ci-run-all] FAILED: ${command}${typeof outcome === 'string' ? ` (${outcome})` : ''}\n`);
  else console.log(`[ci-run-all] passed: ${command}`);
}

const failed = results.filter(r => !r.ok);
console.log(`\n[ci-run-all] ${results.length - failed.length}/${results.length} test commands passed`);
for (const f of failed) {
  const detail = `${f.command}${f.detail ? ` (${f.detail})` : ''}`;
  console.log(`  FAIL  ${detail}`);
  if (process.env.GITHUB_ACTIONS) {
    const escaped = detail.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::error title=AIDE aggregate failure::${escaped}`);
  }
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '## AIDE aggregate CI results',
    '',
    `- Passed: **${results.length - failed.length}/${results.length}**`,
    `- Failed: **${failed.length}**`,
    '',
    ...results.map(result => `- ${result.ok ? 'PASS' : 'FAIL'} \`${result.command}\`${result.detail ? ` — ${result.detail}` : ''}`),
    ''
  ];
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}
if (failed.length) process.exit(1);
