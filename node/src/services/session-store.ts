import path from 'node:path';
import { promises as fs } from 'node:fs';
import { SessionFile, type SessionFileT } from '../../../common/contracts/session.ts';

const SESSION_FILE = 'session.json';

function toUri(relative: string): string {
  return `file:///${relative.replace(/\\/g, '/')}`;
}

function migrateLegacy(raw: unknown): SessionFileT | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const legacy = raw as Record<string, unknown>;
  const open = legacy.open_files;
  if (!Array.isArray(open)) return null;
  const tabs = open
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    .map(uri => ({ uri: toUri(uri) }));
  const active = typeof legacy.active_file === 'string' && legacy.active_file.length > 0 ? legacy.active_file : undefined;
  return { version: 1, tabs, ...(active !== undefined ? { activeTab: toUri(active) } : {}) };
}

export class SessionStore {
  readonly file: string;

  constructor(workspace: string, dataDir = '.aide') {
    this.file = path.join(workspace, dataDir, SESSION_FILE);
  }

  async load(): Promise<SessionFileT> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch {
      return { version: 1, tabs: [] };
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      await this.backup();
      return { version: 1, tabs: [] };
    }
    const parsed = SessionFile.safeParse(json);
    if (!parsed.success) {
      const migrated = migrateLegacy(json);
      if (migrated !== null) {
        await this.save(migrated);
        return migrated;
      }
      await this.backup();
      return { version: 1, tabs: [] };
    }
    return parsed.data;
  }

  async save(session: SessionFileT): Promise<SessionFileT> {
    const parsed = SessionFile.safeParse(session);
    if (!parsed.success) throw new Error('invalid session');
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(parsed.data, null, 2), 'utf8');
    return parsed.data;
  }

  private async backup(): Promise<void> {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.rename(this.file, `${this.file}.legacy-${stamp}`);
    } catch {
      // nothing to back up
    }
  }
}