/// <reference lib="dom" />
/// <reference lib="webworker" />

import * as monaco from 'monaco-editor/editor/editor.api';

export interface EditorView {
  relPath: string;
  editor: monaco.editor.IStandaloneCodeEditor;
}

const views = new Map<string, EditorView>();
let nextId = 0;

export function createView(container: HTMLElement, relPath: string, model: monaco.editor.ITextModel): EditorView {
  const editor = monaco.editor.create(container, {
    model,
    theme: 'vs-dark',
    fontSize: 13,
    fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
    automaticLayout: true,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    tabSize: 2,
    wordWrap: 'off',
    renderWhitespace: 'selection',
    find: { addExtraSpaceOnTop: false }
  });
  const view: EditorView = { relPath, editor };
  views.set(`${relPath}#${nextId++}`, view);
  return view;
}

export function saveViewState(relPath: string): monaco.editor.ICodeEditorViewState | null {
  const view = [...views.values()].find(v => v.relPath === relPath);
  return view ? view.editor.saveViewState() : null;
}

export function restoreViewState(relPath: string, state: monaco.editor.ICodeEditorViewState | null | undefined): void {
  const view = [...views.values()].find(v => v.relPath === relPath);
  if (view !== undefined && state !== null && state !== undefined) view.editor.restoreViewState(state);
}

export function disposeViewFor(relPath: string): void {
  for (const [key, view] of views) {
    if (view.relPath === relPath) {
      view.editor.dispose();
      views.delete(key);
    }
  }
}

export function disposeAllViews(): void {
  for (const view of views.values()) view.editor.dispose();
  views.clear();
}

export function focusView(relPath: string): void {
  const view = [...views.values()].find(v => v.relPath === relPath);
  view?.editor.focus();
}