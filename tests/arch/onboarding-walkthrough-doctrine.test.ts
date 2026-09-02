// tests/arch/onboarding-walkthrough-doctrine.test.ts (cline/T4, sleeper-mode 2026-09-01)
// Verifies the aide-onboarding-walkthrough skill exists + has the 5 steps + the
// 13 files-to-touch + the gates. R3 verifier (per hard-rules + aide-ide-research).
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
  'aide-onboarding-walkthrough',
  'SKILL.md'
);

test('aide-onboarding-walkthrough doctrine is loadable + shaped correctly', async () => {
  const skill = await fs.readFile(SKILL_PATH, 'utf8');
  // 1. YAML frontmatter (CRLF-tolerant)
  assert.match(skill, /^---\r?\nname: aide-onboarding-walkthrough\r?\ndescription: /);
  // 2. The 5 step names
  for (const step of ['Welcome', 'Privacy', 'BYOK opt-in', 'Desktop control opt-in', 'System map']) {
    assert.ok(skill.includes(step), 'missing step: ' + step);
  }
  // 3. The 7 vendor sources (R2 ask-dont-circle)
  const urls = [
    'https://docs.cursor.com/welcome',
    'https://code.visualstudio.com/docs/copilot/chat/copilot-chat',
    'https://docs.cline.bot/getting-started/installing-cline',
    'https://docs.codeium.com/windsurf/getting-started',
    'https://docs.anthropic.com/en/docs/claude-code/overview',
    'https://aider.chat/docs/install.html',
    'https://docs.continue.dev/getting-started/overview'
  ];
  for (const url of urls) {
    assert.ok(skill.includes(url), 'missing source citation: ' + url);
  }
  // 4. BYOK step cites Cline + Claude Code copy
  const byokIdx = skill.indexOf('Step 3');
  const desktopIdx = skill.indexOf('Step 4');
  const byokSection = skill.slice(byokIdx, desktopIdx);
  assert.ok(byokSection.includes('bring your own provider key'), 'BYOK step must cite Cline copy');
  assert.ok(byokSection.includes('third-party providers'), 'BYOK step must cite Claude Code copy');
  // 5. Privacy step quotes the credo (offline-first + No-Phone-Home)
  const privacyIdx = skill.indexOf('Step 2');
  const byokIdx2 = skill.indexOf('Step 3');
  const privacySection = skill.slice(privacyIdx, byokIdx2);
  assert.ok(privacySection.includes('offline-first'), 'privacy step must invoke offline-first');
  assert.ok(privacySection.includes('No-Phone-Home'), 'privacy step must cite law #2');
  // 6. The 13 files-to-touch
  const expectedFiles = [
    'common/contracts/onboarding.ts',
    'node/src/services/onboarding.mjs',
    'node/src/routes/onboarding.ts',
    'browser/src/cockpit/walkthrough/Walkthrough.tsx',
    'browser/src/cockpit/walkthrough/steps/Welcome.tsx',
    'browser/src/cockpit/walkthrough/steps/Privacy.tsx',
    'browser/src/cockpit/walkthrough/steps/ByokOptin.tsx',
    'browser/src/cockpit/walkthrough/steps/DesktopOptin.tsx',
    'browser/src/cockpit/walkthrough/steps/SystemMap.tsx',
    'browser/src/cockpit/walkthrough/index.ts',
    'node/src/openapi.ts',
    'common/openapi.json',
    'tests/arch/onboarding-walkthrough-doctrine.test.ts'
  ];
  for (const f of expectedFiles) {
    assert.ok(skill.includes(f), 'missing file in files-to-touch: ' + f);
  }
  // 7. The 6 verification gates
  const gates = [
    'node --check browser/src/cockpit/walkthrough/*.tsx',
    'onboarding-walkthrough-doctrine.test.ts',
    'walkthrough-state-shape.test.ts',
    'npm run contracts',
    'egress-audit.mjs',
    'cold-start the daemon'
  ];
  for (const gate of gates) {
    assert.ok(skill.includes(gate), 'missing gate: ' + gate);
  }
});
