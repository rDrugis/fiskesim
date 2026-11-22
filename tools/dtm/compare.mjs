// Test (endrer ikke nettsiden): gir terrengmodellen (topobaty 50 m) et bedre fiskekart?
// Én tydelig rekkefølge, så det ikke blir «for mange kokker»:
//   1) sjøkartets dybdeintervaller er absolutte grenser (som før)
//   2) terrengmodellen gir bare FORMEN på bunnen innenfor intervallet, og får lav vekt nær land (50 m-ruter er for grove der)
//   3) loddskuddene er fasit og retter alt rundt seg (som før)
//   4) samme utglatting innenfor intervallene som før
// Måler med tilbakeholdte loddskudd: hvert femte loddskudd tas ut av utregningen, og avviket der sammenlignes før/etter.
// Bruk: node compare.mjs <vdata> <ras> <dtm> <ut> <NDTM> sted:z14x:z14y,...
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { contourDepth, diffuseWithin, fitPoints, edt } from '../../src/data/contourdepth.js';

const [DATA, RAS, DTM, OUT, NDT, PLACES] = process.argv.slice(2);
const NDTM = Number(NDT), R = 6378137, ORIG = Math.PI * R, SIZE = 256, MARG = 128, BLUR_M = 40;
const WMAX = 0.8, NEAR0 = 60, NEAR1 = 150;   // vekt på terrengmodellen, og avstand fra land (m) der den tones inn
await mkdir(OUT, { recursive: true });
const iv = JSON.parse(await readFile(join(DATA, 'iv.json'), 'utf8'));
const IV = iv.map(([lo, hi]) => [0, lo, hi]);
const COARSE = IV.map(([, lo, hi]) => (lo <= 0.5 && hi >= 10) || (lo >= 2 && hi >= 3 * lo));
const coarse = (k) => k >= 0 && COARSE[k];
const ptsBuf = await readFile(join(DATA, 'pts.bin')), PTS = new Float32Array(ptsBuf.buffer, ptsBuf.byteOffset, ptsBuf.length / 4);
const tileMerc = (z, x, y) => { const s = 2 * ORIG / 2 ** z; return [-ORIG + x * s, ORIG - (y + 1) * s, -ORIG + (x + 1) * s, ORIG - y * s]; };
const latOf = (my) => (Math.atan(Math.exp(my / R)) * 2 - Math.PI / 2) * 180 / Math.PI;

function toCls(u8, W, x0, y0, n) {
  const c = new Int16Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = u8[(y0 + j) * W + x0 + i]; c[j * n + i] = v === 0 ? -1 : v === 255 ? -2 : v - 1; }
  return c;
}
// loddskudd i boksen; hold = true: bare de tilbakeholdte, false: alle unntatt dem, null: alle
function ptsIn(bb, px, hold) {
  const out = [];
  for (let k = 0; k < PTS.length; k += 3) {
    const x = PTS[k], y = PTS[k + 1]; if (!(x >= bb[0] && x < bb[2] && y >= bb[1] && y < bb[3])) continue;
    const held = (k / 3) % 5 === 0;
    if (hold === true && !held) continue; if (hold === false && held) continue;
    out.push((x - bb[0]) / px - 0.5, (bb[3] - y) / px - 0.5, Math.max(0, PTS[k + 2]));
  }
  return out;
}
function bil(a, N, m, u, v) {
  const x = u + m - 0.5, y = v + m - 0.5;
  const i = Math.max(0, Math.min(N - 2, Math.floor(x))), j = Math.max(0, Math.min(N - 2, Math.floor(y)));
  const tx = Math.min(1, Math.max(0, x - i)), ty = Math.min(1, Math.max(0, y - j));
  const p = j * N + i; let A = a[p], B = a[p + 1], C = a[p + N], D = a[p + N + 1];
  if (!(A === A && B === B && C === C && D === D)) { let s = 0, n = 0; for (const q of [A, B, C, D]) if (q === q) { s += q; n++; } if (!n) return NaN; const mm = s / n; if (!(A === A)) A = mm; if (!(B === B)) B = mm; if (!(C === C)) C = mm; if (!(D === D)) D = mm; }
  return (A * (1 - tx) + B * tx) * (1 - ty) + (C * (1 - tx) + D * tx) * ty;
}
function blurNaN(a, N, r, reps) {
  let src = a;
  const v = new Float32Array(N * N), c = new Float32Array(N * N), tv = new Float32Array(N * N), tc = new Float32Array(N * N);
  for (let it = 0; it < reps; it++) {
    for (let p = 0; p < N * N; p++) { const x = src[p]; if (x === x) { v[p] = x; c[p] = 1; } else { v[p] = 0; c[p] = 0; } }
    for (const horiz of [true, false]) {
      const sv = horiz ? v : tv, sc = horiz ? c : tc, dv = horiz ? tv : v, dc = horiz ? tc : c;
      for (let m = 0; m < N; m++) {
        let s = 0, n = 0; const o = horiz ? m * N : m, st = horiz ? 1 : N;
        for (let q = 0; q <= Math.min(N - 1, r); q++) { s += sv[o + q * st]; n += sc[o + q * st]; }
        for (let q = 0; q < N; q++) { const p = o + q * st; dv[p] = s; dc[p] = n; const a2 = q + r + 1, b2 = q - r; if (a2 < N) { s += sv[o + a2 * st]; n += sc[o + a2 * st]; } if (b2 >= 0) { s -= sv[o + b2 * st]; n -= sc[o + b2 * st]; } }
      }
    }
    const out = new Float32Array(N * N); for (let p = 0; p < N * N; p++) out[p] = c[p] > 0 && a[p] === a[p] ? v[p] / c[p] : NaN; src = out;
  }
  return src;
}
// terrengmodellen samplet på et rutenett (bb, N × N)
function dtmOn(dtm, blockBB, bb, N) {
  const out = new Float32Array(N * N), sx = (blockBB[2] - blockBB[0]) / NDTM, sy = (blockBB[3] - blockBB[1]) / NDTM;
  const px = (bb[2] - bb[0]) / N;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const mx = bb[0] + (i + 0.5) * px, my = bb[3] - (j + 0.5) * px;
    out[j * N + i] = bil(dtm, NDTM, 0, (mx - blockBB[0]) / sx, (blockBB[3] - my) / sy);
  }
  return out;
}
function finish(cls, N, res, prior, pts, dtm) {
  let water = 0; for (let p = 0; p < N * N; p++) if (cls[p] !== -1) water++;
  if (!water) return null;
  const dep = contourDepth(cls, N, N, res, IV, prior, MARG, Math.max(2, Math.round(22 / res)));
  if (dtm) {
    const feat = new Uint8Array(N * N); for (let p = 0; p < N * N; p++) feat[p] = cls[p] < 0 ? 1 : 0;
    const d2 = edt(feat, N, N);
    for (let p = 0; p < N * N; p++) {
      const c = cls[p], t = dtm[p]; if (c < 0 || !(t === t) || !(dep[p] === dep[p])) continue;
      const dm = Math.sqrt(d2[p]) * res, s = Math.min(1, Math.max(0, (dm - NEAR0) / (NEAR1 - NEAR0))), w = WMAX * s * s * (3 - 2 * s);
      const lo = IV[c][1], hi = IV[c][2];
      dep[p] = Math.min(hi, Math.max(lo, dep[p] + w * (Math.min(hi, Math.max(lo, t)) - dep[p])));
    }
  }
  const pins = pts.length ? fitPoints(dep, cls, N, N, res, pts, IV, coarse) : null;
  diffuseWithin(dep, cls, N, N, IV, Math.max(1, Math.min(40, Math.round((BLUR_M / res) ** 2 / 4))), 2, pins);
  return dep;
}

const blocks = new Map();
async function block(bx, by) {
  const key = bx + '_' + by; if (blocks.has(key)) return blocks.get(key);
  let b = null;
  try {
    const raw = await readFile(join(RAS, key + '.bin'));
    const dt = await readFile(join(DTM, key + '.f32')).catch(() => null);
    const m = tileMerc(12, bx, by), p12 = (m[2] - m[0]) / SIZE, bb12 = [m[0] - MARG * p12, m[1] - MARG * p12, m[2] + MARG * p12, m[3] + MARG * p12];
    b = { g12: raw.subarray(0, 512 * 512), g14: raw.subarray(512 * 512 + 768 * 768), bb12, p12,
      res12: p12 * Math.cos(latOf((m[1] + m[3]) / 2) * Math.PI / 180),
      dtm: dt ? new Float32Array(dt.buffer, dt.byteOffset, dt.length / 4) : null, z12: {} };
  } catch { b = null; }
  blocks.set(key, b); return b;
}
async function z12(b, v) {
  if (b.z12[v]) return b.z12[v];
  const withDtm = v.startsWith('B'), hold = v.endsWith('h') ? false : null;
  const c = toCls(b.g12, 512, 0, 0, 512);
  const d = finish(c, 512, b.res12, null, ptsIn(b.bb12, b.p12, hold), withDtm && b.dtm ? dtmOn(b.dtm, b.bb12, b.bb12, 512) : null);
  return (b.z12[v] = d);
}
async function tile14(tx, ty, v) {
  const b = await block(tx >> 2, ty >> 2); if (!b) return null;
  const qx = tx & 3, qy = ty & 3, N = 512, f = 4;
  const cls = toCls(b.g14, 1280, qx * SIZE, qy * SIZE, N);
  const m = tileMerc(14, tx, ty), px = (m[2] - m[0]) / SIZE, bb = [m[0] - MARG * px, m[1] - MARG * px, m[2] + MARG * px, m[3] + MARG * px];
  const res = px * Math.cos(latOf((m[1] + m[3]) / 2) * Math.PI / 180);
  const d12 = await z12(b, v);
  let prior = null;
  if (d12) {
    prior = new Float32Array(N * N); const sx = qx * SIZE, sy = qy * SIZE;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) prior[j * N + i] = bil(d12, 512, MARG, (sx + i - MARG + 0.5) / f, (sy + j - MARG + 0.5) / f);
    prior = blurNaN(prior, N, Math.max(1, Math.round(f * 1.5)), 2);
  }
  const withDtm = v.startsWith('B'), hold = v.endsWith('h') ? false : null;
  const dep = finish(cls, N, res, prior, ptsIn(bb, px, hold), withDtm && b.dtm ? dtmOn(b.dtm, b.bb12, bb, N) : null);
  return { dep, cls, N, res, bb, px };
}

// ---- bilder ----
function png(w, h, rgb) {
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let j = 0; j < h; j++) { raw[j * (w * 3 + 1)] = 0; rgb.copy(raw, j * (w * 3 + 1) + 1, j * w * 3, (j + 1) * w * 3); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
const LEV = [5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200, 250, 300, 350, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200];
const band = (d) => { let k = 0; while (k < LEV.length && d >= LEV[k]) k++; return k; };
function paint(t, img, W, ox, oy, mode, other) {
  const { dep, cls, N, res } = t;
  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
    const p = (j + MARG) * N + i + MARG, d = dep ? dep[p] : NaN, o = ((oy + j) * W + ox + i) * 3;
    let col;
    if (cls[p] === -1 || !(d === d)) col = [226, 221, 204];
    else if (cls[p] === -2) col = [206, 204, 172];
    else if (mode === 'diff') {
      const e = other.dep ? other.dep[p] : NaN, x = Math.max(-1, Math.min(1, (d - e) / 10));
      col = x > 0 ? [255 - 175 * x, 255 - 175 * x, 255] : [255, 255 + 175 * x, 255 + 175 * x];   // blå = dypere med modellen, rød = grunnere
    } else {
      const g = (a, b) => { const v = dep[p + a + b * N]; return v === v ? v : d; };
      const dx = (g(1, 0) - g(-1, 0)) / (2 * res), dy = (g(0, 1) - g(0, -1)) / (2 * res);
      const nx = 2 * dx, ny = 2 * dy, len = Math.hypot(nx, ny, 1), lam = (-nx * -0.6 + -ny * -0.6 + 0.52) / len;   // lys fra nordvest
      const sh = Math.max(0.45, Math.min(1.3, 0.35 + 1.1 * lam));
      const tt = Math.min(1, Math.log1p(Math.max(0, d)) / Math.log1p(700));
      col = [205 - 190 * tt, 232 - 180 * tt, 246 - 140 * tt].map((c) => c * sh);
      const kb = band(d);
      if ((i < SIZE - 1 && band(dep[p + 1]) !== kb && dep[p + 1] === dep[p + 1]) || (j < SIZE - 1 && band(dep[p + N]) !== kb && dep[p + N] === dep[p + N])) col = col.map((c) => c * 0.55);
    }
    img[o] = Math.max(0, Math.min(255, col[0])); img[o + 1] = Math.max(0, Math.min(255, col[1])); img[o + 2] = Math.max(0, Math.min(255, col[2]));
  }
}
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1); };
const pct = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(1); };

const report = {};
for (const spec of PLACES.split(',')) {
  const [name, sx, sy] = spec.split(':'), cx = +sx, cy = +sy;
  const W = SIZE * 3 * 3, H = SIZE * 3, img = Buffer.alloc(W * H * 3, 255);
  const errA = [], errB = [], chg = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const tx = cx + dx, ty = cy + dy;
    const A = await tile14(tx, ty, 'A'), B = await tile14(tx, ty, 'B');
    if (!A || !B) continue;
    const ox = (dx + 1) * SIZE, oy = (dy + 1) * SIZE;
    paint(A, img, W, ox, oy, 'map'); paint(B, img, W, ox + SIZE * 3, oy, 'map'); paint(B, img, W, ox + SIZE * 6, oy, 'diff', A);
    for (let p = 0; p < A.N * A.N; p++) if (A.cls[p] >= 0 && A.dep && B.dep && A.dep[p] === A.dep[p]) chg.push(Math.abs(B.dep[p] - A.dep[p]));
    // tilbakeholdte loddskudd: avvik når de IKKE er med i utregningen
    const Ah = await tile14(tx, ty, 'Ah'), Bh = await tile14(tx, ty, 'Bh'), held = ptsIn(A.bb, A.px, true);
    for (let k = 0; k < held.length; k += 3) {
      const i = Math.round(held[k]), j = Math.round(held[k + 1]);
      if (i < MARG || j < MARG || i >= MARG + SIZE || j >= MARG + SIZE) continue;
      const p = j * A.N + i; if (A.cls[p] < 0 || !Ah.dep || !Bh.dep) continue;
      const a = Ah.dep[p], b = Bh.dep[p]; if (!(a === a && b === b)) continue;
      errA.push(Math.abs(a - held[k + 2])); errB.push(Math.abs(b - held[k + 2]));
    }
  }
  await writeFile(join(OUT, name + '.png'), png(W, H, img));
  const better = errA.filter((e, k) => errB[k] < e - 0.5).length, worse = errA.filter((e, k) => errB[k] > e + 0.5).length;
  report[name] = { tilbakeholdte_loddskudd: errA.length, foer_median_m: med(errA), foer_90pst_m: pct(errA, 0.9), etter_median_m: med(errB), etter_90pst_m: pct(errB, 0.9),
    bedre_enn_0_5m: better, verre_enn_0_5m: worse, endring_median_m: med(chg), endring_90pst_m: pct(chg, 0.9) };
  console.log(name, JSON.stringify(report[name]));
}
await writeFile(join(OUT, 'rapport.json'), JSON.stringify(report, null, 1));
