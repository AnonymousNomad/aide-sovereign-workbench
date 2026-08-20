import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = new URL('../browser/dist/', import.meta.url);
const distPath = fileURLToPath(distDir);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (!entry.name.endsWith('.map')) files.push(full);
  }
  return files;
}

function isLocalHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

const callSite = /(?:fetch|WebSocket|EventSource)\s*\(\s*["'](wss?|https?):\/\/([^"'\s/]+)/g;
const wsLiteral = /wss?:\/\/([^"'\s/]+)/g;

const providerHosts = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.mistral.ai',
  'api.groq.com',
  'openrouter.ai'
];

try {
  const files = await walk(distPath);
  if (files.length === 0) {
    console.error('[egress-audit] FAIL: browser/dist is empty — run `npm run build:frontend` first.');
    process.exit(1);
  }
  const problems = [];
  const remoteHosts = new Set();
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const rel = path.relative(distPath, file);
    for (const match of text.matchAll(callSite)) {
      if (!isLocalHost(match[2])) {
        problems.push(`${rel}: remote call-site ${match[1]}://${match[2]} (${match[0].slice(0, 80)})`);
      }
    }
    for (const match of text.matchAll(wsLiteral)) {
      if (!isLocalHost(match[1])) {
        problems.push(`${rel}: literal ws/wss string to ${match[1]} (${match[0].slice(0, 80)})`);
      }
    }
    for (const match of text.matchAll(/https?:\/\/([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)/g)) {
      if (!isLocalHost(match[1])) remoteHosts.add(match[1]);
    }
  }
  if (problems.length > 0) {
    console.error('[egress-audit] FAIL: remote network call-sites found in the built bundle:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  const leakedProviders = [...remoteHosts].filter(host => providerHosts.includes(host));
  if (leakedProviders.length > 0) {
    console.error('[egress-audit] FAIL: provider host URLs leaked into the browser bundle (registry must stay daemon-side):');
    for (const host of leakedProviders) console.error(`  - ${host}`);
    process.exit(1);
  }
  console.log(`[egress-audit] PASS: no remote fetch/WebSocket/EventSource call-sites or ws/wss literals in ${files.length} files.`);
  if (remoteHosts.size > 0) {
    console.log('[egress-audit] INFO: non-localhost URL strings present (monaco doc/license links, NOT call-sites):');
    for (const host of [...remoteHosts].sort()) console.log(`  - ${host}`);
  }
} catch (error) {
  console.error(`[egress-audit] FAIL: ${error.message}`);
  process.exit(1);
}