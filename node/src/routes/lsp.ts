import type { Route } from '../server.ts';
import { RouteError } from '../server.ts';
import type { LspManager, LspDiagnostic } from '../services/lsp.ts';
import type { MarkerT } from '../../../common/contracts/events.ts';
import {
  LspStatusResponse,
  LspStartRequest,
  LspStartResponse,
  LspOpenRequest,
  LspOpenResponse,
  LspCloseRequest,
  LspCloseResponse,
  LspChangeRequest,
  LspChangeResponse,
  LspFeatureRequest,
  LspCompletionResponse,
  LspHoverResponse,
  LspDefinitionResponse
} from '../../../common/contracts/lsp.ts';

const SEVERITY_LSP_TO_MONACO: Record<number, number> = { 1: 8, 2: 4, 3: 2, 4: 1 };

export function lspDiagnosticsToMarkers(diagnostics: LspDiagnostic[]): MarkerT[] {
  return diagnostics.map(diagnostic => {
    const start = diagnostic.range.start;
    const end = diagnostic.range.end;
    return {
      severity: SEVERITY_LSP_TO_MONACO[diagnostic.severity ?? 1] ?? 8,
      message: diagnostic.message,
      startLineNumber: start.line + 1,
      startColumn: start.character + 1,
      endLineNumber: end.line + 1,
      endColumn: end.character + 1
    };
  });
}

export function routeForLspStatus(manager: LspManager): Route {
  return {
    method: 'GET',
    path: '/api/lsp/status',
    response: LspStatusResponse,
    handler: () => ({ servers: manager.status() })
  };
}

export function routeForLspStart(manager: LspManager): Route {
  return {
    method: 'POST',
    path: '/api/lsp/start',
    body: LspStartRequest,
    response: LspStartResponse,
    handler: async ({ body }) => {
      const request = body as { languageId: string };
      let status: string;
      try {
        status = await manager.start(request.languageId);
      } catch (error) {
        throw new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'language server failed to start');
      }
      return { languageId: request.languageId, status: status as 'running' | 'starting' };
    }
  };
}

export function routeForLspOpen(manager: LspManager): Route {
  return {
    method: 'POST',
    path: '/api/lsp/open',
    body: LspOpenRequest,
    response: LspOpenResponse,
    handler: async ({ body }) => {
      const request = body as { uri: string; languageId: string; text: string };
      try {
        await manager.didOpen(request.uri, request.languageId, request.text);
      } catch (error) {
        throw new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'language server failed on open');
      }
      return { opened: true };
    }
  };
}

export function routeForLspClose(manager: LspManager): Route {
  return {
    method: 'POST',
    path: '/api/lsp/close',
    body: LspCloseRequest,
    response: LspCloseResponse,
    handler: async ({ body }) => {
      const request = body as { uri: string };
      try {
        await manager.didClose(request.uri);
      } catch (error) {
        throw new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'language server failed on close');
      }
      return { closed: true };
    }
  };
}

export function routeForLspChange(manager: LspManager): Route {
  return {
    method: 'POST',
    path: '/api/lsp/change',
    body: LspChangeRequest,
    response: LspChangeResponse,
    handler: async ({ body }) => {
      const request = body as { uri: string; text: string; version: number };
      try {
        await manager.didChange(request.uri, request.text, request.version);
      } catch (error) {
        throw new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'language server failed on change');
      }
      return { changed: true };
    }
  };
}

export function routeForLspCompletion(manager: LspManager): Route {
  return {
    method: 'POST',
    path: '/api/lsp/completion',
    body: LspFeatureRequest,
    response: LspCompletionResponse,
    handler: async ({ body }) => {
      const request = body as { uri: string; position: { line: number; character: number } };
      try {
        const items = await manager.completion(request.uri, request.position);
        return { items };
      } catch (error) {
        throw new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'language server failed on completion');
      }
    }
  };
}

export function routeForLspHover(manager: LspManager): Route {
  return {
    method: 'POST',
    path: '/api/lsp/hover',
    body: LspFeatureRequest,
    response: LspHoverResponse,
    handler: async ({ body }) => {
      const request = body as { uri: string; position: { line: number; character: number } };
      try {
        const contents = await manager.hover(request.uri, request.position);
        return { contents };
      } catch (error) {
        throw new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'language server failed on hover');
      }
    }
  };
}

export function routeForLspDefinition(manager: LspManager): Route {
  return {
    method: 'POST',
    path: '/api/lsp/definition',
    body: LspFeatureRequest,
    response: LspDefinitionResponse,
    handler: async ({ body }) => {
      const request = body as { uri: string; position: { line: number; character: number } };
      try {
        const locations = await manager.definition(request.uri, request.position);
        return { locations };
      } catch (error) {
        throw new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'language server failed on definition');
      }
    }
  };
}