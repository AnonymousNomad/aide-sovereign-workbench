/// <reference lib="dom" />
/// <reference lib="webworker" />

import * as monaco from 'monaco-editor/editor/editor.api';
import { languageForPath } from './languages.ts';
import { sniffEol, hasBom, type Eol } from './text-io.ts';

export const MODEL_SCHEME = 'inmemory';

export interface ModelMeta {
  relPath: string;
  eol: Eol;
  bom: boolean;
  dirty: boolean;
  language: string;
}

const models = new Map<string, monaco.editor.ITextModel>();
const meta = new Map<string, ModelMeta>();
const dirtyListeners = new Set<() => void>();

export function uriFor(relPath: string): monaco.Uri {
  return monaco.Uri.parse(`${MODEL_SCHEME}://model/${relPath.replace(/\\/g, '/')}`);
}

export function relPathFor(uri: monaco.Uri): string {
  return decodeURIComponent(uri.path.replace(/^\//, '')).replace(/\//g, '\\');
}

export function openModel(relPath: string, content: string): monaco.editor.ITextModel {
  const existing = models.get(relPath);
  if (existing !== undefined) return existing;
  const language = languageForPath(relPath);
  const model = monaco.editor.createModel(content, language, uriFor(relPath));
  model.setEOL(sniffEol(content) === 'crlf' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF);
  models.set(relPath, model);
  meta.set(relPath, { relPath, eol: sniffEol(content), bom: hasBom(content), dirty: false, language });
  model.onDidChangeContent(() => {
    const m = meta.get(relPath);
    if (m !== undefined && !m.dirty) {
      m.dirty = true;
      for (const fn of dirtyListeners) fn();
    }
  });
  return model;
}

export function getModel(relPath: string): monaco.editor.ITextModel | undefined {
  return models.get(relPath);
}

export function disposeModel(relPath: string): void {
  const model = models.get(relPath);
  if (model !== undefined) {
    model.dispose();
    models.delete(relPath);
  }
  meta.delete(relPath);
  for (const fn of dirtyListeners) fn();
}

export function markClean(relPath: string): void {
  const m = meta.get(relPath);
  if (m !== undefined && m.dirty) {
    m.dirty = false;
    for (const fn of dirtyListeners) fn();
  }
}

export function isDirty(relPath: string): boolean {
  return meta.get(relPath)?.dirty ?? false;
}

export function metaFor(relPath: string): ModelMeta | undefined {
  return meta.get(relPath);
}

export function openPaths(): string[] {
  return [...models.keys()];
}

export function onDirtyChange(fn: () => void): () => void {
  dirtyListeners.add(fn);
  return () => {
    dirtyListeners.delete(fn);
  };
}