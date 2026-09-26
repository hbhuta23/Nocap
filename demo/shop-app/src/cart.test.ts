import { test } from 'node:test';
import { expect } from './expect.ts';
import { applyDiscount } from './cart.ts';

test('members get a 15% discount', () => {
  expect(applyDiscount(100)).toBe(85);
});
