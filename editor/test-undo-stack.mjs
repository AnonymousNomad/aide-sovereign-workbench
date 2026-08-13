import assert from 'node:assert/strict';
import { UndoStack, diffOperation } from './undo-stack.mjs';

const base = 'alpha beta gamma';
const stack = new UndoStack(base);
assert.equal(stack.text(), base);
assert.equal(stack.dirty, false);
assert.equal(stack.canUndo, false);
assert.equal(stack.canRedo, false);

const del = stack.apply({ type: 'delete', start: 6, length: 4, deleted: 'beta' });
assert.equal(stack.text(), 'alpha  gamma');
assert.equal(stack.dirty, true);
assert.ok(del);

stack.apply({ type: 'insert', start: 5, text: '-' });
assert.equal(stack.text(), 'alpha-  gamma');

const undone = stack.undo();
assert.equal(undone.type, 'insert');
assert.equal(stack.text(), 'alpha  gamma');
assert.equal(stack.dirty, true);
assert.equal(stack.canRedo, true);

stack.undo();
assert.equal(stack.text(), base, 'undo to base must be byte-exact');
assert.equal(stack.dirty, false, 'undo back to the untouched base must not be dirty');
assert.equal(stack.canUndo, false);

stack.redo();
assert.equal(stack.text(), 'alpha  gamma');
stack.redo();
assert.equal(stack.text(), 'alpha-  gamma');
assert.equal(stack.canRedo, false);

stack.markSaved();
assert.equal(stack.dirty, false);
assert.equal(stack.canUndo, true, 'undo must remain possible after save');

stack.undo();
assert.equal(stack.text(), 'alpha  gamma');
assert.equal(stack.dirty, true, 'undoing past the save point must mark the file dirty again');

const branched = stack.apply({ type: 'delete', start: 0, length: 1, deleted: 'a' });
assert.ok(branched);
assert.equal(stack.canRedo, false, 'editing after undo must clear the redo branch');
const branchRedo = stack.redo();
assert.equal(branchRedo, null);

const emoji = new UndoStack('a😀c');
emoji.apply({ type: 'insert', start: 3, text: 'B' });
assert.equal(emoji.text(), 'a😀Bc', 'multi-byte code points must round-trip exactly (indices are UTF-16 code units)');
assert.equal(emoji.undo().type, 'insert');
assert.equal(emoji.text(), 'a😀c');

assert.throws(() => new UndoStack().apply({ type: 'insert', start: 2, text: 'x' }), /out of range/i);

const diff = new UndoStack('const x = 1;');
const [delOp, insOp] = diffOperation('const x = 1;', 'const xy = 2;');
assert.deepEqual(delOp, { type: 'delete', start: 7, length: 4, deleted: ' = 1' });
assert.deepEqual(insOp, { type: 'insert', start: 7, text: 'y = 2' });
for (const op of [delOp, insOp]) diff.apply(op);
assert.equal(diff.text(), 'const xy = 2;', 'diff ops must reconstruct the target text byte-exactly');
assert.deepEqual(diffOperation('same', 'same'), [], 'no change must produce no ops');
const appendOps = diffOperation('abc', 'abcdef');
assert.deepEqual(appendOps, [{ type: 'insert', start: 3, text: 'def' }], 'pure append must be a single insert');

console.log('undo stack test passed');