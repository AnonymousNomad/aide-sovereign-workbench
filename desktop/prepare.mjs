import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(desktop, '..');
const frontend = path.join(desktop, 'frontend');
await rm(frontend, { recursive: true, force: true });
await mkdir(frontend, { recursive: true });
for (const file of ['index.html', 'app.js', 'styles.css']) await cp(path.join(root, file), path.join(frontend, file));
for (const directory of ['models', 'community', 'languages', 'debuggers', 'training', 'academy', 'blueprint', 'plugins', 'tasks', 'daemon', 'session', 'artifacts', 'providers', 'harness']) await cp(path.join(root, directory), path.join(frontend, directory), { recursive: true });
await mkdir(path.join(frontend, 'runtime'), { recursive: true });
await cp(process.execPath, path.join(frontend, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'));
console.log(`prepared desktop frontend at ${frontend}`);
