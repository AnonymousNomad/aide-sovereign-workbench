import assert from 'node:assert/strict';
import { EditorGroups } from './groups.mjs';

const g = new EditorGroups();
assert.equal(g.state().groups.length, 1);
assert.equal(g.state().activeGroup, 'A');

g.open(0, 'a.js');
g.open(0, 'b.js');
assert.deepEqual(g.state().groups[0].tabs, ['a.js', 'b.js']);
assert.equal(g.state().groups[0].active, 'b.js');
assert.deepEqual(g.mruOrder(), ['b.js', 'a.js']);

const split = g.split('a.js');
assert.equal(split.groups.length, 2);
assert.equal(split.groups[1].tabs[0], 'a.js', 'split must open the active document in the new group');
assert.equal(split.groups[0].active, 'b.js', 'original group keeps its own active tab');
assert.equal(split.activeGroup, split.groups[1].id, 'new group becomes active');

g.activate('a.js');
assert.deepEqual(g.mruOrder(), ['a.js', 'b.js'], 'switching views must move the file to MRU front');
assert.equal(g.state().activeGroup, split.groups[1].id);

const moved = g.move('a.js', 0);
assert.deepEqual(moved.groups[0].tabs, ['a.js', 'b.js'], 'move across groups must append to the target group');
assert.equal(moved.groups[0].active, 'a.js');
assert.equal(moved.activeGroup, 'A');
assert.equal(moved.groups[1].tabs.length, 0, 'source group must be left empty');

const closed = g.closeGroup(1);
assert.equal(closed.groups.length, 1, 'closing an empty group must remove it');
assert.equal(g.nextGroup().activeGroup, 'A', 'nextGroup must cycle within remaining groups');

const g2 = new EditorGroups();
g2.open(0, 'x.js');
g2.open(0, 'y.js');
g2.closeTab('y.js');
assert.deepEqual(g2.state().groups[0].tabs, ['x.js']);
assert.equal(g2.state().groups[0].active, 'x.js', 'closing the active tab must activate its neighbour');
assert.deepEqual(g2.mruOrder(), ['x.js']);

const g3 = new EditorGroups();
g3.open(0, 'a.js');
g3.split('a.js');
g3.closeTab('a.js');
assert.equal(g3.state().groups.length, 1, 'closing the only tab of a split must merge back to one group');
assert.equal(g3.state().activeGroup, 'A', 'active group index must be clamped after the group closes');

assert.throws(() => new EditorGroups().open(5, 'x.js'), /does not exist/);
assert.throws(() => new EditorGroups().move('missing.js', 0), /not open/);

console.log('editor groups test passed');