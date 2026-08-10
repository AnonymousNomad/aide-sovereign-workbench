import { promises as fs } from 'node:fs';
import path from 'node:path';

export class ReplayStore {
  constructor(file) { this.file = file; this.data = { schema_version: '1.0', privacy: 'metadata-only', replays: [] }; }
  async load() { this.data = JSON.parse(await fs.readFile(this.file, 'utf8')); return this.data; }
  list() { return structuredClone(this.data); }
  async add(item) {
    const record = { id: `replay-${Date.now()}`, task_class: String(item.task_class || 'unknown'), model: String(item.model || 'unknown'), status: String(item.status || 'unknown'), checks: item.checks || {}, created_at: new Date().toISOString() };
    this.data.replays.push(record);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp-${process.pid}`;
    await fs.writeFile(temp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, this.file);
    return record;
  }
}
