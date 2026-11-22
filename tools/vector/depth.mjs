// Regner ut fiskekartets dybde fra rasteriserte dybdeflater (raster.py) med samme metode som kartet:
// dybden mellom kurvene (contourDepth), loddskudd og grunner (fitPoints) og utglatting innenfor intervallene
// (diffuseWithin). Intervallene er de ekte fra Kartverkets fil (iv.json), ikke fargene i kartbildet.
// Utdata: <ut>/{z}/{x}/{y}.bin.gz = dybde dm (Uint16, 65535 = land, negative som 65536 − |d|), cid + 1 (Uint8), merker (Uint8)
// Med terrengmappe: terrengmodellen gir bunnformen innenfor intervallene (se tools/dtm/blend.mjs).
// Bruk: node depth.mjs <datamappe> <rastermappe> <ut> [terrengmappe med <x>_<y>.f32, 1024 × 1024]
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { contourDepth, diffuseWithin, fitPoints } from '../../src/data/contourdepth.js';
import { blendDtm, dtmOn } from '../dtm/blend.mjs';

const [DATA, RAS, OUT, DTM] = process.argv.slice(2);
const NDTM = 1024;
const R = 6378137, ORIG = Math.PI * R, SIZE = 256, MARG = 128, BLUR_M = 40;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const iv = JSON.parse(await readFile(join(DATA, 'iv.json'), 'utf8'));
const IV = iv.map(([lo, hi]) => [0, lo, hi]);
// grove intervaller: «0,5–100 m» o.l. eller der største dybde er minst tre ganger minste (100–400, 200–600 …)
const COARSE = IV.map(([, lo, hi]) => (lo <= 0.5 && hi >= 10) || (lo >= 2 && hi >= 3 * lo));
const coarse = (k) => k >= 0 && COARSE[k];
const ptsBuf = await readFile(join(DATA, 'pts.bin')), PTS = new Float32Array(ptsBuf.buffer, ptsBuf.byteOffset, ptsBuf.length / 4);
log('intervaller', IV.length, '· punkter', PTS.length / 3);

const tileMerc = (z, x, y) => { const s = 2 * ORIG / 2 ** z; return [-ORIG + x * s, ORIG - (y + 1) * s, -ORIG + (x + 1) * s, ORIG - y * s]; };
const latOf = (my) => (Math.atan(Math.exp(my / R)) * 2 - Math.PI / 2) * 180 / Math.PI;

function toCls(u8, W, x0, y0, n) {
  const c = new Int16Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = u8[(y0 + j) * W + x0 + i]; c[j * n + i] = v === 0 ? -1 : v === 255 ? -2 : v - 1; }
  return c;
}
function subset(bb, src = PTS) {
  const out = [];
  for (let k = 0; k < src.length; k += 3) { const x = src[k], y = src[k + 1]; if (x >= bb[0] && x < bb[2] && y >= bb[1] && y < bb[3]) out.push(x, y, src[k + 2]); }
  return out;
}
function ptsIn(bb, px, src) {
  const s = subset(bb, src), out = [];
  for (let k = 0; k < s.length; k += 3) out.push((s[k] - bb[0]) / px - 0.5, (bb[3] - s[k + 1]) / px - 0.5, Math.max(0, s[k + 2]));
  return out;
}
function finish(cls, N, res, prior, pts, dtm = null) {
  let water = 0; for (let p = 0; p < N * N; p++) if (cls[p] !== -1) water++;
  if (!water) return null;
  const dep = contourDepth(cls, N, N, res, IV, prior, MARG, Math.max(2, Math.round(22 / res)));
  if (dtm) blendDtm(dep, cls, N, res, dtm, IV);
  const pins = pts.length ? fitPoints(dep, cls, N, N, res, pts, IV, coarse) : null;
  diffuseWithin(dep, cls, N, N, IV, Math.max(1, Math.min(40, Math.round((BLUR_M / res) ** 2 / 4))), 2, pins);
  return dep;
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
async function save(z, x, y, dep, cls, N) {
  const S = SIZE, M = S * S, buf = new Uint8Array(M * 4), d16 = new Uint16Array(buf.buffer, 0, M);
  let wet = 0;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const q = (j + MARG) * N + i + MARG, p = j * S + i, c = cls[q], d = dep ? dep[q] : NaN;
    if (c !== -1 && d === d) { d16[p] = (Math.max(-500, Math.min(60000, Math.round(d * 10))) + 65536) % 65536; wet++; } else d16[p] = 65535;
    buf[M * 2 + p] = c >= 0 ? c + 1 : 0;
    buf[M * 3 + p] = coarse(c) ? 1 : 0;
  }
  if (!wet) return false;
  const f = join(OUT, String(z), String(x), y + '.bin.gz'); await mkdir(dirname(f), { recursive: true });
  await writeFile(f, gzipSync(buf, { level: 9 }));
  return true;
}

const files = (await readdir(RAS)).filter((f) => f.endsWith('.bin'));
let nT = 0; const t0 = Date.now();
for (const [k, fn] of files.entries()) {
  const [x, y] = fn.replace('.bin', '').split('_').map(Number);
  const raw = await readFile(join(RAS, fn));
  const g12 = raw.subarray(0, 512 * 512), g13 = raw.subarray(512 * 512, 512 * 512 + 768 * 768), g14 = raw.subarray(512 * 512 + 768 * 768);
  // z12
  const b12 = tileMerc(12, x, y), p12 = (b12[2] - b12[0]) / SIZE, bb12 = [b12[0] - MARG * p12, b12[1] - MARG * p12, b12[2] + MARG * p12, b12[3] + MARG * p12];
  const res12 = p12 * Math.cos(latOf((b12[1] + b12[3]) / 2) * Math.PI / 180);
  let T = null;
  if (DTM) { const r = await readFile(join(DTM, `${x}_${y}.f32`)).catch(() => null); if (r) T = new Float32Array(r.buffer, r.byteOffset, r.length / 4); }
  const blk = subset(bb12), c12 = toCls(g12, 512, 0, 0, 512), d12 = finish(c12, 512, res12, null, ptsIn(bb12, p12, blk), T && dtmOn(T, NDTM, bb12, bb12, 512));
  if (await save(12, x, y, d12, c12, 512)) nT++;
  // z13 og z14 med z12 som føring langt fra kurvene (som i kartet)
  for (const [z, G, W] of [[13, g13, 768], [14, g14, 1280]]) {
    const f = 2 ** (z - 12), n = f;
    for (let qy = 0; qy < n; qy++) for (let qx = 0; qx < n; qx++) {
      const cx = x * f + qx, cy = y * f + qy, N = 512;
      const cls = toCls(G, W, qx * SIZE, qy * SIZE, N);
      let core = false; for (let j = MARG; j < MARG + SIZE && !core; j++) for (let i = MARG; i < MARG + SIZE; i++) if (cls[j * N + i] !== -1) { core = true; break; }
      if (!core) continue;
      const b = tileMerc(z, cx, cy), px = (b[2] - b[0]) / SIZE, bb = [b[0] - MARG * px, b[1] - MARG * px, b[2] + MARG * px, b[3] + MARG * px];
      const res = px * Math.cos(latOf((b[1] + b[3]) / 2) * Math.PI / 180);
      let prior = null;
      if (d12) {
        prior = new Float32Array(N * N); const sx = qx * SIZE, sy = qy * SIZE;
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) prior[j * N + i] = bil(d12, 512, MARG, (sx + i - MARG + 0.5) / f, (sy + j - MARG + 0.5) / f);
        prior = blurNaN(prior, N, Math.max(1, Math.round(f * 1.5)), 2);
      }
      const dep = finish(cls, N, res, prior, ptsIn(bb, px, blk), T && dtmOn(T, NDTM, bb12, bb, N));
      if (await save(z, cx, cy, dep, cls, N)) nT++;
    }
  }
  if ((k + 1) % 10 === 0) log(`${k + 1}/${files.length} blokker · ${nT} fliser · ${Math.round((Date.now() - t0) / 60000)} min`);
}
log(`ferdig: ${files.length} blokker, ${nT} fliser, ${Math.round((Date.now() - t0) / 60000)} min`);
