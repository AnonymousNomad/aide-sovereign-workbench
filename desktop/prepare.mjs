import { access, cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(desktop, '..');
const frontend = path.join(desktop, 'frontend');
const resources = path.join(desktop, 'resources');
const includeWeights = process.env.AIDE_INCLUDE_MODEL_WEIGHTS === '1';

const frontendDirectories = ['assets', 'skills'];
const resourceDirectories = [
  'common',
  'node',
  'workbenches',
  'community',
  'languages',
  'debuggers',
  'training',
  'academy',
  'blueprint',
  'plugins',
  'tasks',
  'session',
  'artifacts',
  'providers',
  'harness',
  'grammar',
  'daemon'
];
const runtimePackages = ['zod', 'ws', 'typescript', 'typescript-language-server'];
const weightExtensions = new Set(['.gguf', '.safetensors', '.bin']);

async function copyTree(source, target, { allowWeights = false } = {}) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyTree(sourcePath, targetPath, { allowWeights });
      continue;
    }
    if (entry.name.endsWith('.corrupt')) continue;
    if (!allowWeights && weightExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    await cp(sourcePath, targetPath);
  }
}

async function exists(filePath) {
  return await access(filePath).then(() => true).catch(() => false);
}

await rm(frontend, { recursive: true, force: true });
await rm(resources, { recursive: true, force: true });
await mkdir(frontend, { recursive: true });
await mkdir(resources, { recursive: true });
for (const file of ['index.html', 'app.js', 'styles.css']) await cp(path.join(root, file), path.join(frontend, file));
for (const directory of frontendDirectories) await copyTree(path.join(root, directory), path.join(frontend, directory));
const modelSource = path.join(root, 'models');
const modelTarget = path.join(frontend, 'models');
await copyTree(modelSource, modelTarget, { allowWeights: includeWeights });
for (const directory of resourceDirectories) await copyTree(path.join(root, directory), path.join(resources, directory));
await mkdir(path.join(resources, 'scripts'), { recursive: true });
await cp(path.join(root, 'scripts', 'facade.mjs'), path.join(resources, 'scripts', 'facade.mjs'));
await cp(path.join(desktop, 'stack-launcher.mjs'), path.join(resources, 'stack-launcher.mjs'));
for (const packageName of runtimePackages) {
  await copyTree(path.join(root, 'node_modules', packageName), path.join(resources, 'node_modules', packageName));
}
await mkdir(path.join(resources, 'models'), { recursive: true });
await cp(path.join(modelSource, 'manifest.json'), path.join(resources, 'models', 'manifest.json'));

const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
await mkdir(path.join(resources, 'runtime'), { recursive: true });
await cp(process.execPath, path.join(resources, 'runtime', nodeName));

const llamaName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
const llamaCandidates = [process.env.AIDE_LLAMA_SERVER_BINARY, path.join(root, 'runtime', llamaName)].filter(Boolean);
let llamaSource = null;
for (const candidate of llamaCandidates) {
  if (await exists(candidate)) {
    llamaSource = candidate;
    break;
  }
}
if (llamaSource) {
  await cp(llamaSource, path.join(resources, 'runtime', llamaName));
} else if (process.env.AIDE_REQUIRE_MODEL_RUNTIME === '1') {
  throw new Error(`desktop prepare: ${llamaName} is required; set AIDE_LLAMA_SERVER_BINARY to a verified binary`);
} else {
  console.warn(`desktop prepare: ${llamaName} not staged; release preparation must set AIDE_REQUIRE_MODEL_RUNTIME=1`);
}

console.log(`prepared desktop frontend at ${frontend}`);
console.log(`prepared desktop resources at ${resources}`);
