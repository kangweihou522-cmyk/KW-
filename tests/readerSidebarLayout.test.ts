import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStoredNumber } from '../src/features/reader/readerWorkspaceShared.ts';

test('missing or invalid sidebar size uses a visible default instead of becoming zero-width', (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage'); });
  for (const value of [null, '', ' ', 'invalid']) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => value } });
    assert.equal(loadStoredNumber('sidebar', 408), 408);
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => '420' } });
  assert.equal(loadStoredNumber('sidebar', 408), 420);
});
