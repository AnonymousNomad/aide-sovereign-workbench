import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateWhen, impliesWhen } from '../../common/context-keys.mjs';
import { CommandRegistry } from '../../node/src/services/command-registry.mjs';
import { KeybindingService } from '../../node/src/services/keybinding-service.mjs';
import { SettingsService } from '../../node/src/services/settings-service.mjs';

assert.equal(evaluateWhen('true', {}), true);
assert.equal(evaluateWhen('false', {}), false);
assert.equal(evaluateWhen('editorFocus && !isComposing', { editorFocus: true, isComposing: false }), true);
assert.equal(evaluateWhen('editorFocus && !isComposing', { editorFocus: true, isComposing: true }), false);
assert.equal(evaluateWhen('a || b', { b: true }), true);
assert.equal(evaluateWhen('mode == "debug"', { mode: 'debug' }), true);
assert.equal(evaluateWhen('mode != "debug"', { mode: 'edit' }), true);
assert.equal(evaluateWhen('resourcePath =~ .*\\.py$', { resourcePath: '/x/y/z.py' }), true);
assert.equal(evaluateWhen('resourcePath =~ .*\\.py$', { resourcePath: '/x/y/z.ts' }), false);
assert.equal(evaluateWhen('(a || b) && c', { a: true, c: true }), true);
assert.equal(evaluateWhen('a &&', { a: true }), false, 'trailing operator must fail closed');
assert.equal(evaluateWhen(`${'a'.repeat(600)}`, {}), false, 'oversize expression rejected');
assert.equal(evaluateWhen('unboundKey', {}), false);
assert.equal(impliesWhen('editorFocus', 'editorFocus'), true);

const registry = new CommandRegistry();
const reg = registry.registerCommand({ id: 'aide.test.ping', title: 'Ping', enablement: 'canPing', handler: args => ({ pong: args?.echo ?? 'pong' }) });
assert.equal(registry.list().length, 1);
assert.throws(() => registry.registerCommand({ id: 'bad id!', title: 'X', handler: () => {} }), /invalid command id/);

assert.equal((await registry.invoke('aide.test.ping', null, {})).error, 'FORBIDDEN');
assert.deepEqual(await registry.invoke('aide.test.ping', { echo: 5 }, { canPing: true }), { result: { pong: 5 } });
assert.equal((await registry.invoke('nope.nope', null, {})).error, 'NOT_FOUND');
reg.dispose();
assert.equal(registry.get('aide.test.ping'), null);

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-p1-'));
try {
  const keybindings = new KeybindingService({ workspace });
  const listed = await keybindings.load();
  assert.ok(listed.length >= 6);
  assert.equal(keybindings.resolve(['ctrl+shift+p'], {}).match, 'aide.commandPalette.show');
  assert.equal(keybindings.resolve(['ctrl+k'], {}).pending, true, 'chord prefix must be pending');
  assert.equal(keybindings.resolve(['ctrl+k', 'q'], {}).match, null);
  await keybindings.writeUserRules([{ key: 'ctrl+shift+p', command: '-aide.commandPalette.show' }, { key: 'ctrl+j', command: 'aide.custom.panel' }]);
  assert.equal(keybindings.resolve(['ctrl+shift+p'], {}).match, null, 'removal rule must unbind default');
  assert.equal(keybindings.resolve(['ctrl+j'], {}).match, 'aide.custom.panel');
  assert.equal(keybindings.list().filter(rule => rule.source === 'user' && !rule.command.startsWith('-')).length, 1, 'only additions appear in merged list; removals act as filters');

  const settings = new SettingsService({ workspace });
  const initial = await settings.load();
  assert.equal(initial['aide.editor.fontSize'], 14);
  const afterWrite = await settings.writeUserValues({ 'aide.editor.fontSize': 16 });
  assert.equal(afterWrite['aide.editor.fontSize'], 16);
  await assert.rejects(() => settings.writeUserValues({ 'aide.terminal.shellPath': 'evil' }), /machine-scoped/);
  await fs.mkdir(path.join(workspace, '.vscode'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({ 'aide.paths.workspaceRoot': 'C:/evil', 'aide.editor.tabSize': 4 }));
  await settings.load();
  const merged = settings.merged();
  assert.equal(merged['aide.editor.tabSize'], 4, 'folder setting applies');
  assert.notEqual(merged['aide.paths.workspaceRoot'], 'C:/evil', 'restricted folder setting must be ignored');
} finally {
  await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
}
console.log('P1 services tests passed');
