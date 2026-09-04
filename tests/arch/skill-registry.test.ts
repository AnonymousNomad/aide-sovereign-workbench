// tests/arch/skill-registry.test.ts
// Per skill: aid-skills-auto-load-by-context
// Tests the skill-registry.mjs module: detection + loading + bounding.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const registryUrl = pathToFileURL(path.join(repoRoot, 'harness', 'skill-registry.mjs')).href;

const { loadSkillsFor, detectSkills } = await import(registryUrl);

test('detectSkills returns aide-arch-protocols for debug tasks', () => {
  const skills = detectSkills('debug this Python script with breakpoints');
  assert.ok(skills.includes('aide-arch-protocols'), 'expected aide-arch-protocols in ' + JSON.stringify(skills));
});

test('detectSkills returns shopify-capability-engineering for Shopify tasks', () => {
  const skills = detectSkills('write a Shopify theme section');
  assert.ok(skills.includes('shopify-capability-engineering'), 'expected shopify-capability-engineering in ' + JSON.stringify(skills));
});

test('detectSkills returns empty array for unrelated tasks', () => {
  const skills = detectSkills('explain the color blue');
  assert.equal(skills.length, 0, 'expected no skills, got ' + JSON.stringify(skills));
});

test('detectSkills returns multiple skills when multiple keywords match', () => {
  const skills = detectSkills('debug this and commit the fix');
  assert.ok(skills.includes('aide-arch-protocols'), 'expected DAP skill');
  assert.ok(skills.includes('aide-release-engineering'), 'expected release skill');
});

test('loadSkillsFor returns non-empty content for matching tasks', () => {
  const content = loadSkillsFor('debug this Python script with breakpoints');
  assert.ok(content.length > 0, 'expected non-empty content');
  assert.ok(content.includes('SKILL: aide-arch-protocols'), 'expected skill header');
  assert.ok(content.includes('Phase 5'), 'expected actual skill content');
});

test('loadSkillsFor returns empty string for non-matching tasks', () => {
  const content = loadSkillsFor('explain the color blue');
  assert.equal(content, '');
});

test('loadSkillsFor respects maxBytes bound', () => {
  const content = loadSkillsFor('debug and commit this', {}, 1000);
  assert.ok(content.length <= 1100, 'expected content to be bounded near 1000 bytes, got ' + content.length);
});

test('loadSkillsFor handles empty/null/undefined input safely', () => {
  assert.equal(loadSkillsFor(''), '');
  assert.equal(loadSkillsFor(null), '');
  assert.equal(loadSkillsFor(undefined), '');
});
