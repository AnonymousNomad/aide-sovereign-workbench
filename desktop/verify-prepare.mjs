import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(desktop, '..');
const frontend = path.join(root, 'browser', 'dist');
const resources = path.join(desktop, 'resources');
const config = JSON.parse(await readFile(path.join(desktop, 'tauri.conf.json'), 'utf8'));
if (config.build?.frontendDist !== '../browser/dist') throw new Error(`Tauri frontendDist is not canonical: ${config.build?.frontendDist}`);

const index = await readFile(path.join(frontend, 'index.html'), 'utf8');
if (!index.includes('<div id="app"></div>') || !index.includes('type="module"')) throw new Error('browser/dist does not contain the typed frontend entrypoint');
if (/src=["'](?:\.\/)?app\.js["']/.test(index)) throw new Error('browser/dist unexpectedly selects the legacy app.js frontend');
const assetFiles = await readdir(path.join(frontend, 'assets'));
if (!assetFiles.some(file => file.endsWith('.js'))) throw new Error('typed frontend JavaScript asset missing');
if (!assetFiles.some(file => file.endsWith('.css'))) throw new Error('typed frontend CSS asset missing');

const required = [
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
  path.join(resources, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'),
  path.join(resources, 'node_modules', 'zod', 'package.json'),
  path.join(resources, 'node_modules', 'ws', 'package.json'),
  path.join(resources, 'node_modules', 'typescript', 'package.json'),
  path.join(resources, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs')
];
for (const file of required) await access(file);

const sourceLauncher = await readFile(path.join(desktop, 'stack-launcher.mjs'));
const stagedLauncher = await readFile(path.join(resources, 'stack-launcher.mjs'));
if (!sourceLauncher.equals(stagedLauncher)) throw new Error('staged stack launcher differs from its tracked source authority');

const runtimeModelFiles = (await readdir(path.join(resources, 'models'))).filter(file => file.endsWith('.gguf'));
if (process.env.AIDE_INCLUDE_MODEL_WEIGHTS === '1') {
  if (!runtimeModelFiles.length) throw new Error('weight-inclusive desktop preparation requested but no GGUF files were staged');
} else if (await access(path.join(root, 'models', 'smollm2-360m-instruct-q8_0.gguf')).then(() => true).catch(() => false)) {
  if (!runtimeModelFiles.includes('smollm2-360m-instruct-q8_0.gguf')) throw new Error(`bootstrap model was not staged: ${runtimeModelFiles.join(', ')}`);
}

const llamaName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
const hasLlama = await access(path.join(resources, 'runtime', llamaName)).then(() => true).catch(() => false);
if (!hasLlama && process.env.AIDE_REQUIRE_MODEL_RUNTIME === '1') throw new Error(`desktop preparation is missing required model runtime: ${llamaName}`);

console.log(`desktop preparation verified (frontend: typed browser/dist; model runtime: ${hasLlama ? 'staged' : 'not supplied'})`);
