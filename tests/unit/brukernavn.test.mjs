import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badUser, validUser } from '../../src/fangst/cloud.js';

test('banneord i brukernavn stoppes, også med tall og skilletegn', () => {
  for (const u of ['faen', 'f4en', 'f.a.e.n', 'kuken99', 'jaevel', 'fuck_you', 'sh1t', 'h0re']) assert.ok(badUser(u), u);
});
test('vanlige navn går gjennom', () => {
  for (const u of ['sigurd', 'nikolai', 'ola.n', 'fiskern', 'torsk-kari', 'sei_99']) { assert.ok(validUser(u), u); assert.ok(!badUser(u), u); }
});
