import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, app, server] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('app.js', 'utf8'),
  readFile('daemon/server.mjs', 'utf8')
]);

assert.match(index, /id="git-stage-all"/);
assert.match(index, /id="git-commit-message"/);
assert.match(index, /id="git-commit"/);
assert.match(app, /async function stageGit\(paths\)/);
assert.match(app, /async function commitGit\(\)/);
assert.match(app, /data-git-diff/);
assert.match(app, /data-git-stage/);
assert.match(app, /#git-stage-all/);
assert.match(app, /#git-commit-message/);
assert.match(server, /function parseGitStatus\(raw\)/);
assert.match(server, /status', '--porcelain=v1', '-z', '--branch'/);
assert.match(server, /request\.url\.startsWith\('\/api\/git\/diff'\)/);

console.log('git UI contract passed');
