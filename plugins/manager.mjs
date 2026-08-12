import { promises as fs } from 'node:fs';
import path from 'node:path';

const CAPABILITIES = new Set(['workspace.read', 'workspace.write', 'terminal.run', 'ui.view', 'command.register', 'network.localhost']);
const ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;

export class PluginManager {
  constructor({ pluginsDir, statePath }) { this.pluginsDir = pluginsDir; this.statePath = statePath; this.plugins = []; this.trust = {}; }

  async load() {
    await fs.mkdir(this.pluginsDir, { recursive: true });
    this.trust = JSON.parse(await fs.readFile(this.statePath, 'utf8').catch(() => '{}'));
    const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
    this.plugins = [];
    for (const entry of entries.filter(item => item.isDirectory())) {
      const manifestPath = path.join(this.pluginsDir, entry.name, 'aide-plugin.json');
      try { this.plugins.push(this.validate(JSON.parse(await fs.readFile(manifestPath, 'utf8')), entry.name)); } catch (error) { this.plugins.push({ id: entry.name, name: entry.name, invalid: error.message, enabled: false, trusted: false }); }
    }
    return this.list();
  }

  validate(manifest, folder) {
    if (!ID.test(manifest.id || '') || manifest.id !== folder) throw new Error('plugin id must match its folder and use a safe id');
    if (manifest.api_version !== '1') throw new Error('unsupported AIDE plugin API version');
    if (!manifest.name || !manifest.version) throw new Error('plugin name and version are required');
    const capabilities = manifest.capabilities || [];
    if (!Array.isArray(capabilities) || capabilities.some(capability => !CAPABILITIES.has(capability))) throw new Error('plugin requests an unsupported capability');
    if (manifest.entry && (manifest.entry.includes('..') || path.isAbsolute(manifest.entry))) throw new Error('plugin entry escaped its directory');
    return { ...manifest, folder, capabilities, trusted: this.trust[manifest.id] === true, enabled: this.trust[manifest.id] === true, executable: false };
  }

  list() { return this.plugins.map(plugin => ({ ...plugin, trust_required: !plugin.trusted, executable: false })); }

  async setTrust(id, trusted) {
    const plugin = this.plugins.find(item => item.id === id);
    if (!plugin || plugin.invalid) throw new Error('plugin is unavailable');
    this.trust[id] = trusted === true;
    const temp = `${this.statePath}.tmp`;
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    await fs.writeFile(temp, JSON.stringify(this.trust, null, 2));
    await fs.rename(temp, this.statePath);
    return this.load();
  }
}
