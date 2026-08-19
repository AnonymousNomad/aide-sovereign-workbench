/// <reference lib="dom" />
/// <reference lib="webworker" />

import * as monaco from 'monaco-editor/editor/editor.api';

export interface EditorView {
  relPath: string;
  splitId: string;
  editor: monaco.editor.IStandaloneCodeEditor;
}

const views = new Map<string, EditorView>();
let nextId = 0;

function key(relPath: string, splitId: string): string {
  return `${relPath}@${splitId}#${nextId++}`;
}

export function createView(container: HTMLElement, relPath: string, splitId: string, model: monaco.editor.ITextModel): EditorView {
  const editor = monaco.editor.create(container, {
    model,
    theme: 'vs-dark',
    fontSize: 13,
    fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace",
    automaticLayout: true,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    tabSize: 2,
    wordWrap: 'off',
    renderWhitespace: 'selection',
    find: { addExtraSpaceOnTop: false }
  });
  const view: EditorView = { relPath, splitId, editor };
  views.set(key(relPath, splitId), view);
  return view;
}

export function saveViewState(relPath: string, splitId: string): monaco.editor.ICodeEditorViewState | null {
  const view = findView(relPath, splitId);
  return view === undefined ? null : view.editor.saveViewState();
}

export function restoreViewState(relPath: string, splitId: string, state: monaco.editor.ICodeEditorViewState | null | undefined): void {
  const view = findView(relPath, splitId);
  if (view !== undefined && state !== null && state !== undefined) view.editor.restoreViewState(state);
}

export function disposeViewFor(relPath: string, splitId: string): void {
  for (const [key, view] of views) {
    if (view.relPath === relPath && view.splitId === splitId) {
      view.editor.dispose();
      views.delete(key);
    }
  }
}

export function disposeAllViews(): void {
  for (const view of views.values()) view.editor.dispose();
  views.clear();
}

export function focusView(relPath: string, splitId: string): void {
  const view = findView(relPath, splitId);
  view?.editor.focus();
}

export function revealLine(relPath: string, splitId: string, line: number): void {
  const view = findView(relPath, splitId);
  if (view === undefined) return;
  const position = { lineNumber: line, column: 1 };
  view.editor.setPosition(position);
  view.editor.revealLineInCenter(line);
  view.editor.focus();
}

function findView(relPath: string, splitId: string): EditorView | undefined {
  return [...views.values()].find(v => v.relPath === relPath && v.splitId === splitId);
}