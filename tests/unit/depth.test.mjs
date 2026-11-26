// Enhetstester for dybdemodellen (src/data/contourdepth.js) og terrengmodell-blandingen (tools/dtm/blend.mjs).
// Reglene her er det kartet bygger på: dybden holdes innenfor sjøkartets intervaller, loddskudd er fasit,
// og flaten skal ikke ha hopp, spisser eller groper som ikke finnes i dataene.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contourDepth, fitPoints, diffuseWithin } from '../../src/data/contourdepth.js';
import { blendDtm } from '../../tools/dtm/blend.mjs';

const IV = [[0, 0, 10], [0, 10, 20], [0, 20, 30], [0, 30, 50]];
// N × N rutenett: land i vest (i < 8), så bånd med økende intervall østover
function stripes(N = 96, res = 5) {
  const cls = new Int16Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) cls[j * N + i] = i < 8 ? -1 : Math.min(3, Math.floor((i - 8) / 22));
  return { N, res, cls };
}
function inside(dep, cls, N, msg) {
  for (let p = 0; p < N * N; p++) { const c = cls[p]; if (c < 0) continue;
    assert.ok(dep[p] >= IV[c][1] - 1e-4 && dep[p] <= IV[c][2] + 1e-4, `${msg}: celle ${p % N},${(p / N) | 0} = ${dep[p]} utenfor ${IV[c][1]}–${IV[c][2]}`); }
}
function finish(g, pts) {
  const { N, res, cls } = g;
  const dep = contourDepth(cls, N, N, res, IV, null, 64, 4);
  const coarse = () => false;
  const pins = pts.length ? fitPoints(dep, cls, N, N, res, pts, IV, coarse) : null;
  diffuseWithin(dep, cls, N, N, IV, 20, 2, pins);
  return dep;
}

test('contourDepth: innenfor intervallene og uten hopp over dybdekurvene', () => {
  const g = stripes(), { N, cls } = g, dep = contourDepth(cls, N, N, g.res, IV, null, 64, 4);
  inside(dep, cls, N, 'contourDepth');
  const j = N >> 1;
  for (let i = 9; i < N - 1; i++) { const a = dep[j * N + i], b = dep[j * N + i + 1];
    assert.ok(Math.abs(b - a) < 3, `hopp ${a.toFixed(1)} → ${b.toFixed(1)} ved i=${i}`); }
  assert.ok(dep[j * N + N - 2] > dep[j * N + 10], 'dypere utover');
});

test('loddskudd: målt dybde i punktet, og fortsatt innenfor intervallene', () => {
  const g = stripes(), { N, cls } = g;
  const i0 = 40, j0 = 48, d0 = 19;   // i intervallet 10–20 (i = 30–51), nær bunnen av det
  const dep = finish(g, [i0, j0, d0]);
  inside(dep, cls, N, 'med loddskudd');
  assert.ok(Math.abs(dep[j0 * N + i0] - d0) < 0.5, `i punktet: ${dep[j0 * N + i0]} ≠ ${d0}`);
});

test('loddskudd uten spiss eller grop i flaten (prikker/hull i kartet)', { todo: 'kjent feil: loddskudd holdes i én enkelt rute og gir en spiss (prikk i skyggen); den myke overgangen som ble prøvd 22.11 ga hull' }, () => {
  const g = stripes(), { N } = g, i0 = 40, j0 = 48;
  const dep = finish(g, [i0, j0, 11]);
  let s = 0; for (const [a, b] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) s += dep[(j0 + b) * N + i0 + a];
  const spiss = Math.abs(dep[j0 * N + i0] - s / 4);
  assert.ok(spiss < 0.5, `forskjell mellom punktet og naboene: ${spiss.toFixed(2)} m`);
});

test('terrengmodellen: innenfor intervallene, rører ikke land-nære ruter, flytter åpent vann mot modellen', () => {
  const g = stripes(), { N, res, cls } = g;
  const base = contourDepth(cls, N, N, res, IV, null, 64, 4), dep = base.slice();
  const dtm = new Float32Array(N * N).fill(NaN); for (let p = 0; p < N * N; p++) if (cls[p] >= 0) dtm[p] = 45;   // modellen sier dypt overalt
  blendDtm(dep, cls, N, res, dtm, IV);
  inside(dep, cls, N, 'med terrengmodell');
  const j = N >> 1;
  assert.equal(dep[j * N + 10], base[j * N + 10], 'under 75 m fra land: uendret');
  // langt fra land og langt fra kurver: dratt mot 45 m, men holdt innenfor 30–50
  const k = j * N + N - 8; assert.ok(dep[k] >= base[k], `dratt dypere (${base[k]} → ${dep[k]})`);
});

test('despike: loddskuddets spiss tas bort i tegningen, resten er urørt', async () => {
  const { despike } = await import('../../src/data/contourdepth.js');
  const N = 20, a = new Float32Array(N * N), cl = new Uint8Array(N * N).fill(5);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) a[j * N + i] = 60 + 0.5 * i + 0.3 * j;
  const p = 10 * N + 10, before = a[p]; a[p] = before + 2;
  // kjent punkt: byttes direkte
  const o1 = despike(a, N, cl, [p]);
  assert.ok(Math.abs(o1[p] - before) < 1e-4);
  // uten kjente punkter: finnes av seg selv
  const o2 = despike(a, N, cl);
  assert.ok(Math.abs(o2[p] - before) < 1e-4);
  for (let q = 0; q < N * N; q++) if (q !== p) assert.equal(o2[q], a[q]);
  // en flekk med eget intervall (ekte grunne) står
  const cl2 = cl.slice(); cl2[p] = 4;
  assert.equal(despike(a, N, cl2)[p], a[p]);
});
