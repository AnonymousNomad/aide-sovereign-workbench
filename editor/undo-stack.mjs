export function diffOperation(before, after) {
  let prefix = 0;
  const max = Math.min(before.length, after.length);
  while (prefix < max && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const deleted = before.slice(prefix, before.length - suffix);
  const inserted = after.slice(prefix, after.length - suffix);
  const operations = [];
  if (deleted.length) operations.push({ type: 'delete', start: prefix, length: deleted.length, deleted });
  if (inserted.length) operations.push({ type: 'insert', start: prefix, text: inserted });
  return operations;
}

export class UndoStack {
  constructor(initial = '') {
    this.base = initial;
    this.ops = [];
    this.position = 0;
    this.baseline = 0;
  }

  text() {
    let text = this.base;
    for (let i = 0; i < this.position; i++) {
      const op = this.ops[i];
      if (op.type === 'insert') {
        if (op.start > text.length) throw new Error(`undo stack corrupted: insert start ${op.start} beyond length ${text.length}`);
        text = text.slice(0, op.start) + op.text + text.slice(op.start);
      } else {
        if (op.start + op.length > text.length) throw new Error(`undo stack corrupted: delete end ${op.start + op.length} beyond length ${text.length}`);
        if (text.slice(op.start, op.start + op.length) !== op.deleted) throw new Error('undo stack corrupted: deleted bytes do not match recorded text');
        text = text.slice(0, op.start) + text.slice(op.start + op.length);
      }
    }
    return text;
  }

  apply(operation) {
    if (!operation || typeof operation !== 'object') throw new Error('undo op must be an object');
    for (const key of ['start', 'length']) {
      if (operation[key] !== undefined && (!Number.isInteger(operation[key]) || operation[key] < 0)) throw new Error(`undo op ${key} must be a non-negative integer`);
    }
    const currentLength = this.text().length;
    const index = operation.type === 'insert' ? operation.start : (operation.start + operation.length);
    if (index > currentLength) throw new Error('undo op is out of range for the current text');
    this.ops.length = this.position;
    this.ops.push(operation);
    this.position++;
    if (this.ops.length > 200) this.#foldOldest();
    return operation;
  }

  #foldOldest() {
    const foldCount = this.ops.length - 200;
    let base = this.base;
    for (let i = 0; i < foldCount; i++) {
      const op = this.ops[i];
      base = op.type === 'insert'
        ? base.slice(0, op.start) + op.text + base.slice(op.start)
        : base.slice(0, op.start) + base.slice(op.start + op.length);
    }
    this.base = base;
    this.ops = this.ops.slice(foldCount);
    this.position -= foldCount;
    this.baseline = Math.max(0, this.baseline - foldCount);
  }

  undo() {
    if (this.position === 0) return null;
    this.position--;
    return this.ops[this.position];
  }

  redo() {
    if (this.position >= this.ops.length) return null;
    const op = this.ops[this.position];
    this.position++;
    return op;
  }

  markSaved() {
    this.baseline = this.position;
  }

  get dirty() {
    return this.position !== this.baseline;
  }

  get canUndo() { return this.position > 0; }
  get canRedo() { return this.position < this.ops.length; }
}

if (typeof window !== 'undefined') {
  window.UndoStack = UndoStack;
  window.diffOperation = diffOperation;
}