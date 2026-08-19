import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildRoutes, generateOpenApi } from '../../node/src/openapi.ts';

test('openapi.json is up to date (run npm run contracts to regenerate)', async () => {
  const routes = await buildRoutes('E:\\workspace', '0.1.0');
  const generated = JSON.stringify(generateOpenApi(routes, { title: 'AIDE Arch Daemon API', version: '0.1.0' }), null, 2) + '\n';
  const committed = await readFile(new URL('../../common/openapi.json', import.meta.url), 'utf8');
  assert.equal(generated, committed, 'drift detected: regenerate with npm run contracts');
});

test('openapi.json documents every non-raw route with a schema', async () => {
  const routes = await buildRoutes('E:\\workspace', '0.1.0');
  const doc = generateOpenApi(routes, { title: 'AIDE Arch Daemon API', version: '0.1.0' }) as { paths: Record<string, unknown> };
  const documented = new Set(Object.keys(doc.paths));
  for (const route of routes) {
    if (route.raw) continue;
    assert.ok(documented.has(route.path), `route ${route.method} ${route.path} missing from openapi.json`);
    const operation = (doc.paths[route.path] as Record<string, unknown>)[route.method.toLowerCase()];
    assert.ok(operation !== undefined, `method ${route.method} missing for ${route.path}`);
  }
  assert.ok(Object.keys(doc.paths).includes('/api/health'));
  assert.ok(Object.keys(doc.paths).includes('/api/search'));
});