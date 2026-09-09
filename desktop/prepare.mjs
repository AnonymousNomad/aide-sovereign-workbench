import { access, cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(desktop, '..');
const frontend = path.join(desktop, 'frontend');
await rm(frontend, { recursive: true, force: true });
await mkdir(frontend, { recursive: true });
for (const file of ['index.html', 'app.js', 'styles.css']) await cp(path.join(root, file), path.join(frontend, file));
for (const directory of ['community', 'languages', 'debuggers', 'training', 'academy', 'blueprint', 'plugins', 'tasks', 'daemon', 'session', 'artifacts', 'providers', 'harness']) await cp(path.join(root, directory), path.join(frontend, directory), { recursive: true });
const modelSource = path.join(root, 'models');
const modelTarget = path.join(frontend, 'models');
await mkdir(modelTarget, { recursive: true });
for (const file of await readdir(modelSource)) {
  if (file.endsWith('.gguf') && process.env.AIDE_INCLUDE_MODEL_WEIGHTS !== '1') continue;
  await cp(path.join(modelSource, file), path.join(modelTarget, file), { recursive: true });
}
await mkdir(path.join(frontend, 'runtime'), { recursive: true });
await cp(process.execPath, path.join(frontend, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'));
console.log(`prepared desktop frontend at ${frontend}`);

const resources = path.join(desktop, 'resources');
await mkdir(resources, { recursive: true });
const engineTarget = path.join(resources, 'runtime');
const runtimeModelDir = path.join(resources, 'models');
await rm(engineTarget, { recursive: true, force: true });
await mkdir(engineTarget, { recursive: true });
await mkdir(runtimeModelDir, { recursive: true });

const engineSource = process.env.AIDE_ENGINE_SOURCE || 'E:\\llama-cpp';
const engineFiles = await readdir(engineSource).catch(async error => {
  if (error.code === 'ENOENT') {
    console.log(`engine source ${engineSource} absent - skipping engine staging (set AIDE_ENGINE_SOURCE to a llama.cpp build dir)`);
    return [];
  }
  throw error;
});
const serverAllowlist = ['llama-server.exe', 'llama-server-impl.dll', 'llama.dll', 'llama-common.dll', 'ggml-base.dll', 'ggml.dll', 'ggml-rpc.dll', 'ggml-rpc-server.exe', 'libomp140.x86_64.dll', 'mtmd.dll'];
const isServerRuntimeFile = file => serverAllowlist.includes(file) || /^ggml-cpu-.+\.dll$/.test(file);
for (const file of engineFiles.filter(isServerRuntimeFile)) {
  await cp(path.join(engineSource, file), path.join(engineTarget, file));
}
const stagedDlls = engineFiles.filter(file => isServerRuntimeFile(file) && file.endsWith('.dll'));
if (stagedDlls.length) console.log(`staged llama.cpp engine (llama-server + ${stagedDlls.length} DLLs) into ${engineTarget}`);
await cp(process.execPath, path.join(engineTarget, process.platform === 'win32' ? 'node.exe' : 'node'));

const nodeModulesTarget = path.join(resources, 'node_modules');
await rm(nodeModulesTarget, { recursive: true, force: true });
await mkdir(nodeModulesTarget, { recursive: true });
const stackDeps = ['zod', 'ws', 'typescript', 'typescript-language-server'];
const stagedVersions = [];
for (const dep of stackDeps) {
  const source = path.join(root, 'node_modules', dep);
  const stagingSource = await access(source).then(() => source, () => null);
  if (!stagingSource) throw new Error(`desktop stack dependency ${dep} missing from node_modules - run npm install in the repo root first`);
  await cp(stagingSource, path.join(nodeModulesTarget, dep), { recursive: true });
  const version = JSON.parse(await readFile(path.join(stagingSource, 'package.json'), 'utf8')).version;
  stagedVersions.push(`${dep}@${version}`);
}
console.log(`staged stack dependencies (${stagedVersions.join(', ')})`);

await cp(path.join(modelSource, 'manifest.json'), path.join(runtimeModelDir, 'manifest.json'));
const bootstrapModel = 'smollm2-360m-instruct-q8_0.gguf';
if (await access(path.join(modelSource, bootstrapModel)).then(() => true, () => false)) {
  await cp(path.join(modelSource, bootstrapModel), path.join(runtimeModelDir, bootstrapModel));
  console.log(`staged bootstrap model ${bootstrapModel} into ${runtimeModelDir}`);
} else {
  console.log(`bootstrap model ${bootstrapModel} absent from ${modelSource} - skipping bootstrap GGUF staging`);
}
if (process.env.AIDE_INCLUDE_MODEL_WEIGHTS === '1') {
  for (const file of await readdir(modelSource)) {
    if (!file.endsWith('.gguf') || file === bootstrapModel) continue;
    await cp(path.join(modelSource, file), path.join(runtimeModelDir, file));
  }
  console.log('staged all optional model weights into runtime models (AIDE_INCLUDE_MODEL_WEIGHTS=1)');
}
console.log('desktop resources preparation complete');