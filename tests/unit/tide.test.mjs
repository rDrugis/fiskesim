import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extremes } from '../../src/map/tidepanel.js';

test('flo og fjære finnes i en sinusformet tidevannsserie', () => {
  // halvdøgnlig tidevann (12,42 t), 10-minutters verdier i 48 t
  const s = []; for (let i = 0; i <= 288; i++) { const t = i * 600e3; s.push({ t, v: 1 + 0.8 * Math.sin(2 * Math.PI * t / (12.42 * 3600e3)) }); }
  const ex = extremes(s);
  assert.ok(ex.length >= 6 && ex.length <= 8, 'ca. fire flo og fire fjære på to døgn, fikk ' + ex.length);
  for (let i = 1; i < ex.length; i++) assert.notEqual(ex[i].typ, ex[i - 1].typ, 'flo og fjære veksler');
  for (const e of ex) assert.ok(e.typ === 'flo' ? e.v > 1.75 : e.v < 0.25);
});
