import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function familyOf(routePath) {
  const segments = routePath.split('/').filter(Boolean);
  return '/' + segments.slice(0, 2).join('/');
}

const FLIPS = {
  exact: {
    '/api/file': 'ts',
    '/api/file/write': 'ts'
  }
};

export function deriveRouteMap({ tsRoutes, legacyExactRoutes, legacyPrefixRoutes }) {
  const legacyPaths = new Set([...legacyExactRoutes, ...legacyPrefixRoutes]);
  const tsFamilies = new Set(tsRoutes.map(familyOf));
  const legacyFamilies = new Set([...legacyPaths].map(familyOf));
  const prefixes = {};
  for (const family of [...tsFamilies].sort()) {
    if (family === '/') continue;
    const collides = [...legacyPaths].some(p => p === family || p.startsWith(family + '/'));
    if (!collides) prefixes[family] = 'ts';
  }
  const exact = {};
  for (const [route, target] of Object.entries(FLIPS.exact)) {
    if (!tsRoutes.includes(route)) throw new Error(`flip target ${route} is not served by the TS stack`);
    exact[route] = target;
  }
  return { prefixes, exact, upgrades: { '/ws': 'ts' } };
}

export async function main() {
  const openapi = JSON.parse(await readFile(path.join(ROOT, 'common', 'openapi.json'), 'utf8'));
  const tsRoutes = Object.keys(openapi.paths || {});
  const source = await readFile(path.join(ROOT, 'daemon', 'server.mjs'), 'utf8');
  const legacyExactRoutes = [...source.matchAll(/request\.method\s*===\s*'[A-Z]+'\s*&&\s*request\.url(?:\.split\('[^']*'\)\[0\])?\s*===\s*'([^']+)'/g)].map(m => m[1]);
  const legacyPrefixRoutes = [...source.matchAll(/request\.url\.startsWith\('([^']+)'\)/g)].map(m => m[1]);
  if (tsRoutes.length === 0 || (legacyExactRoutes.length + legacyPrefixRoutes.length) < 60) {
    throw new Error(`extraction came up short: ts=${tsRoutes.length} legacy=${legacyExactRoutes.length}+${legacyPrefixRoutes.length}`);
  }
  const routeMap = deriveRouteMap({ tsRoutes, legacyExactRoutes, legacyPrefixRoutes });
  const outPath = path.join(ROOT, 'common', 'facade-route-map.json');
  await writeFile(outPath, JSON.stringify(routeMap, null, 2) + '\n');
  console.log(`ts routes: ${tsRoutes.length}, legacy exact: ${legacyExactRoutes.length}, legacy prefixes: ${legacyPrefixRoutes.length}`);
  console.log(`ts-only families routed to ts (${Object.keys(routeMap.prefixes).length}): ${Object.keys(routeMap.prefixes).join(', ')}`);
  console.log(`written: ${outPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
