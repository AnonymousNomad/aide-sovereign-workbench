import { access, readdir } from 'node:fs/promises';
for (const path of ['desktop/frontend/index.html', 'desktop/frontend/app.js', 'desktop/frontend/models/manifest.json', 'desktop/frontend/academy/courses/python-foundations.json', 'desktop/frontend/plugins/README.md', 'desktop/frontend/tasks/manifest.json']) await access(path);
await access(`desktop/frontend/runtime/${process.platform === 'win32' ? 'node.exe' : 'node'}`);
await access('desktop/frontend/daemon/server.mjs');
const modelFiles = (await readdir('desktop/frontend/models')).filter(file => file.endsWith('.gguf'));
if (process.env.AIDE_INCLUDE_MODEL_WEIGHTS === '1') {
  if (!modelFiles.length) throw new Error('weight-inclusive desktop preparation requested but no GGUF files were staged');
} else if (modelFiles.length) {
  throw new Error(`core desktop preparation must not bundle GGUF weights: ${modelFiles.join(', ')}`);
}
console.log('desktop frontend preparation verified');
