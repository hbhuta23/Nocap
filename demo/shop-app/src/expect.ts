// A tiny Jest-style expect() on top of node:assert, so the demo needs no installs.
import assert from 'node:assert/strict';

export function expect<T>(actual: T) {
  return {
    toBe: (expected: T) => assert.strictEqual(actual, expected),
    toEqual: (expected: T) => assert.deepStrictEqual(actual, expected),
  };
}
