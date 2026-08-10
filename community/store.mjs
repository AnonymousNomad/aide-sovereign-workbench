import { promises as fs } from 'node:fs';
import path from 'node:path';

const TYPES = new Set(['projects', 'issues', 'discussions', 'marketplace']);

export class CommunityStore {
  constructor(file) {
    this.file = file;
    this.data = { schema_version: '1.0', sync: 'local-only', projects: [], issues: [], discussions: [], marketplace: [] };
  }

  async load() {
    this.data = JSON.parse(await fs.readFile(this.file, 'utf8'));
    return this.data;
  }

  list() { return structuredClone(this.data); }

  async add(type, item) {
    if (!TYPES.has(type)) throw new Error('community type is not allowed');
    const title = String(item?.title || '').trim();
    const detail = String(item?.detail || '').trim();
    if (!title || title.length > 160 || detail.length > 2000) throw new Error('invalid community item');
    const entry = { title, detail, status: item.status || 'local', created_at: new Date().toISOString() };
    this.data[type].push(entry);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp-${process.pid}`;
    await fs.writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`);
    await fs.rename(temporary, this.file);
    return entry;
  }

  async update(type, index, item) {
    if (!TYPES.has(type) || !Number.isInteger(index) || !this.data[type][index]) throw new Error('community item is not addressable');
    const current = this.data[type][index];
    const title = String(item?.title ?? current.title).trim();
    const detail = String(item?.detail ?? current.detail).trim();
    if (!title || title.length > 160 || detail.length > 2000) throw new Error('invalid community item');
    this.data[type][index] = { ...current, title, detail, updated_at: new Date().toISOString() };
    await this.#save();
    return this.data[type][index];
  }

  async remove(type, index) {
    if (!TYPES.has(type) || !Number.isInteger(index) || !this.data[type][index]) throw new Error('community item is not addressable');
    const [removed] = this.data[type].splice(index, 1);
    await this.#save();
    return removed;
  }

  async #save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp-${process.pid}`;
    await fs.writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`);
    await fs.rename(temporary, this.file);
  }
}
