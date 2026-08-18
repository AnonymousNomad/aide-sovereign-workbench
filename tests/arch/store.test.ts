import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../browser/src/store/store.ts';

test('store keeps state and notifies subscribers', () => {
  const store = new Store({ count: 0 });
  const seen: number[] = [];
  store.subscribe(state => seen.push(state.count));
  store.set(prev => ({ count: prev.count + 1 }));
  store.set(prev => ({ count: prev.count + 1 }));
  assert.equal(store.get().count, 2);
  assert.deepEqual(seen, [1, 2]);
});

test('unsubscribe stops notifications', () => {
  const store = new Store({ count: 0 });
  let calls = 0;
  const unbind = store.subscribe(() => {
    calls += 1;
  });
  unbind();
  store.set(prev => ({ count: prev.count + 1 }));
  assert.equal(calls, 0);
});

test('updates are immutable', () => {
  const store = new Store({ items: ['a'] });
  store.set(prev => ({ items: [...prev.items, 'b'] }));
  assert.deepEqual(store.get().items, ['a', 'b']);
  store.set(prev => ({ items: prev.items.filter(item => item !== 'a') }));
  assert.deepEqual(store.get().items, ['b']);
});