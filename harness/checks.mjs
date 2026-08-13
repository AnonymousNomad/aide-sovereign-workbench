import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ALLOWED_COMMANDS = Object.freeze({
  compile: ['npm', ['run', 'check']],
  tests: ['npm', ['test']],
  'git-diff': ['git', ['diff', '--check']]
});

function command(name, cwd) {
  const entry = ALLOWED_COMMANDS[name];
  if (!entry) throw new Error(`command is not allowlisted: ${name}`);
  const executable = process.platform === 'win32' && entry[0] === 'npm' ? 'npm.cmd' : entry[0];
  const command = process.platform === 'win32' && executable.endsWith('.cmd') ? (process.env.ComSpec || 'cmd.exe') : executable;
  const args = process.platform === 'win32' && executable.endsWith('.cmd')
    ? ['/d', '/s', '/c', [executable, ...entry[1]].join(' ')]
    : entry[1];
  return new Promise(resolve => {
    execFile(command, args, { cwd, timeout: 120000, maxBuffer: 512 * 1024 }, (error, stdout, stderr) => {
      resolve({
        name,
        passed: !error,
        exit_code: error?.code ?? 0,
        output: `${stdout}${stderr}`.slice(-12000)
      });
    });
  });
}

async function secretScan(workspace) {
  const suspicious = /(hf_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY)/;
  const files = [];
  async function walk(directory, depth = 0) {
    if (depth > 4) return;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target, depth + 1);
      else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs') || entry.name.endsWith('.json') || entry.name.endsWith('.md') || entry.name.endsWith('.html'))) files.push(target);
    }
  }
  await walk(workspace);
  const hits = [];
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    if (suspicious.test(content)) hits.push(path.relative(workspace, file));
  }
  return { name: 'secret-scan', passed: hits.length === 0, hits };
}

async function manifestCheck(workspace) {
  const files = ['models/manifest.json', 'community/node-manifest.json', 'release/package-manifest.json'];
  const errors = [];
  for (const file of files) {
    try { JSON.parse(await fs.readFile(path.join(workspace, file), 'utf8')); }
    catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { name: 'manifest-validation', passed: errors.length === 0, errors };
}

function boundaryCheck(workspace, changedFiles = []) {
  const root = path.resolve(workspace) + path.sep;
  const invalid = changedFiles.filter(file => !path.resolve(workspace, file).startsWith(root));
  return { name: 'path-boundary', passed: invalid.length === 0, invalid };
}

export async function runVeritasChecks({ workspace, changedFiles = [] } = {}) {
  const results = [boundaryCheck(workspace, changedFiles), await secretScan(workspace), await manifestCheck(workspace)];
  for (const name of ['compile', 'tests', 'git-diff']) results.push(await command(name, workspace));
  return {
    passed: results.every(result => result.passed),
    checks: Object.fromEntries(results.map(result => [result.name, result.passed])),
    results
  };
}
