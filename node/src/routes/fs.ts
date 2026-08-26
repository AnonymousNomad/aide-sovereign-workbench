import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Route } from '../server.ts';
import { RouteError } from '../server.ts';
import type { WorkspaceService } from '../services/workspace.ts';
import {
  FileReadQuery,
  FileReadResponse,
  FileWriteRequest,
  FileWriteResponse,
  type FileReadResponseT,
  type FileWriteResponseT
} from '../../../common/contracts/file.ts';
import {
  SearchQuery,
  SearchResponse,
  SearchReplaceRequest,
  SearchReplaceResponse,
  SEARCH_DEFAULT_EXCLUDES,
  SEARCH_MAX_FILE_BYTES,
  SEARCH_MAX_OCCURRENCES,
  SEARCH_MAX_RESULTS,
  SEARCH_HIT_TEXT_SLICE,
  type SearchResponseT,
  type SearchReplaceResponseT
} from '../../../common/contracts/search.ts';

export const FILE_READ_TOO_LARGE_BYTES = 1024 * 1024;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matchMask(filePath: string, mask: string): boolean {
  const patterns = mask
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
  if (!patterns.length) return true;
  return patterns.some(pattern => {
    const glob = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${glob}$`, 'i').test(filePath);
  });
}

function excludeSet(includeParam: string | undefined): Set<string> {
  const included = new Set(
    (includeParam ?? '')
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)
  );
  return new Set(SEARCH_DEFAULT_EXCLUDES.filter(name => !included.has(name)));
}

function flag(value: string | undefined): boolean {
  return value === '1';
}

export function routeForFileRead(workspace: WorkspaceService): Route {
  return {
    method: 'GET',
    path: '/api/file',
    prefix: true,
    query: FileReadQuery,
    response: FileReadResponse,
    handler: async ({ query }): Promise<FileReadResponseT> => {
      const relativePath = (query as { path: string }).path;
      const stat = await workspace.stat(relativePath);
      if (!stat) throw new RouteError('NOT_FOUND', `file not found: ${relativePath}`);
      if (stat.size > FILE_READ_TOO_LARGE_BYTES) {
        return { path: relativePath, content: null, too_large: true, size: stat.size };
      }
      return { path: relativePath, content: await workspace.read(relativePath), too_large: false, size: stat.size };
    }
  };
}

export function routeForFileWrite(workspace: WorkspaceService): Route {
  return {
    method: 'POST',
    path: '/api/file/write',
    body: FileWriteRequest,
    response: FileWriteResponse,
    handler: async ({ body }): Promise<FileWriteResponseT> => {
      const request = body as { path: string; content: string; approved: boolean };
      return workspace.write(request.path, request.content, request.approved);
    }
  };
}

export function routeForSearch(workspace: WorkspaceService): Route {
  return {
    method: 'GET',
    path: '/api/search',
    prefix: true,
    query: SearchQuery,
    response: SearchResponse,
    handler: async ({ query }): Promise<SearchResponseT> => {
      const params = query as { q: string; regex?: string; icase?: string; word?: string; mask?: string; include?: string };
      const useRegex = flag(params.regex);
      const caseInsensitive = flag(params.icase);
      const wholeWord = flag(params.word);
      const fileMask = params.mask ?? '';
      const pattern = useRegex ? params.q : escapeRegExp(params.q);
      let regex: RegExp;
      try {
        regex = new RegExp(wholeWord ? `\\b${pattern}\\b` : pattern, caseInsensitive ? 'i' : '');
      } catch (error) {
        throw new RouteError('BAD_REQUEST', 'invalid search pattern', (error as Error).message);
      }
      const excludes = excludeSet(params.include);
      const results: { path: string; hits: { line: number; text: string }[] }[] = [];
      const walk = async (dir: string): Promise<void> => {
        if (results.length >= SEARCH_MAX_RESULTS) return;
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          if (results.length >= SEARCH_MAX_RESULTS) return;
          if (entry.name.startsWith('.') || excludes.has(entry.name)) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
            continue;
          }
          const relative = path.relative(workspace.root, full).split(path.sep).join('/');
          if (fileMask && !matchMask(relative, fileMask)) continue;
          const stat = await fs.stat(full);
          if (stat.size > SEARCH_MAX_FILE_BYTES) continue;
          const text = await fs.readFile(full, 'utf8').catch(() => '');
          const hits: { line: number; text: string }[] = [];
          text.split('\n').forEach((line, index) => {
            if (regex.test(line)) hits.push({ line: index + 1, text: line.replace(/\r$/, '').slice(0, SEARCH_HIT_TEXT_SLICE) });
          });
          if (hits.length) results.push({ path: relative, hits });
        }
      };
      await walk(workspace.root);
      return {
        query: params.q,
        total: results.reduce((sum, file) => sum + file.hits.length, 0),
        regex: useRegex,
        caseInsensitive,
        wholeWord,
        fileMask,
        results
      };
    }
  };
}

export function routeForSearchReplace(workspace: WorkspaceService): Route {
  return {
    method: 'POST',
    path: '/api/search/replace',
    body: SearchReplaceRequest,
    response: SearchReplaceResponse,
    handler: async ({ body }): Promise<SearchReplaceResponseT> => {
      const request = body as {
        query: string;
        replacement: string;
        approved: boolean;
        regex?: boolean;
        icase?: boolean;
        word?: boolean;
        mask?: string;
        include?: string;
      };
      if (request.approved !== true) throw new RouteError('FORBIDDEN', 'explicit approval required for workspace replace');
      const useRegex = request.regex === true;
      const caseInsensitive = request.icase === true;
      const wholeWord = request.word === true;
      const fileMask = request.mask ?? '';
      const pattern = useRegex ? request.query : escapeRegExp(request.query);
      let regex: RegExp;
      try {
        regex = new RegExp(wholeWord ? `\\b${pattern}\\b` : pattern, caseInsensitive ? 'i' : '');
      } catch (error) {
        throw new RouteError('BAD_REQUEST', 'invalid search pattern', (error as Error).message);
      }
      const globalPattern = new RegExp(useRegex ? request.query : escapeRegExp(request.query), caseInsensitive ? 'gi' : 'g');
      const excludes = excludeSet(request.include);
      let filesChanged = 0;
      let occurrences = 0;
      const SENSITIVE_PATHS = /^(credentials|secret|\.env|\.aide\/credentials|\.aide\/telegram|\.dpapi)/i;
      const walk = async (dir: string): Promise<void> => {
        if (occurrences >= SEARCH_MAX_OCCURRENCES) return;
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          if (occurrences >= SEARCH_MAX_OCCURRENCES) return;
          if (entry.name.startsWith('.') || excludes.has(entry.name)) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
            continue;
          }
          const relative = path.relative(workspace.root, full).split(path.sep).join('/');
          if (SENSITIVE_PATHS.test(relative)) continue;
          if (fileMask && !matchMask(relative, fileMask)) continue;
          const stat = await fs.stat(full);
          if (stat.size > SEARCH_MAX_FILE_BYTES) continue;
          const text = await fs.readFile(full, 'utf8').catch(() => null);
          if (text === null) continue;
          if (!regex.test(text)) continue;
          const changed = text.replace(globalPattern, request.replacement);
          if (changed === text) continue;
          const count = (text.match(globalPattern) || []).length;
          await workspace.write(relative, changed, true);
          filesChanged++;
          occurrences += count;
        }
      };
      await walk(workspace.root);
      return { files_changed: filesChanged, occurrences };
    }
  };
}