/// <reference lib="dom" />
/// <reference lib="webworker" />

import * as monaco from 'monaco-editor/editor/editor.api';
import type { DiagnosticsEventT } from '../../../common/contracts/events.ts';
import { api } from '../services/api.ts';
import { getModel, relPathFor } from './models.ts';

const SUPPORTED_LANGUAGES: Record<string, string> = {
  typescript: 'typescript',
  javascript: 'javascript'
};

const CHANGE_DEBOUNCE_MS = 400;

function uriFor(relPath: string): string {
  return `file:///${relPath.replace(/\\/g, '/')}`;
}

export interface LspBridge {
  onOpen(relPath: string, languageId: string): void;
  onChange(relPath: string, version: number): void;
  onSave(relPath: string): void;
  onClose(relPath: string): void;
}

export const nullLsp: LspBridge = {
  onOpen() {},
  onChange() {},
  onSave() {},
  onClose() {}
};

export class ArchLspBridge implements LspBridge {
  private readonly open = new Set<string>();
  private readonly versions = new Map<string, number>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  onOpen(relPath: string, languageId: string): void {
    const lspLanguageId = SUPPORTED_LANGUAGES[languageId];
    if (lspLanguageId === undefined) {
      console.warn(`[lsp] unsupported language '${languageId}' for ${relPath}`);
      return;
    }
    this.open.add(relPath);
    const text = getModel(relPath)?.getValue() ?? '';
    this.versions.set(relPath, 1);
    void api.lspOpen(uriFor(relPath), lspLanguageId, text).catch(() => {});
  }

  onChange(relPath: string): void {
    if (!this.open.has(relPath)) return;
    const existing = this.timers.get(relPath);
    if (existing !== undefined) clearTimeout(existing);
    const version = (this.versions.get(relPath) ?? 1) + 1;
    this.versions.set(relPath, version);
    this.timers.set(
      relPath,
      setTimeout(() => {
        void api.lspChange(uriFor(relPath), getModel(relPath)?.getValue() ?? '', version).catch(() => {});
      }, CHANGE_DEBOUNCE_MS)
    );
  }

  onSave(): void {}

  onClose(relPath: string): void {
    const timer = this.timers.get(relPath);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(relPath);
    }
    this.versions.delete(relPath);
    if (!this.open.delete(relPath)) return;
    void api.lspClose(uriFor(relPath)).catch(() => {});
  }
}

export function applyDiagnostics(event: DiagnosticsEventT): void {
  const model = getModel(relPathFor(monaco.Uri.parse(event.uri)));
  if (model === undefined) return;
  monaco.editor.setModelMarkers(
    model,
    'aide.lsp',
    event.markers.map(marker => ({
      severity: marker.severity as monaco.MarkerSeverity,
      message: marker.message,
      startLineNumber: marker.startLineNumber,
      startColumn: marker.startColumn,
      endLineNumber: marker.endLineNumber,
      endColumn: marker.endColumn
    }))
  );
}