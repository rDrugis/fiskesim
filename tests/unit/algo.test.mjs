// Enhetstester for fiskeplassalgoritmen (src/algo/core.js). Kjøres med: node --test tests/unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depthFit, dilate, interpDepth, sundGrid, algoParams, cellScore, km, merc, unmerc, inMon, monIn, R } from '../../src/algo/core.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≉ ${b} (±${eps})`);

test('depthFit: 1 i kjernen, 0 utenfor rammen, lineært imellom', () => {
  const P = { core: [20, 40], range: [10, 60] };
  assert.equal(depthFit(30, P), 1); assert.equal(depthFit(20, P), 1); assert.equal(depthFit(40, P), 1);
  assert.equal(depthFit(10, P), 0); assert.equal(depthFit(5, P), 0); assert.equal(depthFit(60, P), 0); assert.equal(depthFit(80, P), 0);
  near(depthFit(15, P), 0.5, 1e-9); near(depthFit(50, P), 0.5, 1e-9);
});

test('dilate: ett punkt blir et kvadrat med radius r, også i kanten', () => {
  const W = 7, H = 7, M = new Uint8Array(W * H); M[3 * W + 3] = 1;
  const O = dilate(M, W, H, 1); let n = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const inside = Math.abs(i - 3) <= 1 && Math.abs(j - 3) <= 1; assert.equal(O[j * W + i], inside ? 1 : 0, `(${i},${j})`); n += O[j * W + i]; }
  assert.equal(n, 9);
  assert.deepEqual([...dilate(M, W, H, 0)], [...M], 'r = 0 endrer ingenting');
  const E = new Uint8Array(W * H); E[0] = 1; const OE = dilate(E, W, H, 2);
  assert.equal(OE.reduce((a, b) => a + b, 0), 9, 'hjørnet klippes (3 × 3 innenfor)');
});

test('interpDepth: alltid innenfor eget intervall, dypere bort fra land, land er NaN', () => {
  // rad: land | 0–10 | 10–20 | 20–30 (hver sone 20 celler)
  const W = 81, H = 5, DA = new Float32Array(W * H), DB = new Float32Array(W * H), LAND = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const c = j * W + i;
    if (i < 21) LAND[c] = 1; else if (i < 41) { DA[c] = 0; DB[c] = 10; } else if (i < 61) { DA[c] = 10; DB[c] = 20; } else { DA[c] = 20; DB[c] = 30; } }
  const Z = interpDepth(DA, DB, LAND, W, H, 10, 1);
  for (let i = 0; i < W; i++) { const c = 2 * W + i;
    if (LAND[c]) { assert.ok(Number.isNaN(Z[c]), `land ${i}`); continue; }
    assert.ok(Z[c] >= DA[c] && Z[c] <= DB[c], `celle ${i}: ${Z[c]} utenfor ${DA[c]}–${DB[c]}`); }
  for (let i = 22; i < 60; i++) assert.ok(Z[2 * W + i + 1] >= Z[2 * W + i] - 1e-6, `dybden skal øke utover (${i})`);
});

test('sundGrid: smalt sund mellom to åpne bassenger gir verdi, åpent vann gir 0', () => {
  // 60 × 60 ruter à 20 m: land overalt, to åpne bassenger (nord og sør) og et 300 m bredt sund mellom dem
  const n = 60, step = 20, LA = new Uint8Array(n * n).fill(1);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const basin = j < 18 || j >= 42, sund = j >= 18 && j < 42 && i >= 22 && i < 37;
    if (basin || sund) LA[j * n + i] = 0; }
  const { s } = sundGrid(LA, n, step, 0, n);
  assert.ok(s[30 * n + 29] > 0, `midt i sundet: ${s[30 * n + 29]}`);
  assert.equal(s[5 * n + 30], 0, 'midt i bassenget');
  assert.equal(s[30 * n + 5], 0, 'på land');
});

test('algoParams: dybdekrav, fredning og varsler', () => {
  const t = algoParams('torsk', 5, 60.5, 5.27, new Date(2026, 5, 1));
  assert.ok(Array.isArray(t.core) && Array.isArray(t.range) && t.range[0] <= t.core[0] && t.core[1] <= t.range[1], 'kjernen ligger inne i rammen');
  assert.match(algoParams('kveite', 6, 60.5, 5.27, new Date(2026, 6, 1)).fredet, /forbudt sør for 62/);
  assert.match(algoParams('hummer', 5, 60.5, 5.27, new Date(2026, 5, 1)).fredet, /fredet/);
  assert.equal(algoParams('hummer', 9, 60.5, 5.27, new Date(2026, 9, 2)).fredet, '');
  assert.equal(algoParams('finnes-ikke', 5, 60.5, 5.27), null);
  for (const sp of Object.keys(R.algo)) { const P = algoParams(sp, 5, 60.5, 5.27, new Date(2026, 5, 1)); if (!P || P.skip) continue;
    assert.ok(P.core[0] <= P.core[1] && P.range[0] <= P.core[0] && P.core[1] <= P.range[1], `${sp}: rammen må omslutte kjernen`); }
});

test('cellScore: 0 utenfor dybderammen, høyere med bedre bunnform', () => {
  const P = { core: [20, 40], range: [10, 60] };
  const X = { P, w: [['peak', 1]], wsum: 1, bu: null, bo: null, mid: 30, half: 20 };
  assert.equal(cellScore(X, { peak: 1 }, 70, false), 0);
  const hi = cellScore(X, { peak: 1 }, 30, false), lo = cellScore(X, { peak: 0 }, 30, false);
  assert.ok(hi > lo && lo > 0, `${hi} > ${lo} > 0`);
  assert.ok(cellScore(X, { peak: 1 }, 30, true) < hi, 'brede flater straffes');
});

test('hjelpere: avstand, projeksjon og måneder', () => {
  near(km([60.39, 5.32], [59.91, 10.75]), 305, 5, 'Bergen–Oslo');
  const [x, y] = merc(60.5, 5.27), [la, lo] = unmerc(x, y); near(la, 60.5, 1e-9); near(lo, 5.27, 1e-9);
  assert.ok(inMon(11, 2, 1) && inMon(11, 2, 12) && !inMon(11, 2, 6), 'periode over nyttår');
  assert.ok(monIn('NOV', 'FEB', 0) && !monIn('MAI', 'AUG', 0));
});
