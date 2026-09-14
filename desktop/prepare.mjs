import { access, cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(desktop, '..');
const resources = path.join(desktop, 'resources');
const frontend = path.join(root, 'browser', 'dist');
const includeWeights = process.env.AIDE_INCLUDE_MODEL_WEIGHTS === '1';
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

if (!(await exists(path.join(frontend, 'index.html')))) {
  throw new Error(`typed frontend build missing at ${frontend}; run npm run build:frontend`);
}

await rm(resources, { recursive: true, force: true });
await mkdir(resources, { recursive: true });
for (const directory of resourceDirectories) await copyTree(path.join(root, directory), path.join(resources, directory));
await mkdir(path.join(resources, 'scripts'), { recursive: true });
await cp(path.join(root, 'scripts', 'facade.mjs'), path.join(resources, 'scripts', 'facade.mjs'));
await cp(path.join(desktop, 'stack-launcher.mjs'), path.join(resources, 'stack-launcher.mjs'));

const nodeModulesTarget = path.join(resources, 'node_modules');
await mkdir(nodeModulesTarget, { recursive: true });
const stagedVersions = [];
for (const packageName of runtimePackages) {
  const source = path.join(root, 'node_modules', packageName);
  if (!(await exists(source))) throw new Error(`desktop stack dependency ${packageName} missing from node_modules; run npm install`);
  await copyTree(source, path.join(nodeModulesTarget, packageName));
  const version = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8')).version;
  stagedVersions.push(`${packageName}@${version}`);
}
console.log(`staged stack dependencies (${stagedVersions.join(', ')})`);

const modelSource = path.join(root, 'models');
const runtimeModelDir = path.join(resources, 'models');
await mkdir(runtimeModelDir, { recursive: true });
await cp(path.join(modelSource, 'manifest.json'), path.join(runtimeModelDir, 'manifest.json'));
const bootstrapModel = 'smollm2-360m-instruct-q8_0.gguf';
if (await exists(path.join(modelSource, bootstrapModel))) {
  await cp(path.join(modelSource, bootstrapModel), path.join(runtimeModelDir, bootstrapModel));
  console.log(`staged bootstrap model ${bootstrapModel}`);
} else if (process.env.AIDE_REQUIRE_MODEL_RUNTIME === '1') {
  throw new Error(`desktop prepare: bootstrap model missing at ${path.join(modelSource, bootstrapModel)}`);
} else {
  console.warn(`desktop prepare: bootstrap model not staged; release preparation must supply ${bootstrapModel}`);
}
if (includeWeights) {
  for (const file of await readdir(modelSource)) {
    if (!file.endsWith('.gguf') || file === bootstrapModel) continue;
    await cp(path.join(modelSource, file), path.join(runtimeModelDir, file));
  }
}

const engineTarget = path.join(resources, 'runtime');
await mkdir(engineTarget, { recursive: true });
const engineSource = process.env.AIDE_ENGINE_SOURCE || 'E:\\llama-cpp';
const engineFiles = await readdir(engineSource).catch(error => {
  if (error.code === 'ENOENT') return [];
  throw error;
});
const serverAllowlist = ['llama-server.exe', 'llama-server', 'llama-server-impl.dll', 'llama.dll', 'llama-common.dll', 'ggml-base.dll', 'ggml.dll', 'ggml-rpc.dll', 'ggml-rpc-server.exe', 'libomp140.x86_64.dll', 'mtmd.dll'];
const isServerRuntimeFile = file => serverAllowlist.includes(file) || /^ggml-cpu-.+\.dll$/.test(file);
for (const file of engineFiles.filter(isServerRuntimeFile)) await cp(path.join(engineSource, file), path.join(engineTarget, file));
const llamaName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
if (!(await exists(path.join(engineTarget, llamaName))) && process.env.AIDE_REQUIRE_MODEL_RUNTIME === '1') {
  throw new Error(`desktop prepare: ${llamaName} is required; set AIDE_ENGINE_SOURCE to a verified llama.cpp build`);
}
await cp(process.execPath, path.join(engineTarget, process.platform === 'win32' ? 'node.exe' : 'node'));

console.log(`canonical typed frontend remains at ${frontend}`);
console.log(`prepared desktop resources at ${resources}`);
