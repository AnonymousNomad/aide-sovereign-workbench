/// <reference lib="dom" />
/// <reference lib="webworker" />

import * as monaco from 'monaco-editor/editor/editor.api';
import type { FileReadResponseT } from '../../../common/contracts/file.ts';
import type { SessionFileT } from '../../../common/contracts/session.ts';
import type { SessionService } from '../services/session.ts';
import { api } from '../services/api.ts';
import { openModel, disposeModel, markClean, isDirty, openPaths, metaFor } from './models.ts';
import { createView, disposeViewFor, focusView, restoreViewState, saveViewState, revealLine } from './views.ts';
import { applyEol, restoreBom } from './text-io.ts';
import type { LspBridge } from './lsp-bridge.ts';

export interface EditorHostOptions {
  confirmDirty?: (relPath: string) => boolean;
  onTabChange?: () => void;
  onToast?: (code: string, message: string) => void;
}

export interface EditorHost {
  open(relPath: string, line?: number): Promise<void>;
  activate(relPath: string): void;
  save(relPath: string): Promise<boolean>;
  saveAll(): Promise<void>;
  close(relPath: string): Promise<void>;
  activePath(): string | null;
  captureSession(): SessionFileT;
  restoreSession(session: SessionFileT, openFile: (relPath: string) => Promise<void>): Promise<void>;
}

export function createEditorHost(
  container: HTMLElement,
  session: SessionService,
  opts: EditorHostOptions = {},
  lsp: LspBridge = { onOpen() {}, onChange() {}, onSave() {}, onClose() {} }
): EditorHost {
  let active: string | null = null;
  const confirmDirty = opts.confirmDirty ?? (() => true);
  const notify = (): void => opts.onTabChange?.();

  async function open(relPath: string, line?: number): Promise<void> {
    let file: FileReadResponseT;
    try {
      file = await api.fileRead(relPath);
    } catch (error) {
      opts.onToast?.('NOT_READY', error instanceof Error ? error.message : 'open failed');
      return;
    }
    if (file.too_large) {
      opts.onToast?.('PAYLOAD_TOO_LARGE', `${relPath} is ${file.size} bytes (limit 1 MiB)`);
      return;
    }
    const model = openModel(relPath, file.content ?? '');
    disposeViewFor(relPath);
    const view = createView(container, relPath, model);
    view.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void save(relPath);
    });
    focusView(relPath);
    active = relPath;
    markClean(relPath);
    lsp.onOpen(relPath, model.getLanguageId());
    notify();
    if (line !== undefined) revealLine(relPath, line);
  }

  function activate(relPath: string): void {
    const model = openPaths().includes(relPath) ? getModelFor(relPath) : null;
    if (model === null) return;
    if (active !== null) saveViewState(active);
    disposeViewFor(relPath);
    const view = createView(container, relPath, model);
    view.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void save(relPath);
    });
    const tab = session.current.tabs.find(t => uriToRelPath(t.uri) === relPath);
    restoreViewState(relPath, tab?.viewState as monaco.editor.ICodeEditorViewState | undefined);
    focusView(relPath);
    active = relPath;
    notify();
  }

  async function save(relPath: string): Promise<boolean> {
    const model = openPaths().includes(relPath) ? getModelFor(relPath) : null;
    if (model === null) return false;
    const m = metaFor(relPath);
    const eol = m?.eol ?? 'lf';
    const bom = m?.bom ?? false;
    const content = restoreBom(applyEol(model.getValue(), eol), bom);
    try {
      await api.fileWrite(relPath, content);
      markClean(relPath);
      lsp.onSave(relPath);
      notify();
      return true;
    } catch (error) {
      opts.onToast?.('COMMIT_FAILED', error instanceof Error ? error.message : 'save failed');
      return false;
    }
  }

  async function saveAll(): Promise<void> {
    for (const relPath of openPaths()) await save(relPath);
  }

  async function close(relPath: string): Promise<void> {
    if (isDirty(relPath) && !confirmDirty(relPath)) return;
    saveViewState(relPath);
    lsp.onClose(relPath);
    disposeViewFor(relPath);
    disposeModel(relPath);
    if (active === relPath) active = null;
    notify();
  }

  function captureSession(): SessionFileT {
    return {
      version: 1,
      tabs: openPaths().map(relPath => ({
        uri: relPathToUri(relPath),
        dirty: isDirty(relPath),
        viewState: saveViewState(relPath) ?? undefined
      }))
    };
  }

  async function restoreSession(session: SessionFileT, openFile: (relPath: string) => Promise<void>): Promise<void> {
    for (const tab of session.tabs) {
      const relPath = uriToRelPath(tab.uri);
      await openFile(relPath);
      if (tab.viewState !== undefined) restoreViewState(relPath, tab.viewState as monaco.editor.ICodeEditorViewState);
    }
  }

  return { open, activate, save, saveAll, close, activePath: () => active, captureSession, restoreSession };
}

function relPathToUri(relPath: string): string {
  return `file:///${relPath.replace(/\\/g, '/')}`;
}

function uriToRelPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, '')).replace(/\//g, '\\');
}

function getModelFor(relPath: string): monaco.editor.ITextModel {
  return openModel(relPath, '');
}