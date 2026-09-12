import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentStreamEvent } from '../../common/contracts/agent.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = relative => fs.readFile(path.join(root, relative), 'utf8');
const exists = relative => fs.access(path.join(root, relative)).then(() => true, () => false);
const registry = JSON.parse(await read('skills/registry.json'));
const missingSkills = [];
for (const skill of registry.skills) if (!await exists(skill.path)) missingSkills.push(skill.path);
const openapi = JSON.parse(await read('common/openapi.json'));
const operations = Object.values(openapi.paths).flatMap(item => Object.keys(item).filter(method => ['get', 'post', 'put', 'delete', 'patch'].includes(method)));
const probe = JSON.parse(await read('docs/phase0/evidence/runtime-probe-extended.json'));
const sample = { event: 'verification', session_id: 'audit', outcome: 'done', passed: true, status: 'verified', score: 1, threshold: 0.9, failed_checks: [], evidence_file: 'audit.verification.json' };
const emittedShape = AgentStreamEvent.safeParse(sample);
const report = {
  date: new Date().toISOString(),
  registry: { declared: registry.count, actual: registry.skills.length, missingPaths: missingSkills },
  openapi: { paths: Object.keys(openapi.paths).length, operations: operations.length },
  routeCounts: probe.routeCounts,
  facadeLegacyFamilies: Object.entries(probe.routeInventory.filter(r => r.target === 'legacy').reduce((acc, row) => { const family = row.path.split('/').slice(0, 3).join('/'); acc[family] = (acc[family] ?? 0) + 1; return acc; }, {})),
  verificationEvent: { schemaAcceptsActualEmitterShape: emittedShape.success, error: emittedShape.success ? null : emittedShape.error.issues },
  evidenceLogContainsEventRejection: (await fs.readFile(path.join(probe.cleanup.fixtureRetained, 'audit.log'), 'utf8')).includes('event payload violates the contract'),
  frontend: { rootLoadsAppJs: (await read('index.html')).includes('src="app.js"'), viteDirect4778: (await read('browser/vite.config.ts')).includes('127.0.0.1:4778'), desktopStagesLegacy: (await read('desktop/prepare.mjs')).includes("['index.html', 'app.js', 'styles.css']") },
  archive: { fullBattery: 'Historical journal 405/405 before hardware slice; not rerun in Phase 0', hardwareSlice: 'Historical journal 3/3; not a device suitability benchmark' }
};
await fs.writeFile(path.join(here, 'evidence/inventory.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
