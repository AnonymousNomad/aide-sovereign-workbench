import { RouteError, type Route } from '../server.ts';
import {
  QuickOpenQuery,
  QuickOpenResponse,
  RgFileListResponse,
  RgSearchRequest,
  RgSearchResponse,
  type QuickOpenQueryT,
  type QuickOpenResponseT,
  type RgFileListResponseT,
  type RgSearchRequestT,
  type RgSearchResponseT
} from '../../../common/contracts/rg-search.ts';
import type { RgService } from '../../../node/src/services/rg-service.mjs';

export function routeForRgQuickOpen(service: RgService): Route {
  return {
    method: 'GET',
    path: '/api/rg/quick-open',
    query: QuickOpenQuery,
    response: QuickOpenResponse,
    handler: async ({ query }): Promise<QuickOpenResponseT> => {
      const input = query as unknown as QuickOpenQueryT;
      try {
        return await service.quickOpen(input.q, input.limit ?? 50);
      } catch (error) {
        throw new RouteError('NOT_READY', String((error as Error).message));
      }
    }
  };
}

export function routeForRgFiles(service: RgService): Route {
  return {
    method: 'GET',
    path: '/api/rg/files',
    response: RgFileListResponse,
    handler: async (): Promise<RgFileListResponseT> => {
      try {
        const result = await service.listFiles();
        return { files: result.files, truncated: result.truncated };
      } catch (error) {
        throw new RouteError('NOT_READY', String((error as Error).message));
      }
    }
  };
}

export function routeForRgSearch(service: RgService): Route {
  return {
    method: 'POST',
    path: '/api/rg/search',
    body: RgSearchRequest,
    response: RgSearchResponse,
    handler: async ({ body }): Promise<RgSearchResponseT> => {
      const input = body as unknown as RgSearchRequestT;
      try {
        return await service.search({
          query: input.query,
          ...(input.isRegex !== undefined ? { isRegex: input.isRegex } : {}),
          ...(input.caseSensitive !== undefined ? { caseSensitive: input.caseSensitive } : {}),
          ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
          ...(input.fileGlob !== undefined ? { fileGlob: input.fileGlob } : {})
        });
      } catch (error) {
        const message = String((error as Error).message);
        if (/regex parse error/i.test(message)) throw new RouteError('BAD_REQUEST', message);
        if (/ripgrep not found/i.test(message)) throw new RouteError('NOT_READY', message);
        throw new RouteError('BAD_RESPONSE', message);
      }
    }
  };
}
