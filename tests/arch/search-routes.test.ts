import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { ArchServer } from '../../node/src/server.ts';
import { WorkspaceService } from '../../node/src/services/workspace.ts';
import { routeForSearch, routeForSearchReplace } from '../../node/src/routes/fs.ts';
import { Envelope } from '../../common/errors.ts';
import { SearchResponse, SearchReplaceResponse, type SearchResponseT } from '../../common/contracts/search.ts';

let dir: string;
let server: ArchServer;
let httpServer: http.Server;
let base: string;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-search-'));
  await fs.writeFile(path.join(dir, 'a.txt'), 'DONE alpha\nkeep this\nDONE beta\n', 'utf8');
  await fs.writeFile(path.join(dir, 'b.ts'), 'keep from b.ts\n', 'utf8');
  await fs.mkdir(path.join(dir, 'node_modules'));
  await fs.writeFile(path.join(dir, 'node_modules', 'skip.txt'), 'DONE in node_modules\n', 'utf8');
  await fs.mkdir(path.join(dir, '.hidden'));
  await fs.writeFile(path.join(dir, '.hidden', 'skip.txt'), 'DONE hidden\n', 'utf8');
  await fs.writeFile(path.join(dir, 'big.txt'), 'DONE ' + 'x'.repeat(512 * 1024), 'utf8');
  const service = new WorkspaceService(dir);
  server = new ArchServer(dir, path.join(dir, '.aide', 'arch-test.log'));
  server.route(routeForSearch(service)).route(routeForSearchReplace(service));
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await server.logger.flush();
  httpServer.closeAllConnections();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

async function search(query: string): Promise<SearchResponseT> {
  const response = await fetch(`${base}/api/search?q=${encodeURIComponent(query)}`);
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) throw new Error('search failed');
  const payload = SearchResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) throw new Error('search response violates contract');
  return payload.data;
}

test('search finds matches and skips dotfiles and node_modules', async () => {
  const result = await search('DONE');
  assert.equal(result.total, 2);
  assert.deepEqual(result.results.map(r => r.path), ['a.txt']);
  assert.deepEqual(result.results[0]!.hits.map(h => h.line), [1, 3]);
});

test('search skips files above the 512KiB cap', async () => {
  const result = await search('DONE');
  assert.ok(!result.results.some(r => r.path === 'big.txt'));
});

test('search honors whole-word and case flags', async () => {
  const all = await search('done');
  assert.equal(all.caseInsensitive, false);
  assert.equal(all.total, 0);
  const icase = await fetch(`${base}/api/search?q=done&icase=1`);
  const envelope = Envelope.safeParse(await icase.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = SearchResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(payload.data.total, 2);
});

test('search honors glob file masks', async () => {
  const unmasked = await search('keep');
  assert.equal(unmasked.total, 2);
  assert.deepEqual(unmasked.results.map(r => r.path).sort(), ['a.txt', 'b.ts']);
  const txt = await fetch(`${base}/api/search?q=keep&mask=${encodeURIComponent('*.txt')}`);
  const envelope = Envelope.safeParse(await txt.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = SearchResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(payload.data.total, 1);
  assert.deepEqual(payload.data.results.map(r => r.path), ['a.txt']);
  const question = await fetch(`${base}/api/search?q=keep&mask=${encodeURIComponent('*.t?')}`);
  const env2 = Envelope.safeParse(await question.json());
  assert.equal(env2.success, true);
  if (!env2.success || !env2.data.ok) return;
  const payload2 = SearchResponse.safeParse(env2.data.data);
  assert.equal(payload2.success, true);
  if (!payload2.success) return;
  assert.equal(payload2.data.total, 1);
  assert.deepEqual(payload2.data.results.map(r => r.path), ['b.ts']);
});

test('search replace requires approval', async () => {
  const response = await fetch(`${base}/api/search/replace`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'DONE', replacement: 'X', approved: false })
  });
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'FORBIDDEN');
});

test('search replace applies within the workspace only', async () => {
  const response = await fetch(`${base}/api/search/replace`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'DONE', replacement: 'GONE', approved: true })
  });
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = SearchReplaceResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(payload.data.files_changed, 1);
  assert.equal(payload.data.occurrences, 2);
  assert.equal(await fs.readFile(path.join(dir, 'a.txt'), 'utf8'), 'GONE alpha\nkeep this\nGONE beta\n');
  assert.equal(await fs.readFile(path.join(dir, 'node_modules', 'skip.txt'), 'utf8'), 'DONE in node_modules\n');
  assert.equal(await fs.readFile(path.join(dir, '.hidden', 'skip.txt'), 'utf8'), 'DONE hidden\n');
});

test('search replace rejects an invalid regex', async () => {
  const response = await fetch(`${base}/api/search/replace`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '([unclosed', replacement: 'x', approved: true, regex: true })
  });
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'BAD_REQUEST');
});