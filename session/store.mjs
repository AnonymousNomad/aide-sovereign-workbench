import { promises as fs } from 'node:fs';
import path from 'node:path';

export class SessionStore {
  constructor(file) { this.file = file; this.state = { active_file: null, open_files: [], panel: 'terminal', mode: 'simple' }; }
  async load() { this.state = JSON.parse(await fs.readFile(this.file, 'utf8').catch(() => JSON.stringify(this.state))); return this.state; }
  async save(input) {
    this.state = { ...this.state, ...input, open_files: Array.isArray(input.open_files) ? input.open_files.slice(0, 32) : this.state.open_files, updated_at: new Date().toISOString() };
    await fs.mkdir(path.dirname(this.file), { recursive: true }); const temporary = `${this.file}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(this.state, null, 2)); await fs.rename(temporary, this.file); return this.state;
  }
}
