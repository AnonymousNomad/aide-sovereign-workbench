import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SettingsService } from '../../node/src/services/settings-service.mjs';
import { editorOptionsFromSettings } from '../../node/src/services/editor-options.mjs';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-p3-'));
try {
  const settings = new SettingsService({ workspace });
  await settings.load();
  const defaults = editorOptionsFromSettings(settings);
  assert.deepEqual(defaults, {
    fontSize: 14, tabSize: 2, wordWrap: false,
    minimap_enabled: true, stickyScroll_enabled: true, folding_enabled: true,
    bracketPairColorization_enabled: true, multiCursorModifier: 'ctrlKey'
  });

  await settings.writeUserValues({
    'aide.editor.fontSize': 99,
    'aide.editor.tabSize': 0,
    'aide.editor.wordWrap': 'true',
    'aide.editor.multiCursorModifier': 'winKey',
    'aide.editor.minimap': false
  });
  const clamped = editorOptionsFromSettings(settings);
  assert.equal(clamped.fontSize, 48, 'oversize font clamped to max');
  assert.equal(clamped.tabSize, 1, 'undersize tab clamped to min');
  assert.equal(clamped.wordWrap, true, 'string true coerces');
  assert.equal(clamped.multiCursorModifier, 'ctrlKey', 'invalid modifier falls back');
  assert.equal(clamped.minimap_enabled, false);
} finally {
  await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
}
console.log('P3 editor options tests passed');
