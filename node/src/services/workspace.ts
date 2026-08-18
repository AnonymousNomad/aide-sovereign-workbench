import { promises as fs } from 'node:fs';
import path from 'node:path';
import { RouteError } from '../server.ts';

export class WorkspaceService {
  readonly root: string;

  constructor(workspace: string) {
    this.root = path.resolve(workspace);
  }

  resolve(relativePath: string): string {
    if (!relativePath || path.isAbsolute(relativePath)) {
      throw new RouteError('FORBIDDEN', 'workspace-relative path required');
    }
    const target = path.resolve(this.root, relativePath);
    if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) {
      throw new RouteError('FORBIDDEN', 'path escaped workspace');
    }
    return target;
  }

  async read(relativePath: string): Promise<string> {
    return fs.readFile(this.resolve(relativePath), 'utf8');
  }

  async stat(relativePath: string): Promise<{ size: number } | null> {
    const target = this.resolve(relativePath);
    try {
      const stat = await fs.stat(target);
      return { size: stat.size };
    } catch {
      return null;
    }
  }

  async write(relativePath: string, content: string, approved: boolean): Promise<{ path: string; bytes: number }> {
    if (approved !== true) throw new RouteError('FORBIDDEN', 'explicit approval required');
    const target = this.resolve(relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.aide-tmp-${process.pid}`;
    await fs.writeFile(temporary, content, { mode: 0o600 });
    await fs.rename(temporary, target);
    return { path: relativePath, bytes: Buffer.byteLength(content) };
  }
}