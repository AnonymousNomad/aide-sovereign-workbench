import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

export class WorkspaceManager {
  constructor(workspace) { this.workspace = path.resolve(workspace); }

  resolve(relativePath) {
    if (!relativePath || path.isAbsolute(relativePath)) throw new Error('workspace-relative path required');
    const target = path.resolve(this.workspace, relativePath);
    if (target !== this.workspace && !target.startsWith(`${this.workspace}${path.sep}`)) throw new Error('path escaped workspace');
    return target;
  }

  async read(relativePath) {
    return fs.readFile(this.resolve(relativePath), 'utf8');
  }

  async tree(maxDepth = 4) {
    const walk = async (directory, depth) => {
      if (depth > maxDepth) return [];
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const result = [];
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.') || ['node_modules', 'target', 'dist'].includes(entry.name)) continue;
        const relative = path.relative(this.workspace, path.join(directory, entry.name));
        if (entry.isDirectory()) result.push({ name: entry.name, path: relative, kind: 'directory', children: await walk(path.join(directory, entry.name), depth + 1) });
        else result.push({ name: entry.name, path: relative, kind: 'file' });
      }
      return result;
    };
    return walk(this.workspace, 0);
  }

  async write(relativePath, content, approved) {
    if (approved !== true) throw new Error('explicit approval required');
    const target = this.resolve(relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.aide-tmp-${process.pid}`;
    await fs.writeFile(temporary, String(content), { mode: 0o600 });
    await fs.rename(temporary, target);
    return { path: relativePath, bytes: Buffer.byteLength(String(content)) };
  }

  async applyPatch(patch, approved) {
    if (approved !== true) throw new Error('explicit approval required');
    if (typeof patch !== 'string' || !patch.startsWith('diff --git ')) throw new Error('unified diff required');
    if (patch.length > 200_000) throw new Error('patch exceeds size limit');
    const temporary = path.join(this.workspace, `.aide-patch-${process.pid}.diff`);
    await fs.writeFile(temporary, patch, { mode: 0o600 });
    try {
      await this.runGit(['apply', '--check', '--whitespace=error', temporary]);
      await this.runGit(['apply', '--whitespace=error', temporary]);
      return { applied: true, bytes: Buffer.byteLength(patch) };
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  runGit(args) {
    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd: this.workspace, timeout: 15000, maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message));
        else resolve(stdout);
      });
    });
  }
}
