// tests/arch/route-authority-coverage.test.ts
// Permanent Phase 2A invariant: every externally reachable TS route must have
// exactly one deliberate authority disposition:
//   PUBLIC | AUTHORITY_CONTROL | ENROLLED_CENTRAL | ENROLLED_DESCRIPTOR | EXPLICITLY_DISABLED
// There is no accidental sixth state, and overlapping dispositions fail.
//
// MIGRATION WAIVER: during Phase 2A, routes already accepted as
// READY-DESCRIPTOR or ARCHITECTURE-DECISION may be listed here while they await
// enrollment. The waiver is test-only bookkeeping: production never reads it,
// it grants no authority, it must shrink monotonically, and it must be empty
// before Phase 2A acceptance. A route cannot be both waived and dispositioned,
// and a new route cannot silently enter the waiver: the count is pinned and
// every entry must match a real route with zero runtime dispositions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRoutes } from '../../node/src/openapi.ts';
import { httpOperationKind } from '../../common/security/operation-policy.mjs';
import type { Route } from '../../node/src/server.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const PHASE2A_ACCEPTANCE_REQUESTED = false;
const EXPECTED_WAIVER_COUNT = 56;

type WaiverClassification = 'READY-DESCRIPTOR' | 'ARCHITECTURE-DECISION';
interface MigrationWaiverEntry { method: string; path: string; classification: WaiverClassification }

const MIGRATION_WAIVER: MigrationWaiverEntry[] = [
  { method: 'DELETE', path: '/api/byok/key/delete', classification: 'ARCHITECTURE-DECISION' },
  { method: 'DELETE', path: '/api/byok/providers/delete', classification: 'ARCHITECTURE-DECISION' },
  { method: 'GET', path: '/api/modelhub/search', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/byok/test', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/chat', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/chat/stream', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/commands/invoke', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/dap/breakpoints', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/dap/configure', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/dap/continue', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/dap/disconnect', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/dap/launch', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/dap/request', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/dap/scopes', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/dap/stack', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/dap/start', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/dap/step', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/dap/stop', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/dap/variables', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/experts/classify-request', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/experts/diff-risk', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/experts/freeze', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/experts/infer', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/experts/intent', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/experts/thaw', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/handoff/export', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/handoff/import', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/index/reindex', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/lsp/change', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/lsp/close', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/lsp/notify', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/lsp/open', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/lsp/request', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/lsp/start', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/lsp/stop', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/modelhub/download', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/modelhub/downloads/cancel', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/models/import', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/models/ingest', classification: 'ARCHITECTURE-DECISION' },

  { method: 'POST', path: '/api/models/start', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/models/stop', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/providers/connect', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/providers/disconnect', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/providers/import', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/training/datasets/delete', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/training/start', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/training/stop', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/workbench/worktree/create', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/workbench/worktree/discard', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/workbench/worktree/merge', classification: 'READY-DESCRIPTOR' },
  { method: 'POST', path: '/api/workbenches/install', classification: 'ARCHITECTURE-DECISION' },
  { method: 'POST', path: '/api/workbenches/uninstall', classification: 'ARCHITECTURE-DECISION' },
  { method: 'PUT', path: '/api/byok/consent', classification: 'ARCHITECTURE-DECISION' },
  { method: 'PUT', path: '/api/byok/key', classification: 'ARCHITECTURE-DECISION' },
  { method: 'PUT', path: '/api/byok/providers/set', classification: 'ARCHITECTURE-DECISION' },
  { method: 'PUT', path: '/api/byok/routing', classification: 'ARCHITECTURE-DECISION' }
];

interface FacadeMap {
  prefixes?: Record<string, string>;
  exact?: Record<string, string>;
  upgrades?: Record<string, string>;
}

async function loadRouteSources(): Promise<Array<{ file: string; source: string }>> {
  const dir = path.join(repoRoot, 'node', 'src', 'routes');
  const files = (await fs.readdir(dir)).filter(file => file.endsWith('.ts'));
  const sources: Array<{ file: string; source: string }> = [];
  for (const file of files) sources.push({ file: `node/src/routes/${file}`, source: await fs.readFile(path.join(dir, file), 'utf8') });
  return sources;
}

function ownerOf(sources: Array<{ file: string; source: string }>, pathname: string): string {
  for (const { file, source } of sources) {
    if (source.includes(`'${pathname}'`) || source.includes(`"${pathname}"`)) return file;
  }
  return 'node/src/openapi.ts';
}

function facadeExposureOf(facade: FacadeMap, pathname: string): string {
  if (facade.exact?.[pathname]) return `exact:${facade.exact[pathname]}`;
  const prefixes = Object.keys(facade.prefixes ?? {}).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) if (pathname.startsWith(prefix)) return `prefix:${facade.prefixes![prefix]}`;
  if (facade.upgrades?.[pathname]) return `upgrade:${facade.upgrades[pathname]}`;
  return 'direct-only';
}

test('every externally reachable TS route has exactly one deliberate authority disposition', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-route-authority-'));
  try {
    const routes = await buildRoutes(workspace, 'route-authority-coverage');
    const facade = JSON.parse(await fs.readFile(path.join(repoRoot, 'common', 'facade-route-map.json'), 'utf8')) as FacadeMap;
    const sources = await loadRouteSources();

    const problems: string[] = [];
    const rawOwnership: Record<string, number> = { PUBLIC: 0, AUTHORITY_CONTROL: 0, ENROLLED_CENTRAL: 0, ENROLLED_DESCRIPTOR: 0 };
    const finalDispositions: Record<string, number> = { PUBLIC: 0, AUTHORITY_CONTROL: 0, ENROLLED_CENTRAL: 0, ENROLLED_DESCRIPTOR: 0, 'MIGRATION-WAIVED': 0, CONFLICTING: 0, UNCLASSIFIED: 0 };

    const waiverKeys = new Set<string>();
    for (const entry of MIGRATION_WAIVER) {
      const key = `${entry.method} ${entry.path}`;
      if (waiverKeys.has(key)) problems.push(`WAIVER DUPLICATE ${key}`);
      waiverKeys.add(key);
    }

    const describeRoute = (route: Route): string =>
      `route=${route.method} ${route.path} owner=${ownerOf(sources, route.path)} facade=${facadeExposureOf(facade, route.path)} flags=raw:${Boolean(route.raw)},stream:${Boolean(route.stream)}`;

    const realKeys = new Set<string>();
    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      realKeys.add(key);

      const isPublic = route.method === 'GET' && route.path === '/api/health';
      const isControl = Boolean(route.authorityMode);
      const centralKind = httpOperationKind(route.method, route.path);
      const isCentral = centralKind !== null;
      const isDescriptor = Boolean(route.describeOperation);

      const detected: string[] = [];
      if (isPublic) detected.push('PUBLIC');
      if (isControl) detected.push(`AUTHORITY_CONTROL(${route.authorityMode})`);
      if (isCentral) detected.push(`ENROLLED_CENTRAL(${centralKind})`);
      if (isDescriptor) detected.push('ENROLLED_DESCRIPTOR');
      if (isPublic) rawOwnership.PUBLIC = (rawOwnership.PUBLIC ?? 0) + 1;
      if (isControl) rawOwnership.AUTHORITY_CONTROL = (rawOwnership.AUTHORITY_CONTROL ?? 0) + 1;
      if (isCentral) rawOwnership.ENROLLED_CENTRAL = (rawOwnership.ENROLLED_CENTRAL ?? 0) + 1;
      if (isDescriptor) rawOwnership.ENROLLED_DESCRIPTOR = (rawOwnership.ENROLLED_DESCRIPTOR ?? 0) + 1;

      const waived = waiverKeys.has(key);
      if (detected.length > 1) {
        finalDispositions.CONFLICTING = (finalDispositions.CONFLICTING ?? 0) + 1;
        problems.push(`CONFLICTING (exactly one owner required) ${describeRoute(route)} detected=[${detected.join(' + ')}]`);
      } else if (detected.length === 1) {
        if (waived) {
          finalDispositions.CONFLICTING = (finalDispositions.CONFLICTING ?? 0) + 1;
          problems.push(`WAIVED BUT DISPOSED (remove it from the migration waiver) ${describeRoute(route)} disposition=${detected[0]}`);
        } else {
          const primary = detected[0]!.split('(')[0]!;
          finalDispositions[primary] = (finalDispositions[primary] ?? 0) + 1;
        }
      } else if (waived) {
        finalDispositions['MIGRATION-WAIVED'] = (finalDispositions['MIGRATION-WAIVED'] ?? 0) + 1;
      } else {
        finalDispositions.UNCLASSIFIED = (finalDispositions.UNCLASSIFIED ?? 0) + 1;
        problems.push(`UNCLASSIFIED (no authority disposition, not in migration waiver) ${describeRoute(route)} detected=[]`);
      }
    }

    for (const entry of MIGRATION_WAIVER) {
      const key = `${entry.method} ${entry.path}`;
      if (!realKeys.has(key)) problems.push(`WAIVER STALE (no real route) ${key} classification=${entry.classification}`);
    }

    if (MIGRATION_WAIVER.length !== EXPECTED_WAIVER_COUNT) {
      problems.push(`WAIVER COUNT CHANGED expected=${EXPECTED_WAIVER_COUNT} actual=${MIGRATION_WAIVER.length} (update the pinned count deliberately)`);
    }
    if (PHASE2A_ACCEPTANCE_REQUESTED && MIGRATION_WAIVER.length > 0) {
      problems.push(`PHASE2A ACCEPTANCE BLOCKED: migration waiver still holds ${MIGRATION_WAIVER.length} routes`);
    }

    // Raw routes are reachable too (GET /api/openapi.json is excluded from its
    // own generated document but must still carry exactly one disposition).
    for (const route of routes.filter(candidate => candidate.raw)) {
      if (httpOperationKind(route.method, route.path) === null && !route.authorityMode) {
        problems.push(`RAW ROUTE WITHOUT CENTRAL ENROLLMENT ${describeRoute(route)}`);
      }
    }

    // Every facade mapping that sends traffic to the TS surface must have a
    // corresponding accounted route. Upgrades (e.g. /ws) map to the EventHub
    // WebSocket channel, not an HTTP route, and are intentionally not checked.
    const accountedPaths = new Set(routes.map(route => route.path));
    for (const [prefix, mapping] of Object.entries(facade.prefixes ?? {})) {
      if (mapping !== 'ts') continue;
      if (![...accountedPaths].some(candidate => candidate.startsWith(prefix))) {
        problems.push(`FACADE_TS_UNACCOUNTED prefix=${prefix} mappingOwner=${mapping} (no route in the authority surface)`);
      }
    }
    for (const [exactPath, mapping] of Object.entries(facade.exact ?? {})) {
      if (mapping !== 'ts') continue;
      if (!accountedPaths.has(exactPath)) {
        problems.push(`FACADE_TS_UNACCOUNTED exact=${exactPath} mappingOwner=${mapping} (no route in the authority surface)`);
      }
    }

    console.log(JSON.stringify({ routes: routes.length, rawOwnership, finalDispositions, waiver: MIGRATION_WAIVER.length }));
    assert.deepEqual(problems, [], `route authority coverage violations:\n${problems.join('\n')}`);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
