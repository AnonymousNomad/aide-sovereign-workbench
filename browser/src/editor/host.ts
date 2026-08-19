/// <reference lib="dom" />
/// <reference lib="webworker" />

import * as monaco from 'monaco-editor/editor/editor.api';
import type { FileReadResponseT } from '../../../common/contracts/file.ts';
import type { SessionFileT, SessionTabT } from '../../../common/contracts/session.ts';
import type { SessionService } from '../services/session.ts';
import { api } from '../services/api.ts';
import { openModel, disposeModel, markClean, isDirty, openPaths, getModel, metaFor } from './models.ts';
import { createView, disposeViewFor, focusView, restoreViewState, saveViewState, revealLine, disposeAllViews } from './views.ts';
import type { GroupsManager, EditorGroup } from './groups.ts';
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
  split(direction: 'vertical' | 'horizontal'): Promise<void>;
  closeGroup(): Promise<void>;
  activePath(): string | null;
  groups(): { id: string; tabBar: HTMLElement }[];
  tabsIn(splitId: string): string[];
  captureSession(): SessionFileT;
  restoreSession(session: SessionFileT): Promise<void>;
}

export function createEditorHost(
  groups: GroupsManager,
  session: SessionService,
  opts: EditorHostOptions = {},
  lsp: LspBridge = { onOpen() {}, onChange() {}, onSave() {}, onClose() {} }
): EditorHost {
  const confirmDirty = opts.confirmDirty ?? (() => true);
  const notify = (): void => opts.onTabChange?.();
  const tabs = new Map<string, Set<string>>();

  function tabsOf(splitId: string): Set<string> {
    let set = tabs.get(splitId);
    if (set === undefined) {
      set = new Set();
      tabs.set(splitId, set);
    }
    return set;
  }

  async function openView(group: EditorGroup, relPath: string, line?: number, viewState?: monaco.editor.ICodeEditorViewState): Promise<void> {
    const model = getModel(relPath);
    if (model === undefined) {
      await readInto(group, relPath, viewState);
      if (line !== undefined) revealLine(relPath, group.id, line);
      return;
    }
    disposeViewFor(relPath, group.id);
    const view = createView(group.editorEl, relPath, group.id, model);
    view.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void save(relPath);
    });
    restoreViewState(relPath, group.id, viewState);
    focusView(relPath, group.id);
    group.active = relPath;
    tabsOf(group.id).add(relPath);
    if (line !== undefined) revealLine(relPath, group.id, line);
    notify();
  }

  async function readInto(group: EditorGroup, relPath: string, viewState?: monaco.editor.ICodeEditorViewState): Promise<void> {
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
    disposeViewFor(relPath, group.id);
    const view = createView(group.editorEl, relPath, group.id, model);
    view.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void save(relPath);
    });
    restoreViewState(relPath, group.id, viewState);
    focusView(relPath, group.id);
    group.active = relPath;
    tabsOf(group.id).add(relPath);
    markClean(relPath);
    lsp.onOpen(relPath, model.getLanguageId());
    notify();
  }

  async function open(relPath: string, line?: number): Promise<void> {
    const group = groups.active();
    if (group === null) return;
    const previous = group.active;
    if (previous !== null && previous !== relPath) saveViewState(previous, group.id);
    await openView(group, relPath, line);
  }

  function activate(relPath: string): void {
    const group = groups.active();
    if (group === null) return;
    if (!tabsOf(group.id).has(relPath)) return;
    const previous = group.active;
    if (previous !== null && previous !== relPath) saveViewState(previous, group.id);
    const model = getModel(relPath);
    if (model === undefined) return;
    disposeViewFor(relPath, group.id);
    const view = createView(group.editorEl, relPath, group.id, model);
    view.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void save(relPath);
    });
    const tab = session.current.tabs.find(t => uriToRelPath(t.uri) === relPath && (t.splitId ?? group.id) === group.id);
    restoreViewState(relPath, group.id, tab?.viewState as monaco.editor.ICodeEditorViewState | undefined);
    focusView(relPath, group.id);
    group.active = relPath;
    notify();
  }

  async function save(relPath: string): Promise<boolean> {
    const model = getModel(relPath);
    if (model === undefined) return false;
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
    const group = groups.active();
    if (group === null) return;
    if (isDirty(relPath) && !confirmDirty(relPath)) return;
    saveViewState(relPath, group.id);
    disposeViewFor(relPath, group.id);
    tabsOf(group.id).delete(relPath);
    if (group.active === relPath) group.active = null;
    const stillOpen = [...tabs.values()].some(set => set.has(relPath));
    if (!stillOpen) {
      lsp.onClose(relPath);
      disposeModel(relPath);
    }
    notify();
  }

  async function split(direction: 'vertical' | 'horizontal'): Promise<void> {
    const source = groups.active();
    if (source === null) return;
    const previous = source.active;
    if (previous !== null) saveViewState(previous, source.id);
    const fresh = groups.split(direction);
    if (fresh === null) return;
    if (previous !== null && getModel(previous) !== undefined) {
      disposeViewFor(previous, fresh.id);
      const view = createView(fresh.editorEl, previous, fresh.id, getModel(previous)!);
      view.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void save(previous);
      });
      focusView(previous, fresh.id);
      fresh.active = previous;
      tabsOf(fresh.id).add(previous);
    }
    notify();
  }

  async function closeGroup(): Promise<void> {
    const group = groups.active();
    if (group === null) return;
    const paths = [...tabsOf(group.id)];
    for (const relPath of paths) {
      if (isDirty(relPath) && !confirmDirty(relPath)) return;
    }
    for (const relPath of paths) {
      saveViewState(relPath, group.id);
      disposeViewFor(relPath, group.id);
      tabsOf(group.id).delete(relPath);
      const stillOpen = [...tabs.values()].some(set => set.has(relPath));
      if (!stillOpen) {
        lsp.onClose(relPath);
        disposeModel(relPath);
      }
    }
    tabs.delete(group.id);
    groups.closeGroup(group.id);
    notify();
  }

  function captureSession(): SessionFileT {
    const sessionTabs: SessionTabT[] = [];
    for (const [splitId, paths] of tabs) {
      for (const relPath of paths) {
        sessionTabs.push({
          uri: relPathToUri(relPath),
          splitId,
          dirty: isDirty(relPath),
          viewState: saveViewState(relPath, splitId) ?? undefined
        });
      }
    }
    const activeGroup = groups.active();
    const activePath = activeGroup === null ? null : activeGroup.active;
    return {
      version: 1,
      activeTab: activePath === null ? undefined : relPathToUri(activePath),
      tabs: sessionTabs,
      splits: groups.list().map(g => g.id)
    };
  }

  async function restoreSession(session: SessionFileT): Promise<void> {
    const ids = session.splits !== undefined && session.splits.length > 0 ? session.splits : ['g1'];
    disposeAllViews();
    groups.setLayout(ids);
    tabs.clear();
    const bySplit = new Map<string, SessionTabT[]>();
    for (const tab of session.tabs) {
      const splitId = tab.splitId ?? ids[0]!;
      const list = bySplit.get(splitId);
      if (list === undefined) bySplit.set(splitId, [tab]);
      else list.push(tab);
    }
    for (const [splitId, tabsList] of bySplit) {
      const group = groups.groupFor(splitId);
      if (group === undefined) continue;
for (const tab of tabsList) {
        const relPath = uriToRelPath(tab.uri);
        try {
          await readInto(group, relPath, tab.viewState as monaco.editor.ICodeEditorViewState | undefined);
        } catch {
          // one unreadable tab must not kill the whole restore
        }
      }
    }
    if (session.activeTab !== undefined) {
      const relPath = uriToRelPath(session.activeTab);
      const holder = [...tabs.entries()].find(([, paths]) => paths.has(relPath));
      if (holder !== undefined) {
        groups.activateGroup(holder[0]);
        activate(relPath);
      }
    }
    notify();
  }

  return {
    open,
    activate,
    save,
    saveAll,
    close,
    split,
    closeGroup,
    activePath: () => groups.active()?.active ?? null,
    groups: () => groups.list().map(g => ({ id: g.id, tabBar: g.tabBar })),
    tabsIn: splitId => [...(tabs.get(splitId) ?? [])],
    captureSession,
    restoreSession
  };
}

function relPathToUri(relPath: string): string {
  return `file:///${relPath.replace(/\\/g, '/')}`;
}

function uriToRelPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, '').replace(/^\//, '')).replace(/\//g, '\\');
}
