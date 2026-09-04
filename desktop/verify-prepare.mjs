import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.join(desktop, 'frontend');
const resources = path.join(desktop, 'resources');
const required = [
  path.join(frontend, 'index.html'),
  path.join(frontend, 'app.js'),
  path.join(frontend, 'assets', 'monaco', 'vs', 'loader.js'),
  path.join(frontend, 'skills', 'registry.json'),
  path.join(resources, 'academy', 'courses', 'python-foundations.json'),
  path.join(resources, 'plugins', 'README.md'),
  path.join(resources, 'tasks', 'manifest.json'),
  path.join(resources, 'daemon', 'server.mjs'),
  path.join(resources, 'node', 'src', 'server.ts'),
  path.join(resources, 'common', 'facade-route-map.json'),
  path.join(resources, 'scripts', 'facade.mjs'),
  path.join(resources, 'stack-launcher.mjs'),
  path.join(resources, 'models', 'manifest.json'),
  path.join(resources, 'languages', 'manifest.json'),
  path.join(resources, 'debuggers', 'manifest.json'),
  path.join(resources, 'training', 'manifest.json'),
  path.join(resources, 'plugins', 'presets.json'),
  path.join(resources, 'grammar', 'sr-proposal.gbnf'),
  path.join(resources, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node')
];
const runtimePackages = [
  path.join(resources, 'node_modules', 'zod', 'package.json'),
  path.join(resources, 'node_modules', 'ws', 'package.json'),
  path.join(resources, 'node_modules', 'typescript', 'package.json'),
  path.join(resources, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs')
];

for (const file of [...required, ...runtimePackages]) await access(file);

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(absolute));
    else files.push(absolute);
  }
  return files;
}

const stagedFiles = await collectFiles(path.join(frontend, 'models'));
const modelFiles = stagedFiles.filter(file => file.toLowerCase().endsWith('.gguf'));
const corruptFiles = stagedFiles.filter(file => file.toLowerCase().endsWith('.corrupt'));
if (corruptFiles.length) throw new Error(`desktop preparation staged corrupt model artifacts: ${corruptFiles.join(', ')}`);
if (process.env.AIDE_INCLUDE_MODEL_WEIGHTS === '1') {
  if (!modelFiles.length) throw new Error('weight-inclusive desktop preparation requested but no GGUF files were staged');
} else if (modelFiles.length) {
  throw new Error(`core desktop preparation must not bundle GGUF weights: ${modelFiles.join(', ')}`);
}

const llamaName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
const llamaPath = path.join(resources, 'runtime', llamaName);
const hasLlama = await access(llamaPath).then(() => true).catch(() => false);
if (!hasLlama && process.env.AIDE_REQUIRE_MODEL_RUNTIME === '1') {
  throw new Error(`desktop preparation is missing required model runtime: ${llamaPath}`);
}

console.log(`desktop preparation verified (model runtime: ${hasLlama ? 'staged' : 'not supplied'})`);
