import { promises as fs } from 'node:fs';
import path from 'node:path';
import { evaluateWhen, impliesWhen } from '../../../common/context-keys.mjs';

const DEFAULT_RULES = [
  { key: 'ctrl+shift+p', command: 'aide.commandPalette.show' },
  { key: 'ctrl+p', command: 'aide.quickOpen.show' },
  { key: 'ctrl+s', command: 'aide.file.save' },
  { key: 'ctrl+w', command: 'aide.view.closeActive' },
  { key: 'ctrl+b', command: 'aide.view.toggleSidebar' },
  { key: 'ctrl+k z', command: 'aide.view.zoomReset' },
  { key: 'ctrl+`', command: 'aide.terminal.toggle' }
];

function normalizeChords(key) {
  return String(key ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export class KeybindingService {
  constructor({ workspace, rules = DEFAULT_RULES }) {
    this.workspace = workspace;
    this.defaults = rules.map(rule => ({ ...rule, chords: normalizeChords(rule.key), source: 'default' }));
    this.merged = this.defaults;
    this.userFile = path.join(workspace, '.aide', 'keybindings.json');
  }

  async load() {
    let userRules = [];
    try {
      const parsed = JSON.parse(await fs.readFile(this.userFile, 'utf8'));
      if (Array.isArray(parsed)) {
        userRules = parsed
          .filter(rule => rule && typeof rule.key === 'string' && typeof rule.command === 'string')
          .map(rule => ({ ...rule, chords: normalizeChords(rule.key), source: 'user' }));
      }
    } catch {
      userRules = [];
    }
    const removals = userRules.filter(rule => rule.command.startsWith('-'));
    const additions = userRules.filter(rule => !rule.command.startsWith('-'));
    const kept = this.defaults.filter(defaultRule => !removals.some(removal =>
      removal.chords.join(' ') === defaultRule.chords.join(' ') &&
      (removal.when === undefined || impliesWhen(removal.when, defaultRule.when)))
    );
    this.merged = [...kept, ...additions];
    return this.list();
  }

  list() {
    return this.merged.map(({ chords, source, command, when }) => ({ key: chords.join(' '), command, when: when ?? 'true', source }));
  }

  resolve(chordArray, context = {}) {
    if (!Array.isArray(chordArray) || chordArray.length === 0) return { match: null, pending: false };
    const pressed = chordArray.map(chord => String(chord).toLowerCase());
    const candidates = this.merged.filter(rule => {
      if (rule.chords.length < pressed.length) return false;
      for (let index = 0; index < pressed.length; index += 1) {
        if (rule.chords[index] !== pressed[index]) return false;
      }
      return true;
    });
    if (candidates.length === 0) return { match: null, pending: false };
    const exact = candidates.filter(rule => rule.chords.length === pressed.length);
    if (exact.length === 0) return { match: null, pending: true };
    const satisfied = exact.filter(rule => evaluateWhen(rule.when ?? 'true', context));
    const chosen = satisfied.at(-1) ?? exact.at(-1);
    return { match: chosen ? chosen.command : null, pending: false };
  }

  async writeUserRules(rules) {
    await fs.mkdir(path.dirname(this.userFile), { recursive: true });
    const temp = `${this.userFile}.tmp`;
    await fs.writeFile(temp, JSON.stringify(rules, null, 2), 'utf8');
    await fs.rename(temp, this.userFile);
    return this.load();
  }
}
