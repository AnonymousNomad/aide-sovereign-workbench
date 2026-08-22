import { promises as fs } from 'node:fs';
import path from 'node:path';

const RESTRICTED_KEYS = ['aide.paths.workspaceRoot', 'aide.exec.pythonInterpreter', 'aide.exec.shellPath'];

export class SettingsService {
  constructor({ workspace }) {
    this.workspace = workspace;
    this.userFile = path.join(workspace, '.aide', 'settings.json');
    this.folderFile = path.join(workspace, '.vscode', 'settings.json');
    this.defaults = new Map([
      ['aide.editor.fontSize', { type: 'number', default: 14, scope: 'application', description: 'Editor font size in px' }],
      ['aide.editor.tabSize', { type: 'number', default: 2, scope: 'resource', description: 'Spaces per tab' }],
      ['aide.editor.wordWrap', { type: 'boolean', default: false, scope: 'resource', description: 'Wrap long lines' }],
      ['aide.editor.minimap', { type: 'boolean', default: true, scope: 'resource', description: 'Show the minimap' }],
      ['aide.editor.stickyScroll', { type: 'boolean', default: true, scope: 'resource', description: 'Sticky scroll headers' }],
      ['aide.editor.folding', { type: 'boolean', default: true, scope: 'resource', description: 'Code folding controls' }],
      ['aide.editor.bracketColorization', { type: 'boolean', default: true, scope: 'resource', description: 'Colorize bracket pairs' }],
      ['aide.editor.multiCursorModifier', { type: 'string', default: 'ctrlKey', scope: 'application', description: 'Modifier for multi-cursor (ctrlKey|altKey|metaKey)' }],
      ['aide.terminal.shellPath', { type: 'string', default: '', scope: 'machine', description: 'Override shell path (restricted)' }],
      ['aide.chat.modelId', { type: 'string', default: '', scope: 'window', description: 'Preferred local model id' }]
    ]);
    this.userValues = {};
    this.folderValues = {};
  }

  async load() {
    this.userValues = await this.#readJson(this.userFile);
    this.folderValues = await this.#readJson(this.folderFile);
    return this.merged();
  }

  async #readJson(file) {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  merged() {
    const values = {};
    for (const [key, descriptor] of this.defaults) {
      let value = descriptor.default;
      if (Object.hasOwn(this.userValues, key)) value = this.userValues[key];
      if (!RESTRICTED_KEYS.includes(key) && Object.hasOwn(this.folderValues, key)) value = this.folderValues[key];
      values[key] = value;
    }
    for (const [key, value] of Object.entries(this.userValues)) {
      if (!Object.hasOwn(values, key)) values[key] = value;
    }
    for (const [key, value] of Object.entries(this.folderValues)) {
      if (!RESTRICTED_KEYS.includes(key) && !Object.hasOwn(values, key)) values[key] = value;
    }
    return values;
  }

  descriptors() {
    return Array.from(this.defaults.entries()).map(([key, descriptor]) => ({ key, ...descriptor }));
  }

  restrictedReverted() {
    return RESTRICTED_KEYS.filter(key => Object.hasOwn(this.folderValues, key));
  }

  async writeUserValues(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('settings payload must be an object');
    for (const key of Object.keys(values)) {
      if (this.defaults.get(key)?.scope === 'machine') throw new Error(`setting ${key} is machine-scoped and read-only from UI`);
    }
    await fs.mkdir(path.dirname(this.userFile), { recursive: true });
    const temp = `${this.userFile}.tmp`;
    await fs.writeFile(temp, JSON.stringify(values, null, 2), 'utf8');
    await fs.rename(temp, this.userFile);
    this.userValues = values;
    return this.merged();
  }
}
