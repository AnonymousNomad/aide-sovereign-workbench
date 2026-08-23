import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Syncs the authored skill library (C:\Users\Grey_\.agents\skills) into the
// project as the shippable in-box pack (In-the-Box Law), then generates
// skills/registry.json - the index the cockpit/hub will serve offline.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = process.env.AIDE_SKILLS_SOURCE || 'C:\\Users\\Grey_\\.agents\\skills';
const PACKS_DIR = path.join(root, 'skills', 'packs');
const REGISTRY_PATH = path.join(root, 'skills', 'registry.json');

function categoryFor(name) {
  if (name.startsWith('aide-phase')) return 'phase-legacy';
  if (name.startsWith('aide-arch')) return 'architecture';
  if (name.startsWith('aide-build')) return 'build-series';
  if (name.startsWith('aide-parity')) return 'parity';
  if (name.startsWith('pipeline-phase')) return 'training-pipeline';
  if (name.startsWith('pipeline') || name === 'production-readiness') return 'training-pipeline';
  if (name.startsWith('post-training')) return 'post-training';
  if (name.startsWith('web-builder')) return 'web-builder';
  if (name.startsWith('aide-academy')) return 'academy';
  if (name.startsWith('aide-training')) return 'training-ecosystem';
  if (name.startsWith('aide-cloud')) return 'cloud-handoff';
  if (name.startsWith('aide-')) return 'aide-core';
  if (['hard-rules', 'agent-notes', 'verification-complete', 'verify-first-discipline', 'process-hygiene-sop', 'surgical-precision', 'professional-developer', 'continuous-improvement-sop', 'ask-dont-circle', 'developer-code-and-credo'].includes(name)) return 'discipline';
  return 'general';
}

function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^(name|description):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function main() {
  if (!existsSync(SOURCE_DIR)) {
    console.error(`skill source not found: ${SOURCE_DIR}`);
    process.exit(1);
  }
  cpSync(SOURCE_DIR, PACKS_DIR, { recursive: true });
  const entries = [];
  for (const name of readdirSync(PACKS_DIR)) {
    const dir = path.join(PACKS_DIR, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch { continue; }
    const skillPath = path.join(dir, 'SKILL.md');
    if (!existsSync(skillPath)) continue;
    const meta = parseFrontmatter(readFileSync(skillPath, 'utf8'));
    entries.push({
      name: meta.name || name,
      title: name,
      description: meta.description || '',
      category: categoryFor(name),
      path: path.posix.join('skills', 'packs', name, 'SKILL.md')
    });
  }
  entries.sort((a, b) => a.title.localeCompare(b.title));
  const registry = { generated_at: new Date().toISOString(), count: entries.length, categories: [...new Set(entries.map(e => e.category))].sort(), skills: entries };
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
  console.log(`synced + registered ${entries.length} skills -> ${path.relative(root, REGISTRY_PATH)}`);
}

main();
