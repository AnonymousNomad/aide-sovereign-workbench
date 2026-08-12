import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CAPABILITIES = new Set(['workspace.read', 'workspace.write', 'terminal.run', 'ui.view', 'command.register', 'network.localhost']);
const ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;

export class PluginManager {
  constructor({ pluginsDir, statePath, presetsPath = path.join(pluginsDir, 'presets.json') }) { this.pluginsDir = pluginsDir; this.statePath = statePath; this.presetsPath = presetsPath; this.plugins = []; this.trust = {}; this.presetCatalog = []; }

  async load() {
    await fs.mkdir(this.pluginsDir, { recursive: true });
    this.trust = JSON.parse(await fs.readFile(this.statePath, 'utf8').catch(() => '{}'));
    this.presetCatalog = JSON.parse(await fs.readFile(this.presetsPath, 'utf8').catch(() => '[]'));
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
    return { ...manifest, folder, capabilities, trusted: this.trust[manifest.id] === true, enabled: this.trust[manifest.id] === true, executable: Boolean(manifest.entry) };
  }

  list() { return this.plugins.map(plugin => ({ ...plugin, trust_required: !plugin.trusted, executable: plugin.executable === true })); }

  presets() { return this.presetCatalog.map(preset => ({ ...preset, installed: this.plugins.some(plugin => plugin.id === preset.id) })); }

  async scaffold(id) {
    const preset = this.presetCatalog.find(item => item.id === id);
    if (!preset) throw new Error('plugin preset is not available');
    const directory = path.join(this.pluginsDir, preset.id);
    await fs.mkdir(directory, { recursive: true });
    const manifest = { ...preset, version: '0.1.0', api_version: '1', activation_events: [], contributes: { commands: [], views: [] }, status: 'template', entry: null };
    await fs.writeFile(path.join(directory, 'aide-plugin.json'), JSON.stringify(manifest, null, 2));
    return this.load();
  }

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

  async execute(id, payload) {
    const plugin = this.plugins.find(item => item.id === id);
    if (!plugin || plugin.invalid) throw new Error('plugin is unavailable');
    if (plugin.trusted !== true) throw new Error('plugin trust is required before execution');
    if (!plugin.entry) throw new Error('plugin has no entrypoint');
    const pluginDir = path.join(this.pluginsDir, plugin.folder);
    const entry = path.resolve(pluginDir, plugin.entry);
    if (!entry.startsWith(`${pluginDir}${path.sep}`)) throw new Error('plugin entry escaped its directory');
    await fs.access(entry);
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--experimental-permission', `--allow-fs-read=${pluginDir}`, '--no-addons', entry], { cwd: pluginDir, env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = ''; let error = '';
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('plugin execution timed out')); }, 10_000);
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { error += chunk; });
      child.once('error', reason => { clearTimeout(timer); reject(reason); });
      child.once('close', code => { clearTimeout(timer); if (code !== 0) return reject(new Error(error.trim() || `plugin exited with ${code}`)); try { resolve(JSON.parse(output.trim())); } catch { reject(new Error('plugin returned invalid JSON')); } });
      child.stdin.end(`${JSON.stringify(payload)}\n`);
    });
  }
}
