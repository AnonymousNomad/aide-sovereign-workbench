import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class ArtifactStore {
  constructor(directory) { this.directory = directory; }
  async add(input) {
    const record = { id: `aide-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`, created_at: new Date().toISOString(), ...input };
    await fs.mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, `${record.id}.json`); const temp = `${file}.tmp`;
    await fs.writeFile(temp, JSON.stringify(record, null, 2)); await fs.rename(temp, file);
    return { id: record.id, created_at: record.created_at, kind: record.kind, status: record.status };
  }
  async list() { const names = await fs.readdir(this.directory).catch(() => []); return Promise.all(names.filter(name => name.endsWith('.json')).sort().reverse().slice(0, 100).map(name => fs.readFile(path.join(this.directory, name), 'utf8').then(JSON.parse))); }
}
