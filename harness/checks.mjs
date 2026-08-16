import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const NPM = process.platform === 'win32'
  ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm']]
  : ['npm', []];
const COMMAND_TIMEOUTS = Object.freeze({ compile: 120_000, tests: 300_000, 'git-diff': 120_000 });
const ALLOWED_COMMANDS = Object.freeze({
  compile: [NPM[0], [...NPM[1], 'run', 'check']],
  tests: [NPM[0], [...NPM[1], 'test']],
  'git-diff': ['git', ['diff', '--check']]
});

function command(name, cwd) {
  const entry = ALLOWED_COMMANDS[name];
  if (!entry) throw new Error(`command is not allowlisted: ${name}`);
  return new Promise(resolve => {
    execFile(entry[0], entry[1], { cwd, timeout: COMMAND_TIMEOUTS[name], maxBuffer: 512 * 1024 }, (error, stdout, stderr) => {
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

async function gitDiffCheck(workspace) {
  try {
    await fs.stat(path.join(workspace, '.git'));
  } catch {
    return {
      name: 'git-diff',
      passed: true,
      skipped: true,
      reason: 'workspace is not a Git repository'
    };
  }
  return command('git-diff', workspace);
}

function boundaryCheck(workspace, changedFiles = []) {
  const root = path.resolve(workspace) + path.sep;
  const invalid = changedFiles.filter(file => !path.resolve(workspace, file).startsWith(root));
  return { name: 'path-boundary', passed: invalid.length === 0, invalid };
}

export async function runVeritasChecks({ workspace, changedFiles = [] } = {}) {
  const results = [boundaryCheck(workspace, changedFiles), await secretScan(workspace), await manifestCheck(workspace)];
  for (const name of ['compile', 'tests']) results.push(await command(name, workspace));
  results.push(await gitDiffCheck(workspace));
  return {
    passed: results.every(result => result.passed),
    checks: Object.fromEntries(results.map(result => [result.name, result.passed])),
    results
  };
}
