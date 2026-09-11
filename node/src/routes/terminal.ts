import { promises as fs } from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { type Route, RouteError } from '../server.ts';
import { TerminalRunRequest, TerminalRunResponse, type TerminalRunResponseT } from '../../../common/contracts/terminal.ts';
import type { WorkspaceService } from '../services/workspace.ts';

const TERMINAL_ALLOWLIST = new Set(['node', 'npm', 'npx', 'git', 'py', 'python', 'python3', 'cargo', 'rustc']);
const TERMINAL_DENIED_FLAGS: Record<string, RegExp> = {
  node: /^(-e|--eval|--input|--check)$/,
  npx: /^(-y|--call|--global|--offline)$/,
  python: /^(-c|--exec|-m|--module|-B)$/,
  python3: /^(-c|--exec|-m|--module|-B)$/,
  py: /^(-c|--exec|-m|--module|-B)$/
};
const TERMINAL_MAX_ARGS = 24;
const TERMINAL_TIMEOUT_MS = 30_000;
const TERMINAL_MAX_BUFFER = 512 * 1024;

async function terminalBuiltin(workspace: WorkspaceService, program: string, args: string[]): Promise<TerminalRunResponseT | null> {
  if (program === 'echo') return { code: 0, stdout: `${args.join(' ')}${os.EOL}`, stderr: '' };
  if (program === 'pwd') return { code: 0, stdout: `${workspace.root}${os.EOL}`, stderr: '' };
  if (program === 'ls' || program === 'dir') {
    const target = args[0] ? workspace.resolve(args[0]) : workspace.root;
    const entries = await fs.readdir(target, { withFileTypes: true });
    return { code: 0, stdout: entries.map(entry => `${entry.isDirectory() ? '<DIR>' : '     '} ${entry.name}`).join(os.EOL) + os.EOL, stderr: '' };
  }
  if (program === 'cat' || program === 'type') {
    if (!args[0]) throw new RouteError('BAD_REQUEST', `${program} requires a workspace-relative file path`);
    return { code: 0, stdout: await workspace.read(args[0]), stderr: '' };
  }
  return null;
}

export function routeForTerminalRun(workspace: WorkspaceService): Route {
  return {
    method: 'POST',
    path: '/api/terminal/run',
    body: TerminalRunRequest,
    response: TerminalRunResponse,
    handler: async ({ body }): Promise<TerminalRunResponseT> => {
      const input = body as { program: string; args: string[]; approved: boolean };
      if (input.approved !== true) throw new RouteError('FORBIDDEN', 'explicit approval required');
      const program = String(input.program || '').toLowerCase();
      const args = Array.isArray(input.args) ? input.args.map(String) : [];
      if (args.length > TERMINAL_MAX_ARGS) throw new RouteError('BAD_REQUEST', 'terminal command has too many arguments');

      const builtin = await terminalBuiltin(workspace, program, args);
      if (builtin) return builtin;
      if (!TERMINAL_ALLOWLIST.has(program)) throw new RouteError('FORBIDDEN', 'terminal command is not allowlisted');

      const flagValidator = TERMINAL_DENIED_FLAGS[program];
      if (flagValidator) {
        for (const arg of args) {
          if (flagValidator.test(arg)) throw new RouteError('FORBIDDEN', `flag '${arg}' is not permitted on '${program}' for security`);
        }
      }

      let result: TerminalRunResponseT;
      try {
        result = await new Promise<TerminalRunResponseT>((resolve, reject) => {
          execFile(program, args, {
            cwd: workspace.root,
            timeout: TERMINAL_TIMEOUT_MS,
            maxBuffer: TERMINAL_MAX_BUFFER,
            env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_PATH: process.env.NODE_PATH } as NodeJS.ProcessEnv,
            windowsHide: true
          }, (error, stdout, stderr) => {
            if (error) {
              if (typeof error.code === 'number') {
                resolve({ code: error.code, stdout, stderr });
              } else {
                reject(new Error(stderr.trim() || error.message));
              }
              return;
            }
            resolve({ code: 0, stdout, stderr });
          });
        });
      } catch (error) {
        throw new RouteError('CHILD_FAILED', String((error as Error)?.message ?? error).slice(0, 500));
      }
      return result;
    }
  };
}

export function routesForTerminal(workspace: WorkspaceService): Route[] {
  return [routeForTerminalRun(workspace)];
}