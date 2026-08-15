import { promises as fs } from 'node:fs';
import path from 'node:path';

function safeRelativeFile(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && !path.isAbsolute(value) && !value.split(/[\\/]+/).includes('..');
}

function normalizeBuffers(input, openFiles) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const allowed = new Set(openFiles.filter(safeRelativeFile));
  const buffers = {};
  let total = 0;
  for (const [file, content] of Object.entries(input)) {
    if (!allowed.has(file) || typeof content !== 'string' || content.length > 512 * 1024) continue;
    total += content.length;
    if (total > 4 * 1024 * 1024) break;
    buffers[file] = content;
  }
  return buffers;
}

export class SessionStore {
  constructor(file) { this.file = file; this.state = { active_file: null, open_files: [], buffers: {}, panel: 'terminal', mode: 'simple' }; }
  async load() {
    const loaded = JSON.parse(await fs.readFile(this.file, 'utf8').catch(() => JSON.stringify(this.state)));
    const openFiles = Array.isArray(loaded.open_files) ? loaded.open_files.filter(safeRelativeFile).slice(0, 32) : [];
    this.state = { ...this.state, ...loaded, open_files: openFiles, buffers: normalizeBuffers(loaded.buffers, openFiles) || {} };
    return this.state;
  }
  async save(input = {}) {
    const openFiles = Array.isArray(input.open_files) ? input.open_files.filter(safeRelativeFile).slice(0, 32) : this.state.open_files;
    const buffers = input.buffers === undefined ? this.state.buffers : normalizeBuffers(input.buffers, openFiles);
    this.state = { ...this.state, ...input, open_files: openFiles, buffers: buffers || {}, updated_at: new Date().toISOString() };
    await fs.mkdir(path.dirname(this.file), { recursive: true }); const temporary = `${this.file}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(this.state, null, 2)); await fs.rename(temporary, this.file); return this.state;
  }
}
