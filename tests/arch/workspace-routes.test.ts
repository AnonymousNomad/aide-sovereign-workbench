import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-workspace-routes-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;

interface TreeNode {
  name: string;
  path: string;
  kind: string;
  children?: TreeNode[];
}

interface WorkspaceListData {
  workspace: string;
  entries: Array<{ name: string; kind: string }>;
}

interface WorkspaceTreeData {
  workspace: string;
  tree: TreeNode[];
}

before(async () => {
  await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.hidden'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'node_modules', 'pkg'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'lib', 'nested'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'a.txt'), 'alpha\n');
  await fs.writeFile(path.join(workspace, 'zed.txt'), 'omega\n');
  await fs.writeFile(path.join(workspace, 'lib', 'nested', 'deep.ts'), 'export const x = 1;\n');
  await fs.writeFile(path.join(workspace, '.hidden', 'secret.md'), '# nope\n');
  await fs.writeFile(path.join(workspace, 'node_modules', 'pkg', 'index.js'), '// nope\n');
  server = new ArchServer(workspace, path.join(workspace, '.aide', 'workspace-routes.log'));
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

test('GET /api/workspace lists dot-filtered entries with name+kind (parity: build dirs stay listed)', async () => {
  const data = await dataOf<WorkspaceListData>(await fetch(`${base}/api/workspace`));
  assert.equal(data.workspace, workspace);
  const names = data.entries.map(entry => entry.name).sort();
  assert.deepEqual(names, ['a.txt', 'lib', 'node_modules', 'src', 'zed.txt']);
  assert.ok(!names.includes('.hidden'), 'dot entries are filtered by the list route');
  assert.ok(data.entries.every(entry => entry.kind === 'file' || entry.kind === 'directory'));
});

test('GET /api/workspace/tree is parity with legacy - nested posix nodes, dot/build dirs excluded', async () => {
  const data = await dataOf<WorkspaceTreeData>(await fetch(`${base}/api/workspace/tree`));
  assert.equal(data.workspace, workspace);
  const names = data.tree.map(node => node.name);
  assert.deepEqual(names, ['a.txt', 'lib', 'src', 'zed.txt']);

  const lib = data.tree.find(node => node.name === 'lib');
  assert.ok(lib);
  assert.equal(lib.path, 'lib');
  assert.equal(lib.kind, 'directory');
  assert.ok(Array.isArray(lib.children));

  const nested = lib.children!.find(node => node.name === 'nested');
  assert.ok(nested);
  assert.ok(Array.isArray(nested.children));
  const deep = nested.children!.find(node => node.name === 'deep.ts');
  assert.ok(deep);
  assert.equal(deep.kind, 'file');
  assert.equal(deep.path, 'lib/nested/deep.ts');
});