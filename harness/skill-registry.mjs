// harness/skill-registry.mjs
// Per skill: aid-skills-auto-load-by-context
// The registry prefers project-local skills, then configured user skills.
// Full skill bodies are loaded only after deterministic task matching.

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_MAX_BYTES = 40000;
const MAX_SKILL_BYTES = 6000;
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Detection table: keyword -> skill directory name.
// Multiple keywords can map to the same skill. Matching is case-insensitive.
const DETECTION_TABLE = [
  { keywords: ['debug', 'breakpoint', 'dap', 'pydevd', 'debugpy', 'lsp', 'language server', 'completion', 'hover', 'diagnostics'], skill: 'aide-arch-protocols' },
  { keywords: ['commit', 'push', 'pr ', 'merge', 'ci ', 'verify', 'green', 'release', 'deploy'], skill: 'aide-release-engineering' },
  { keywords: ['readme', 'license', 'llms.txt', 'badge', 'professional', 'github'], skill: 'github-repo-professional-setup' },
  { keywords: ['shopify', 'theme', 'liquid', 'section', 'app block', 'product page'], skill: 'shopify-capability-engineering' },
  { keywords: ['fine-tune', 'finetune', 'lora', 'qlora', 'training', 'checkpoint', 'sft', 'dpo'], skill: 'cipher-qlora-finetune' },
  { keywords: ['venv', 'pip install', 'python -m', 'py -3.10'], skill: 'aid-venv-care' },
  { keywords: ['process', 'llama-server', 'kill', 'cleanup', 'stray', 'taskkill'], skill: 'process-hygiene-sop' },
  { keywords: ['desktop control', 'mouse', 'keyboard', 'window', 'screenshot', 'screencap'], skill: 'aide-p6-desktop-control' },
  { keywords: ['self-improve', 'closed-loop', 'trajectory', 'retrain', 'selfimprove'], skill: 'aid-closed-loop-self-improvement' },
  { keywords: ['double-check', 'cross-check', 'hand to user', 'evidence'], skill: 'aid-double-check-everything' },
  { keywords: ['windows', 'win32', 'ebusy', 'libuv', 'uv_handle_closing', 'kill on windows'], skill: 'aide-windows-dev-reality' },
  { keywords: ['debugpy', 'fizz_engine', 'dap fixture', 'real debug'], skill: 'aid-dap-real-debugpy-fixture' }
];

function pathInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function skillRoots(workspace, userRoots) {
  const project = path.resolve(workspace || process.cwd());
  const configuredUserRoots = userRoots === undefined
    ? (process.env.AIDE_SKILLS_ROOT ? [process.env.AIDE_SKILLS_ROOT] : [path.join(os.homedir(), '.agents', 'skills')])
    : userRoots;
  return [...new Set([
    path.join(project, 'skills', 'packs'),
    path.join(project, '.agents', 'skills'),
    path.join(project, '.github', 'skills'),
    path.join(project, '.claude', 'skills'),
    path.join(project, '.cursor', 'skills'),
    path.join(project, '.codex', 'skills'),
    ...configuredUserRoots
  ].filter(Boolean).map(root => path.resolve(root)))];
}

function stripFrontmatter(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function truncateUtf8(content, maxBytes) {
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length <= maxBytes) return content;
  return bytes.subarray(0, maxBytes).toString('utf8');
}

function hasValidName(content, expectedName) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content)?.[1] ?? '';
  const declared = /^name:\s*([^\r\n]+)$/mi.exec(header)?.[1]?.trim();
  return declared === undefined || declared === expectedName;
}

export function createSkillRegistry({ workspace = process.cwd(), userRoots } = {}) {
  const roots = skillRoots(workspace, userRoots);
  const cache = new Map();

  function readSkillFile(skillDir) {
    if (!SKILL_NAME_RE.test(skillDir)) return null;
    for (const root of roots) {
      const skillPath = path.join(root, skillDir, 'SKILL.md');
      if (!pathInside(root, skillPath) || !existsSync(skillPath)) continue;
      if (cache.has(skillPath)) return cache.get(skillPath);
      let raw;
      try {
        raw = readFileSync(skillPath, 'utf8');
      } catch {
        cache.set(skillPath, null);
        return null;
      }
      if (!hasValidName(raw, skillDir)) {
        cache.set(skillPath, null);
        return null;
      }
      let content = stripFrontmatter(raw);
      const marker = `\n\n[... truncated, see ${skillPath} for full content ...]`;
      if (Buffer.byteLength(content, 'utf8') + Buffer.byteLength(marker, 'utf8') > MAX_SKILL_BYTES) {
        content = truncateUtf8(content, Math.max(0, MAX_SKILL_BYTES - Buffer.byteLength(marker, 'utf8'))) + marker;
      }
      const loaded = { content, path: skillPath };
      cache.set(skillPath, loaded);
      return loaded;
    }
    return null;
  }

  function detectSkills(task) {
    if (!task || typeof task !== 'string') return [];
    const lower = task.toLowerCase();
    const matched = [];
    for (const entry of DETECTION_TABLE) {
      if (entry.keywords.some(keyword => lower.includes(keyword))) matched.push(entry.skill);
    }
    return matched;
  }

  function loadSkillsFor(task, context = {}, maxBytes = DEFAULT_MAX_BYTES) {
    void context;
    if (!task || typeof task !== 'string') return '';
    const limit = Math.max(0, Number.isFinite(maxBytes) ? maxBytes : DEFAULT_MAX_BYTES);
    const parts = [];
    let totalBytes = 0;
    for (const skillDir of detectSkills(task)) {
      const loaded = readSkillFile(skillDir);
      if (!loaded) continue;
      const part = `\n\n=== SKILL: ${skillDir} ===\n${loaded.content}`;
      const partBytes = Buffer.byteLength(part, 'utf8');
      if (totalBytes + partBytes > limit) {
        const marker = '\n\n[... additional skills truncated ...]';
        if (totalBytes + Buffer.byteLength(marker, 'utf8') <= limit) parts.push(marker);
        break;
      }
      parts.push(part);
      totalBytes += partBytes;
    }
    return parts.join('');
  }

  return { roots, detectSkills, loadSkillsFor };
}

const defaultRegistry = createSkillRegistry();

export function loadSkillsFor(task, context = {}, maxBytes = DEFAULT_MAX_BYTES) {
  return defaultRegistry.loadSkillsFor(task, context, maxBytes);
}

export function detectSkills(task) {
  return defaultRegistry.detectSkills(task);
}

// Self-test when run directly: node harness/skill-registry.mjs "debug Python"
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const task = process.argv[2] || 'debug this Python script with breakpoints';
  console.log('Task:', task);
  console.log('Detected skills:', detectSkills(task));
  const loaded = loadSkillsFor(task);
  console.log('Loaded bytes:', Buffer.byteLength(loaded, 'utf8'));
  console.log('First 200 chars:', loaded.substring(0, 200));
}
