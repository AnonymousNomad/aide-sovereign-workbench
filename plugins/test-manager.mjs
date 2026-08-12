import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PluginManager } from './manager.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'aide-plugins-'));
await mkdir(path.join(root, 'demo'));
await writeFile(path.join(root, 'demo', 'aide-plugin.json'), JSON.stringify({ id: 'demo', name: 'Demo', version: '0.1.0', api_version: '1', entry: 'index.mjs', capabilities: ['ui.view'] }));
await writeFile(path.join(root, 'demo', 'index.mjs'), "let d='';process.stdin.on('data', c => d += c);process.stdin.on('end', () => process.stdout.write(JSON.stringify({ok:true, received:JSON.parse(d).ping})));\n");
const manager = new PluginManager({ pluginsDir: root, statePath: path.join(root, 'state.json') });
assert.equal((await manager.load())[0].trusted, false);
assert.equal((await manager.setTrust('demo', true))[0].enabled, true);
assert.equal((await manager.load())[0].executable, true);
assert.deepEqual(await manager.execute('demo', { ping: 'pong' }), { ok: true, received: 'pong' });
console.log('plugin manager test passed');
