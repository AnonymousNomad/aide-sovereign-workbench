import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { RouteError } from '../server.ts';
import type { WorkspaceTreeNodeT } from '../../../common/contracts/workspace.ts';

export const TREE_MAX_DEPTH = 4;
const TREE_EXCLUDES = new Set(['node_modules', 'target', 'dist']);

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

  async applyPatch(patch: string, approved: boolean): Promise<{ applied: boolean; bytes: number }> {
    if (approved !== true) throw new RouteError('FORBIDDEN', 'explicit approval required');
    if (typeof patch !== 'string' || !patch.startsWith('diff --git ')) {
      throw new RouteError('BAD_REQUEST', 'unified diff required');
    }
    if (patch.length > 200_000) throw new RouteError('BAD_REQUEST', 'patch exceeds size limit');
    const temporary = path.join(this.root, `.aide-patch-${process.pid}.diff`);
    await fs.writeFile(temporary, patch, { mode: 0o600 });
    try {
      await this.runGit(['apply', '--check', '--whitespace=error', temporary]);
      await this.runGit(['apply', '--whitespace=error', temporary]);
      return { applied: true, bytes: Buffer.byteLength(patch) };
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  runGit(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd: this.root, timeout: 15000, maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message));
        else resolve(stdout);
      });
    });
  }

  async tree(maxDepth: number = TREE_MAX_DEPTH): Promise<WorkspaceTreeNodeT[]> {
    const walk = async (directory: string, depth: number): Promise<WorkspaceTreeNodeT[]> => {
      if (depth > maxDepth) return [];
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const nodes: WorkspaceTreeNodeT[] = [];
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.') || TREE_EXCLUDES.has(entry.name)) continue;
        const relative = path.relative(this.root, path.join(directory, entry.name)).split(path.sep).join('/');
        if (entry.isDirectory()) {
          nodes.push({
            name: entry.name,
            path: relative,
            kind: 'directory' as const,
            children: await walk(path.join(directory, entry.name), depth + 1)
          });
        } else {
          nodes.push({ name: entry.name, path: relative, kind: 'file' as const });
        }
      }
      return nodes;
    };
    return walk(this.root, 0);
  }
}