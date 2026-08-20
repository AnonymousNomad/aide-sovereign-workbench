/// <reference lib="dom" />
/// <reference lib="webworker" />

import * as monaco from 'monaco-editor/editor/editor.api';
import { api } from '../services/api.ts';
import { getModel, relPathFor } from './models.ts';
import type { EditorHost } from './host.ts';

const LSP_KIND_TO_MONACO: Record<number, monaco.languages.CompletionItemKind> = {
  1: monaco.languages.CompletionItemKind.Text,
  2: monaco.languages.CompletionItemKind.Method,
  3: monaco.languages.CompletionItemKind.Function,
  4: monaco.languages.CompletionItemKind.Constructor,
  5: monaco.languages.CompletionItemKind.Field,
  6: monaco.languages.CompletionItemKind.Variable,
  7: monaco.languages.CompletionItemKind.Class,
  8: monaco.languages.CompletionItemKind.Interface,
  9: monaco.languages.CompletionItemKind.Module,
  10: monaco.languages.CompletionItemKind.Property,
  11: monaco.languages.CompletionItemKind.Unit,
  12: monaco.languages.CompletionItemKind.Value,
  13: monaco.languages.CompletionItemKind.Enum,
  14: monaco.languages.CompletionItemKind.Keyword,
  15: monaco.languages.CompletionItemKind.Snippet,
  16: monaco.languages.CompletionItemKind.Color,
  17: monaco.languages.CompletionItemKind.File,
  18: monaco.languages.CompletionItemKind.Reference,
  19: monaco.languages.CompletionItemKind.Folder,
  20: monaco.languages.CompletionItemKind.EnumMember,
  21: monaco.languages.CompletionItemKind.Constant,
  22: monaco.languages.CompletionItemKind.Struct,
  23: monaco.languages.CompletionItemKind.Event,
  24: monaco.languages.CompletionItemKind.Operator,
  25: monaco.languages.CompletionItemKind.TypeParameter
};

function uriForRelPath(relPath: string): string {
  return `file:///${relPath.replace(/\\/g, '/')}`;
}

function relPathForModel(model: monaco.editor.ITextModel): string | undefined {
  if (model.uri.scheme !== 'inmemory') return undefined;
  const relPath = relPathFor(model.uri);
  return getModel(relPath) === model ? relPath : undefined;
}

function lspPosition(position: monaco.Position): { line: number; character: number } {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

const RETRY_DELAY_MS = 800;

async function withOpenRetry<T>(fn: () => Promise<T>, fallback: () => T): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      return await fn();
    } catch {
      return fallback();
    }
  }
}

export function registerLspProviders(host: EditorHost): void {
  for (const languageId of ['typescript', 'javascript']) {
    monaco.languages.registerCompletionItemProvider(languageId, {
      triggerCharacters: ['.'],
      provideCompletionItems: async (model, position) => {
        const relPath = relPathForModel(model);
        if (relPath === undefined) return { suggestions: [] };
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };
        try {
        const items = await withOpenRetry(
          () => api.lspCompletion(uriForRelPath(relPath), lspPosition(position)),
          () => [] as Awaited<ReturnType<typeof api.lspCompletion>>
        );
        return {
          suggestions: items.map(item => {
            const suggestion: monaco.languages.CompletionItem = {
              label: item.label,
              kind: item.kind === undefined ? monaco.languages.CompletionItemKind.Text : LSP_KIND_TO_MONACO[item.kind] ?? monaco.languages.CompletionItemKind.Text,
              insertText: item.insertText ?? item.label,
              range
            };
            if (item.detail !== undefined) suggestion.detail = item.detail;
            if (item.sortText !== undefined) suggestion.sortText = item.sortText;
            return suggestion;
          })
        };
        } catch {
          return { suggestions: [] };
        }
      }
    });

    monaco.languages.registerHoverProvider(languageId, {
      provideHover: async (model, position) => {
        const relPath = relPathForModel(model);
        if (relPath === undefined) return null;
        try {
          const contents = await withOpenRetry(
            () => api.lspHover(uriForRelPath(relPath), lspPosition(position)),
            () => ''
          );
          if (contents.length === 0) return null;
          return { contents: [{ value: contents }] };
        } catch {
          return null;
        }
      }
    });

    monaco.languages.registerDefinitionProvider(languageId, {
      provideDefinition: async (model, position) => {
        const relPath = relPathForModel(model);
        if (relPath === undefined) return [];
        try {
          const locations = await withOpenRetry(
            () => api.lspDefinition(uriForRelPath(relPath), lspPosition(position)),
            () => [] as Awaited<ReturnType<typeof api.lspDefinition>>
          );
          if (locations.length === 0) return [];
          const first = locations[0]!;
          const targetRelPath = relPathFor(monaco.Uri.parse(first.uri));
          if (targetRelPath === relPath) {
            return [{
              uri: model.uri,
              range: {
                startLineNumber: first.range.start.line + 1,
                startColumn: first.range.start.character + 1,
                endLineNumber: first.range.end.line + 1,
                endColumn: first.range.end.character + 1
              }
            }];
          }
          void host.open(targetRelPath, first.range.start.line + 1);
          return [];
        } catch {
          return [];
        }
      }
    });
  }
}