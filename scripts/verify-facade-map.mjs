import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveRouteMap, extractLegacyRoutes } from './build-facade-map.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function verifyFacadeMap() {
  const openapi = JSON.parse(await readFile(path.join(root, 'common', 'openapi.json'), 'utf8'));
  const legacySource = await readFile(path.join(root, 'daemon', 'server.mjs'), 'utf8');
  const legacy = extractLegacyRoutes(legacySource);
  const expected = deriveRouteMap({
    tsRoutes: Object.keys(openapi.paths || {}),
    legacyExactRoutes: legacy.exact,
    legacyPrefixRoutes: legacy.prefixes
  });
  const mapPath = path.join(root, 'common', 'facade-route-map.json');
  const actual = JSON.parse(await readFile(mapPath, 'utf8'));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`facade route map drift detected in ${mapPath}; regenerate with node scripts/build-facade-map.mjs`);
  }
  return {
    tsPaths: Object.keys(openapi.paths || {}).length,
    legacyExact: new Set(legacy.exact).size,
    legacyPrefixes: new Set(legacy.prefixes).size,
    tsPrefixes: Object.keys(actual.prefixes || {}).length,
    exactFlips: Object.keys(actual.exact || {}).length
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyFacadeMap();
  console.log(`facade map verified: ${result.tsPaths} TS paths, ${result.tsPrefixes} TS prefixes, ${result.exactFlips} exact flips`);
}
