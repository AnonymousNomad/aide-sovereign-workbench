import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-search-parity-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;

interface SearchHit {
  line: number;
  text: string;
}

interface SearchFileResult {
  path: string;
  hits: SearchHit[];
}

interface SearchData {
  query: string;
  total: number;
  regex: boolean;
  caseInsensitive: boolean;
  wholeWord: boolean;
  fileMask: string;
  results: SearchFileResult[];
}

interface ReplaceData {
  files_changed: number;
  occurrences: number;
}

before(async () => {
  await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'needle.txt'), 'The quick brown fox\njumps over the lazy dog.\nstays here\n');
  await fs.writeFile(path.join(workspace, 'src', 'other.md'), '# TODO item\nquick as can be\n');
  server = new ArchServer(workspace, path.join(workspace, '.aide', 'search-parity.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const routes = await buildRoutes(workspace, 'test', { events: server.events, logger: server.logger });
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.events.close();
  await server.logger.flush();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
});

async function dataOf<T>(response: Response): Promise<T> {
  const body: { ok: boolean; data: T } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  return body.data;
}

test('GET /api/search returns the legacy-compatible response shape', async () => {
  const data = await dataOf<SearchData>(await fetch(`${base}/api/search?q=quick&regex=0&icase=1`));
  assert.deepEqual(Object.keys(data).sort(), ['caseInsensitive', 'fileMask', 'query', 'regex', 'results', 'total', 'wholeWord'].sort());
  assert.equal(data.query, 'quick');
  assert.equal(data.regex, false);
  assert.equal(data.caseInsensitive, true);
  assert.equal(data.wholeWord, false);

  const needle = data.results.find(result => result.path === 'needle.txt');
  assert.ok(needle);
  assert.ok(needle.hits.length >= 1);
  assert.ok(needle.hits.every(hit => Number.isInteger(hit.line) && typeof hit.text === 'string'));

  assert.ok(data.results.some(result => result.path === 'src/other.md'), 'search is workspace-relative with posix paths');

  assert.ok(Object.keys(data).includes('total'));
  assert.equal(data.fileMask, '');
});

test('POST /api/search/replace writes bytes and reports parity counts', async () => {
  const response = await fetch(`${base}/api/search/replace`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'quick', regex: false, icase: true, word: false, replacement: 'slow', approved: true })
  });
  const replaced = await dataOf<ReplaceData>(response);
  assert.deepEqual(replaced, { files_changed: 2, occurrences: 2 });

  const needle = await fs.readFile(path.join(workspace, 'needle.txt'), 'utf8');
  assert.match(needle, /The slow brown fox/, 'replacement bytes must land on disk');
  const other = await fs.readFile(path.join(workspace, 'src', 'other.md'), 'utf8');
  assert.match(other, /slow as can be/);
});

test('GET /api/search rejects an oversized query with a typed error', async () => {
  const longQuery = 'x'.repeat(201);
  const response = await fetch(`${base}/api/search?q=${longQuery}`);
  const body: { ok: boolean; error?: { code: string; message: string } } = await response.json();
  assert.equal(body.ok, false);
  assert.ok(body.error);
  assert.equal(body.error.code, 'BAD_REQUEST');
});