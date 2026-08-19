export const GROUP_MAX = 8;

export interface EditorGroup {
  id: string;
  element: HTMLElement;
  tabBar: HTMLElement;
  editorEl: HTMLElement;
  active: string | null;
}

export interface GroupsOptions {
  onSplit: (direction: 'vertical' | 'horizontal') => void;
  onCloseGroup: () => void;
}

export interface GroupsManager {
  list(): EditorGroup[];
  groupFor(id: string): EditorGroup | undefined;
  active(): EditorGroup | null;
  activateGroup(id: string): void;
  setLayout(ids: string[]): void;
  split(direction: 'vertical' | 'horizontal'): EditorGroup | null;
  closeGroup(id: string): boolean;
  onGroupsChange(fn: () => void): () => void;
  dispose(): void;
}

let nextGroupId = 1;

function createGroupElement(id: string, opts: GroupsOptions): EditorGroup {
  const element = document.createElement('div');
  element.className = 'group';
  element.dataset.group = id;

  const toolbar = document.createElement('div');
  toolbar.className = 'group-toolbar';
  const label = document.createElement('span');
  label.className = 'group-id';
  label.textContent = id;
  const splitVertical = document.createElement('button');
  splitVertical.type = 'button';
  splitVertical.title = 'Split right';
  splitVertical.textContent = '\u2192';
  splitVertical.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation();
    opts.onSplit('vertical');
  });
  const splitHorizontal = document.createElement('button');
  splitHorizontal.type = 'button';
  splitHorizontal.title = 'Split below';
  splitHorizontal.textContent = '\u2193';
  splitHorizontal.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation();
    opts.onSplit('horizontal');
  });
  const close = document.createElement('button');
  close.type = 'button';
  close.title = 'Close group';
  close.textContent = '\u00d7';
  close.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation();
    opts.onCloseGroup();
  });
  toolbar.append(label, splitVertical, splitHorizontal, close);

  const tabBar = document.createElement('div');
  tabBar.className = 'tab-bar group-tabbar';

  const editorEl = document.createElement('div');
  editorEl.className = 'group-editor';

  element.append(toolbar, tabBar, editorEl);

  return { id, element, tabBar, editorEl, active: null };
}

export function createGroups(root: HTMLElement, opts: GroupsOptions): GroupsManager {
  const groups = new Map<string, EditorGroup>();
  let activeId: string | null = null;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const fn of listeners) fn();
  };

  const activateGroup = (id: string): void => {
    const target = groups.get(id);
    if (target === undefined) return;
    activeId = id;
    for (const group of groups.values()) {
      group.element.classList.toggle('active', group.id === id);
    }
    notify();
  };

  const addGroup = (id: string): EditorGroup => {
    const group = createGroupElement(id, opts);
    groups.set(id, group);
    group.element.addEventListener('click', () => activateGroup(id));
    return group;
  };

  const manager: GroupsManager = {
    list(): EditorGroup[] {
      return [...groups.values()];
    },
    groupFor(id: string): EditorGroup | undefined {
      return groups.get(id);
    },
    active(): EditorGroup | null {
      return activeId === null ? null : (groups.get(activeId) ?? null);
    },
    activateGroup,
    setLayout(ids: string[]): void {
      root.textContent = '';
      groups.clear();
      activeId = null;
      for (const id of ids) {
        const group = addGroup(id);
        group.element.style.flex = '1 1 0';
        root.appendChild(group.element);
      }
      const first = groups.values().next().value as EditorGroup | undefined;
      if (first !== undefined) activateGroup(first.id);
      notify();
    },
    split(direction: 'vertical' | 'horizontal'): EditorGroup | null {
      if (groups.size >= GROUP_MAX) return null;
      const current = activeId === null ? null : (groups.get(activeId) ?? null);
      if (current === null) return null;
      const id = `g${nextGroupId++}`;
      const fresh = addGroup(id);
      const wrap = document.createElement('div');
      wrap.className = 'group-pane';
      wrap.style.display = 'flex';
      wrap.style.flexDirection = direction === 'horizontal' ? 'column' : 'row';
      wrap.style.flex = '1 1 0';
      wrap.style.minWidth = '0';
      wrap.style.minHeight = '0';
      const parent = current.element.parentElement;
      if (parent === null) return null;
      parent.insertBefore(wrap, current.element);
      wrap.appendChild(current.element);
      wrap.appendChild(fresh.element);
      for (const child of [current.element, fresh.element]) {
        child.style.flex = '1 1 0';
        child.style.minWidth = '0';
        child.style.minHeight = '0';
      }
      activateGroup(fresh.id);
      notify();
      return fresh;
    },
    closeGroup(id: string): boolean {
      if (groups.size <= 1) return false;
      const group = groups.get(id);
      if (group === undefined) return false;
      groups.delete(id);
      group.element.remove();
      if (activeId === id) {
        const remaining = groups.values().next().value as EditorGroup | undefined;
        activeId = remaining === undefined ? null : remaining.id;
      }
      let el = group.element;
      while (el.parentElement !== null && el.parentElement.classList.contains('group-pane') && el.parentElement.children.length === 1) {
        const parent = el.parentElement;
        const child = parent.children[0] as HTMLElement;
        parent.replaceWith(child);
        el = child;
      }
      for (const remaining of groups.values()) {
        remaining.element.classList.toggle('active', remaining.id === activeId);
      }
      notify();
      return true;
    },
    onGroupsChange(fn: () => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    dispose(): void {
      root.textContent = '';
      groups.clear();
      listeners.clear();
    }
  };

  return manager;
}