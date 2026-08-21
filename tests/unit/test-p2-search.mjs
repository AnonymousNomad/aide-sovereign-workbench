import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fuzzyScore, RgService as SearchService } from '../../node/src/services/rg-service.mjs';

assert.equal(fuzzyScore('app', 'src/app.js') !== null, true);
assert.equal(fuzzyScore('saj', 'src/app.js') === null, false, 'subsequence across segments');
assert.equal(fuzzyScore('zzz', 'src/app.js'), null);
const exact = fuzzyScore('app', 'app.ts');
const partial = fuzzyScore('app', 'src/app.ts');
assert.ok(exact > partial, 'start-of-string bonus');
const camel = fuzzyScore('QR', 'useQueryRunner.ts');
assert.ok(camel !== null && camel > 0, 'camelCase humps match');

function fakeRg(lines, exitCode = 0) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr.setEncoding = () => {};
    queueMicrotask(() => {
      for (const line of lines) child.stdout.emit('data', `${line}\n`);
      if (exitCode !== 0) child.stderr.emit('data', lines.at(-1));
      child.emit('exit', exitCode);
    });
    return child;
  };
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-search-'));
await fs.writeFile(path.join(root, 'hello.txt'), 'needle one\n');
await fs.mkdir(path.join(root, 'src'), { recursive: true });
await fs.writeFile(path.join(root, 'src', 'deep.txt'), 'nothing\n');

try {
  const service = new SearchService({ workspace: root });

  const realSpawn = (await import('node:child_process')).spawn;
  const liveService = new SearchService({ workspace: root, spawnChild: realSpawn });
  if (liveService.available()) {
    const listed = await liveService.listFiles();
    const names = listed.files.map(file => file.replace(/\\/g, '/'));
    assert.deepEqual(names.sort(), ['hello.txt', 'src/deep.txt'], 'rg --files must respect the workspace');
  } else {
    console.log('(live ripgrep absent - skipping file-list assertion)');
  }

  const fakeFiles = fakeRg(['hello.txt', 'src\\deep.txt', 'README.md']);
  const lister = new SearchService({ workspace: root, spawnChild: fakeFiles });
  const listed = await lister.listFiles();
  assert.deepEqual(listed.files, ['hello.txt', 'src/deep.txt', 'README.md'], 'backslashes normalized');
  const cached = await lister.listFiles();
  assert.equal(cached.cache_age_ms >= 0, true);

  const quick = await lister.quickOpen('rdm', 10);
  assert.equal(quick.files[0]?.path, 'README.md');

  const jsonMatch = JSON.stringify({ type: 'match', data: { path: { text: 'src\\x.ts' }, lines: { text: 'find me here\r\n' }, line_number: 7, submatches: [{ match: { text: 'me' }, start: 5, end: 7 }] } });
  const jsonBytes = JSON.stringify({ type: 'match', data: { path: { bytes: 'YQ==' }, lines: { bytes: 'Yg==' }, line_number: 2, submatches: [] } });
  const noise = [JSON.stringify({ type: 'begin', data: {} }), JSON.stringify({ type: 'end', data: {} }), JSON.stringify({ type: 'summary', data: {} }), 'not-json-garbage'];
  const searcher = new SearchService({
    workspace: root,
    spawnChild: fakeRg([jsonMatch, ...noise, jsonMatch, jsonBytes])
  });
  const run = await searcher.search({ query: 'me' });
  assert.equal(run.matches.length, 3);
  assert.equal(run.truncated, false);
  assert.equal(run.matches[0].path, 'src/x.ts');
  assert.equal(run.matches[0].line_text, 'find me here');
  assert.deepEqual(run.matches[0].submatches, [{ text: 'me', start: 5, end: 7 }]);
  assert.equal(run.matches[2].path, '<binary>');

  let killedChild = null;
  const floodSearcher = new SearchService({
    workspace: root,
    spawnChild: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdout.setEncoding = () => {};
      child.stderr.setEncoding = () => {};
      child.kill = () => {
        killedChild = true;
        queueMicrotask(() => child.emit('exit', 1));
        return true;
      };
      const line = JSON.stringify({ type: 'match', data: { path: { text: 'f.txt' }, lines: { text: 'x' }, line_number: 1, submatches: [] } });
      queueMicrotask(() => {
        for (let index = 0; index < 500; index += 1) child.stdout.emit('data', `${line}\n`);
      });
      return child;
    }
  });
  const flooded = await floodSearcher.search({ query: 'x', maxResults: 100 });
  assert.equal(flooded.matches.length, 100);
  assert.equal(flooded.truncated, true);
  assert.equal(killedChild, true);

  const badRegex = new SearchService({
    workspace: root,
    spawnChild: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdout.setEncoding = () => {};
      child.stderr.setEncoding = () => {};
      queueMicrotask(() => {
        child.stderr.emit('data', 'regex parse error: unclosed character class\n');
        child.emit('exit', 2);
      });
      return child;
    }
  });
  await badRegex.search({ query: '[unclosed', isRegex: true }).then(
    () => assert.fail('expected rejection'),
    error => assert.match(String(error.message), /rg failed/)
  );

  assert.equal(new SearchService({ workspace: root }).resolveWorkspacePath('../../outside').includes('..'), false);
} finally {
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
}
console.log('P2 search service tests passed');
