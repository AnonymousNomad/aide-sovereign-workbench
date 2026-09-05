import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FLIPS = {
  exact: {
    '/api/file': 'ts',
    '/api/file/write': 'ts',
    '/api/chat': 'legacy'
  },
  // Legacy-only exact routes: routes that exist ONLY in the legacy daemon
  // (not in openapi.json / ts stack). These are merged into the generated
  // route map verbatim and skipped from the ts-stack existence check. Add
  // a route here only when it is wired in daemon/server.mjs and never
  // appears in node/src/openapi.ts. Naming uses /api/agent-loop/* to avoid
  // collision with the TS arch's /api/agent/* subagent dispatch routes.
  legacyOnly: {
    '/api/agent-loop/start': 'legacy',
    '/api/agent-loop/decision': 'legacy',
    '/api/agent-loop/cancel': 'legacy'
  }
};

function pathWithoutQuery(routePath) {
  return routePath.split('?')[0];
}

function legacyHandlesPath(routePath, legacyExactRoutes, legacyPrefixRoutes) {
  if (legacyExactRoutes.includes(routePath)) return true;
  for (const rawPrefix of legacyPrefixRoutes) {
    const prefix = pathWithoutQuery(rawPrefix);
    if (rawPrefix.includes('?')) {
      if (routePath === prefix) return true;
    } else if (routePath === prefix || routePath.startsWith(prefix + '/')) {
      return true;
    }
  }
  return false;
}

function prefixCanOwn(prefix, legacyExactRoutes, legacyPrefixRoutes, unsafeTsPaths) {
  if (legacyExactRoutes.some(route => route === prefix || route.startsWith(prefix + '/'))) return false;
  for (const rawPrefix of legacyPrefixRoutes) {
    const legacyPrefix = pathWithoutQuery(rawPrefix);
    if (rawPrefix.includes('?')) {
      if (legacyPrefix === prefix) return false;
    } else if (
      legacyPrefix === prefix ||
      legacyPrefix.startsWith(prefix + '/') ||
      prefix.startsWith(legacyPrefix + '/')
    ) {
      return false;
    }
  }
  return !unsafeTsPaths.some(route => route === prefix || route.startsWith(prefix + '/'));
}

function safePrefixFor(routePath, legacyExactRoutes, legacyPrefixRoutes, unsafeTsPaths) {
  const segments = routePath.split('/').filter(Boolean);
  for (let length = 2; length <= segments.length; length += 1) {
    const candidate = '/' + segments.slice(0, length).join('/');
    if (prefixCanOwn(candidate, legacyExactRoutes, legacyPrefixRoutes, unsafeTsPaths)) return candidate;
  }
  return routePath;
}

export function extractLegacyRoutes(source) {
  return {
    exact: [...source.matchAll(/request\.method\s*===\s*'([A-Z]+)'\s*&&\s*request\.url(?:\.split\('[^']*'\)\[0\])?\s*===\s*'([^']+)'/g)].map(match => match[2]),
    prefixes: [...source.matchAll(/request\.url\.startsWith\('([^']+)'\)/g)].map(match => match[1])
  };
}

export function deriveRouteMap({ tsRoutes, legacyExactRoutes, legacyPrefixRoutes }) {
  const uniqueTsRoutes = [...new Set(tsRoutes)];
  const unsafeTsPaths = uniqueTsRoutes.filter(route => legacyHandlesPath(route, legacyExactRoutes, legacyPrefixRoutes));
  const prefixes = {};
  for (const route of uniqueTsRoutes.filter(candidate => !unsafeTsPaths.includes(candidate)).sort()) {
    const prefix = safePrefixFor(route, legacyExactRoutes, legacyPrefixRoutes, unsafeTsPaths);
    prefixes[prefix] = 'ts';
  }
  const exact = {};
  for (const [route, target] of Object.entries(FLIPS.exact)) {
    if (!tsRoutes.includes(route)) throw new Error(`flip target ${route} is not served by the TS stack`);
    exact[route] = target;
  }
  // Legacy-only routes bypass the ts-stack existence check.
  for (const [route, target] of Object.entries(FLIPS.legacyOnly || {})) {
    exact[route] = target;
  }
  return { prefixes, exact, upgrades: { '/ws': 'ts' } };
}

export async function main() {
  const openapi = JSON.parse(await readFile(path.join(ROOT, 'common', 'openapi.json'), 'utf8'));
  const tsRoutes = Object.keys(openapi.paths || {});
  const source = await readFile(path.join(ROOT, 'daemon', 'server.mjs'), 'utf8');
  const { exact: legacyExactRoutes, prefixes: legacyPrefixRoutes } = extractLegacyRoutes(source);
  if (tsRoutes.length === 0 || (legacyExactRoutes.length + legacyPrefixRoutes.length) < 60) {
    throw new Error(`extraction came up short: ts=${tsRoutes.length} legacy=${legacyExactRoutes.length}+${legacyPrefixRoutes.length}`);
  }
  const routeMap = deriveRouteMap({ tsRoutes, legacyExactRoutes, legacyPrefixRoutes });
  const outPath = path.join(ROOT, 'common', 'facade-route-map.json');
  await writeFile(outPath, JSON.stringify(routeMap, null, 2) + '\n');
  console.log(`ts routes: ${tsRoutes.length}, legacy exact: ${legacyExactRoutes.length}, legacy prefixes: ${legacyPrefixRoutes.length}`);
  console.log(`TS-owned facade prefixes (${Object.keys(routeMap.prefixes).length}): ${Object.keys(routeMap.prefixes).join(', ')}`);
  console.log(`written: ${outPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
