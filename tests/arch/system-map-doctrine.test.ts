// tests/arch/system-map-doctrine.test.ts (cline/T4, sleeper-mode 2026-09-01)
// Verifies the aide-system-map skill exists + has the 8 cards + the
// 8 files-to-touch + the gates. R3 verifier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = path.join(
  __dirname,
  '..',
  '..',
  'skills',
  'packs',
  'aide-system-map',
  'SKILL.md'
);

test('aide-system-map doctrine is loadable + shaped correctly', async () => {
  const skill = await fs.readFile(SKILL_PATH, 'utf8');
  // 1. YAML frontmatter (CRLF-tolerant)
  assert.match(skill, /^---\r?\nname: aide-system-map\r?\ndescription: /);
  // 2. The 8 card names
  const cards = [
    'In-house model',
    'Workbenches',
    'Skills',
    'Agent loop',
    'Micro-Experts',
    'DNA-Helix memory',
    'Veritas',
    'BYOK'
  ];
  for (const card of cards) {
    assert.ok(skill.includes(card), 'missing card: ' + card);
  }
  // 3. The 10 source routes the cards read from
  const routes = [
    '/api/models/status',
    '/api/workbenches',
    '/api/skills/count',
    '/api/agent/status',
    '/api/experts/list',
    '/api/memory/status',
    '/api/veritas/status',
    '/api/selfheal/status',
    '/api/byok/status',
    '/api/desktop/status'
  ];
  for (const route of routes) {
    assert.ok(skill.includes(route), 'missing source route: ' + route);
  }
  // 4. Snapshot shape excludes key material (security claim — search whole skill)
  const securityClaim = skill.includes('excludes key material') ||
    skill.includes('no key material') ||
    skill.includes('never includes key material') ||
    skill.includes('key string never appears');
  assert.ok(securityClaim, 'snapshot must explicitly exclude key material');
  // 5. The 8 files-to-touch
  const expectedFiles = [
    'common/contracts/system-map.ts',
    'node/src/services/system-map.mjs',
    'node/src/routes/system-map.ts',
    'node/src/openapi.ts',
    'common/openapi.json',
    'browser/src/cockpit/system-map/SystemMap.tsx',
    'browser/src/cockpit/system-map/cards/*.tsx',
    'browser/src/cockpit/system-map/index.ts'
  ];
  for (const f of expectedFiles) {
    assert.ok(skill.includes(f), 'missing file: ' + f);
  }
  // 6. The 6 verification gates
  const gates = [
    'node --check browser/src/cockpit/system-map/*.tsx',
    'system-map-doctrine.test.ts',
    'system-map-resilience.test.ts',
    'npm run contracts',
    'egress-audit.mjs',
    'navigate to the system map panel'
  ];
  for (const gate of gates) {
    assert.ok(skill.includes(gate), 'missing gate: ' + gate);
  }
  // 7. Read-only doctrine (no writes to .aide/)
  const readOnly = skill.includes('READ-ONLY') ||
    skill.includes('read-only') ||
    skill.includes('never writes');
  assert.ok(readOnly, 'system map must be explicit about being read-only');
});
