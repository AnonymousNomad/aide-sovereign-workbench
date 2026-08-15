import { cp, mkdir, readdir, rm } from 'node:fs/promises';
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
