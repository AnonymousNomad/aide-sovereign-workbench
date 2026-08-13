export class EditorGroups {
  constructor(groupId = 'A') {
    this.groups = [{ id: groupId, tabs: [], active: null }];
    this.activeGroup = 0;
    this.mru = [];
  }

  #group(index) {
    const group = this.groups[index];
    if (!group) throw new Error('editor group does not exist');
    return group;
  }

  #touch(file) {
    this.mru = [file, ...this.mru.filter(item => item !== file)];
  }

  open(groupIndex, file) {
    const group = this.#group(groupIndex);
    if (!group.tabs.includes(file)) group.tabs.push(file);
    group.active = file;
    this.#touch(file);
    return this.state();
  }

  split(file) {
    this.groups.push({ id: `group-${this.groups.length + 1}`, tabs: file ? [file] : [], active: file || null });
    this.activeGroup = this.groups.length - 1;
    if (file) this.#touch(file);
    return this.state();
  }

  closeGroup(index) {
    if (this.groups.length === 1) return this.state();
    this.#group(index);
    this.groups.splice(index, 1);
    if (this.activeGroup >= this.groups.length) this.activeGroup = this.groups.length - 1;
    return this.state();
  }

  #locate(file) {
    const activeGroup = this.groups[this.activeGroup];
    if (activeGroup && activeGroup.active === file) return this.activeGroup;
    if (activeGroup && activeGroup.tabs.includes(file)) return this.activeGroup;
    const activeMatch = this.groups.findIndex(group => group.active === file);
    if (activeMatch >= 0) return activeMatch;
    return this.groups.findIndex(group => group.tabs.includes(file));
  }

  closeTab(file) {
    const index = this.#locate(file);
    if (index < 0) return this.state();
    const group = this.groups[index];
    group.tabs = group.tabs.filter(tab => tab !== file);
    if (group.active === file) {
      const empty = group.tabs.length === 0;
      group.active = empty ? null : group.tabs.at(-1);
      if (empty && this.groups.length > 1) this.closeGroup(index);
    }
    this.mru = this.mru.filter(item => item !== file);
    return this.state();
  }

  move(file, toGroupIndex) {
    const from = this.#locate(file);
    if (from < 0) throw new Error('tab is not open in any group');
    const target = this.#group(toGroupIndex);
    this.#group(from).tabs = this.#group(from).tabs.filter(tab => tab !== file);
    if (this.groups[from].active === file) this.groups[from].active = this.groups[from].tabs.at(-1) || null;
    if (!target.tabs.includes(file)) target.tabs.push(file);
    target.active = file;
    this.activeGroup = toGroupIndex;
    this.#touch(file);
    return this.state();
  }

  activate(file) {
    const index = this.#locate(file);
    if (index < 0) return this.state();
    this.groups[index].active = file;
    this.activeGroup = index;
    this.#touch(file);
    return this.state();
  }

  nextGroup() {
    this.activeGroup = (this.activeGroup + 1) % this.groups.length;
    return this.state();
  }

  mruOrder() {
    return this.mru;
  }

  state() {
    return {
      groups: this.groups.map(group => ({ id: group.id, tabs: [...group.tabs], active: group.active })),
      activeGroup: this.groups[this.activeGroup].id,
      mru: [...this.mru]
    };
  }
}
if (typeof window !== 'undefined') {
  window.EditorGroups = EditorGroups;
}
