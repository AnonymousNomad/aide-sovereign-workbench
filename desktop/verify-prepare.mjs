import { access, readdir } from 'node:fs/promises';
const webPaths = ['desktop/frontend/index.html', 'desktop/frontend/app.js', 'desktop/frontend/models/manifest.json', 'desktop/frontend/academy/courses/python-foundations.json', 'desktop/frontend/plugins/README.md', 'desktop/frontend/tasks/manifest.json'];
for (const path of webPaths) await access(path);
await access(`desktop/frontend/runtime/${process.platform === 'win32' ? 'node.exe' : 'node'}`);
await access('desktop/frontend/daemon/server.mjs');
const modelFiles = (await readdir('desktop/frontend/models')).filter(file => file.endsWith('.gguf'));
if (process.env.AIDE_INCLUDE_MODEL_WEIGHTS === '1') {
  if (!modelFiles.length) throw new Error('weight-inclusive desktop preparation requested but no GGUF files were staged');
} else if (modelFiles.length) {
  throw new Error(`core desktop preparation must not bundle GGUF weights: ${modelFiles.join(', ')}`);
}
console.log('desktop frontend preparation verified');

const runtimeDir = process.platform === 'win32' ? 'node.exe' : 'node';
await access(`desktop/resources/runtime/${runtimeDir}`);
await access('desktop/resources/stack-launcher.mjs');
await access('desktop/resources/node/src/server.ts');
await access('desktop/resources/daemon/server.mjs');
await access('desktop/resources/scripts/facade.mjs');
await access('desktop/resources/models/manifest.json');
const engineExe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
await access(`desktop/resources/runtime/${engineExe}`);
const engineDlls = await readdir('desktop/resources/runtime').then(files => files.filter(file => file.endsWith('.dll')));
const requiredDlls = ['llama-server-impl.dll', 'llama.dll', 'llama-common.dll', 'ggml-base.dll', 'libomp140.x86_64.dll'];
if (process.platform === 'win32') {
  for (const dll of requiredDlls) {
    if (!engineDlls.includes(dll)) throw new Error(`packaged engine missing required DLL: ${dll}`);
  }
  if (!engineDlls.some(file => file.startsWith('ggml-cpu-'))) throw new Error('packaged engine missing any ggml-cpu-* backend DLL');
}
const runtimeModelFiles = (await readdir('desktop/resources/models')).filter(file => file.endsWith('.gguf'));
if (process.env.AIDE_INCLUDE_MODEL_WEIGHTS === '1') {
  if (!runtimeModelFiles.length) throw new Error('weight-inclusive desktop preparation requested but no runtime model weights were staged');
} else {
  if (!runtimeModelFiles.includes('smollm2-360m-instruct-q8_0.gguf')) throw new Error(`bootstrap model must be staged: smollm2-360m-instruct-q8_0.gguf (got ${runtimeModelFiles.join(', ')})`);
}
console.log('desktop resources (offline stack + engine + bootstrap model) verified');