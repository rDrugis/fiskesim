import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath, smooth } from '../../src/map/autoroute.js';

// 20×10 med en vegg midt på som har åpning nederst: ruten må gå rundt
test('ruten går rundt land og aldri over land', () => {
  const W = 20, H = 10, ok = new Uint8Array(W * H).fill(1);
  for (let y = 0; y < 8; y++) ok[y * W + 10] = 0;
  const s = 2 * W + 2, t = 2 * W + 17, p = findPath(ok, W, H, s, t);
  assert.ok(p, 'fant vei');
  assert.ok(p.every((k) => ok[k]), 'ingen celle på land');
  assert.ok(p.some((k) => ((k / W) | 0) >= 8), 'gikk gjennom åpningen');
  const sm = smooth(ok, W, p); assert.equal(sm[0], s); assert.equal(sm[sm.length - 1], t); assert.ok(sm.length < p.length);
});
test('ingen vei når alt er stengt', () => {
  const W = 10, H = 5, ok = new Uint8Array(W * H).fill(1);
  for (let y = 0; y < H; y++) ok[y * W + 5] = 0;
  assert.equal(findPath(ok, W, H, 0, 9), null);
});
test('går ikke på skrå mellom to landceller', () => {
  const W = 3, H = 3, ok = new Uint8Array([1, 0, 1, 0, 1, 1, 1, 1, 1]);
  const p = findPath(ok, W, H, 0, 2); assert.equal(p, null);
});
