// Bygger et lokalt terrengrutenett (høyde over sjøkartnull, sjø og land) for et område i UTM33.
import { wmsImage, bathy50, landDTM, wfsPoints } from './kartverket.js';
import { decodeDybdelag, solveDepth, SHORE_Z } from './depthmodel.js';
import { sample } from './grid.js';
import { SRC } from './sources.js';

// Bunntype fra NGU (dominerende kornstørrelse). Farger fra NGUs eget kartlag NiN_DK_Det.
export const NGU_CLS = [
  { k: 1, n: 'slam', c: [158, 187, 237], hard: 0.08 },
  { k: 2, n: 'sand', c: [255, 255, 150], hard: 0.35 },
  { k: 3, n: 'blandet', c: [162, 189, 0], hard: 0.55 },
  { k: 4, n: 'grus', c: [255, 186, 0], hard: 0.7 },
  { k: 5, n: 'stein/fjell', c: [122, 100, 73], hard: 0.95 },
];

/**
 * @param {object} o  { cx, cy, size, res, points: true|false, msl, onStage }
 * @returns grid { x0, y1, res, W, H, z, depth, lo, hi, mask, hard, sed, stats }
 */
export async function buildTerrain(o) {
  const { cx, cy, size, res } = o;
  const stage = o.onStage || (() => {});
  const half = size / 2;
  const bbox = [cx - half, cy - half, cx + half, cy + half];
  const W = Math.round(size / res), H = W;
  const msl = o.msl ?? 0.9; // middelvann over sjøkartnull (m)

  stage('Henter dybdeområder og 50 m-modellen');
  const imgP = wmsImage(SRC.wmsDybde, 'Dybdelag,Torrfall', bbox, W, H);
  const b50P = bathy50([bbox[0] - 100, bbox[1] - 100, bbox[2] + 100, bbox[3] + 100]).catch(() => null);
  const dtmRes = Math.max(res, size / 1800);
  const dtmP = landDTM(bbox, dtmRes).catch(() => null);
  const inner = o.points ? Math.min(size, o.pointsSize || 3400) / 2 : 0;
  const ib = [cx - inner, cy - inner, cx + inner, cy + inner];
  const ptsP = o.points ? Promise.all([
    wfsPoints('Dybdepunkt', ib).catch(() => []),
    wfsPoints('Grunne', ib).catch(() => []),
    wfsPoints('Skjær', ib).catch(() => []),
  ]) : Promise.resolve([[], [], []]);
  const nguP = o.ngu ? wmsImage(SRC.ngu, 'NiN_DK_Det', bbox, Math.min(W, 800), Math.min(H, 800)).catch(() => null) : Promise.resolve(null);

  const rgba = await imgP;
  const { mask, cls } = decodeDybdelag(rgba, W, H);
  const b50 = await b50P;

  stage('Henter dybdepunkter, grunner og skjær');
  const [dp, gr, sk] = await ptsP;
  const toCell = (x, y) => [(x - bbox[0]) / res, (bbox[3] - y) / res];
  const points = [];
  for (const arr of [dp, gr]) for (let k = 0; k < arr.length; k += 3) {
    const [ci, cj] = toCell(arr[k], arr[k + 1]);
    if (ci >= 0 && cj >= 0 && ci < W && cj < H && arr[k + 2] === arr[k + 2]) points.push(ci, cj, arr[k + 2]);
  }
  const rocks = [];
  for (let k = 0; k < sk.length; k += 3) {
    const [ci, cj] = toCell(sk[k], sk[k + 1]);
    if (ci >= 0 && cj >= 0 && ci < W && cj < H) rocks.push(ci, cj);
  }

  stage('Anslår dybden mellom kurvene');
  const prior = new Float32Array(W * H).fill(NaN);
  if (b50) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    prior[j * W + i] = sample(b50, bbox[0] + (i + 0.5) * res, bbox[3] - (j + 0.5) * res);
  }
  const sol = solveDepth({ W, H, res, mask, cls, prior, points, rocks });

  stage('Henter terrengmodell for land');
  const dtm = await dtmP;
  const z = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const p = j * W + i;
    if (mask[p] === 0) {
      let h = dtm ? sample(dtm, bbox[0] + (i + 0.5) * res, bbox[3] - (j + 0.5) * res) : NaN;
      h = h === h ? h + msl : SHORE_Z + 1;
      z[p] = Math.max(SHORE_Z, h);
    } else z[p] = -sol.depth[p];
  }

  // Bunnhardhet: fra NGU der bunnen er kartlagt, ellers anslått fra helning, ruhet og terrengform
  stage('Anslår bunntype');
  const hard = new Uint8Array(W * H), sed = new Uint8Array(W * H);
  const ngu = await nguP;
  const nW = Math.min(W, 800), nH = Math.min(H, 800);
  const tpi = tpiGrid(z, W, H, Math.max(2, Math.round(60 / res)));
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const p = j * W + i;
    if (mask[p] === 0) { hard[p] = 255; continue; }
    const zc = z[p];
    const zx = z[j * W + Math.min(W - 1, i + 1)] - z[j * W + Math.max(0, i - 1)];
    const zy = z[Math.min(H - 1, j + 1) * W + i] - z[Math.max(0, j - 1) * W + i];
    const slope = Math.atan(Math.hypot(zx, zy) / (2 * res)) * 57.3;
    const depth = -zc;
    let h = 0.3 + slope * 0.022 + Math.max(0, tpi[p]) * 0.03 - Math.max(0, -tpi[p]) * 0.02;
    if (depth > 60 && slope < 4 && tpi[p] < 1) h -= 0.18; // flate dyp og bassenger: mudder
    if (depth < 12) h += 0.12; // grunne områder nær land er ofte stein og tare
    let s = 0;
    if (ngu) {
      const ni = Math.min(nW - 1, Math.floor(i * nW / W)), nj = Math.min(nH - 1, Math.floor(j * nH / H)), q = (nj * nW + ni) * 4;
      if (ngu[q + 3] > 200) {
        let best = null, bd = 2500;
        for (const c of NGU_CLS) { const d = (ngu[q] - c.c[0]) ** 2 + (ngu[q + 1] - c.c[1]) ** 2 + (ngu[q + 2] - c.c[2]) ** 2; if (d < bd) { bd = d; best = c; } }
        if (best) { s = best.k; h = 0.65 * best.hard + 0.35 * h; }
      }
    }
    hard[p] = Math.max(5, Math.min(250, Math.round(h * 255)));
    sed[p] = s;
  }

  return {
    x0: bbox[0], y1: bbox[3], res, W, H, z, mask, lo: sol.lo, hi: sol.hi, hard, sed, tpi,
    stats: { points: points.length / 3, rocks: rocks.length / 2, b50: !!b50, dtm: !!dtm, ngu: !!ngu },
  };
}

// Topografisk posisjonsindeks: høyde minus gjennomsnitt i en ring (positiv = topp/rygg, negativ = søkk)
export function tpiGrid(z, W, H, r) {
  // integralbilde for rask middelverdi i kvadrat
  const I = new Float64Array((W + 1) * (H + 1));
  for (let j = 0; j < H; j++) { let row = 0; for (let i = 0; i < W; i++) { row += z[j * W + i]; I[(j + 1) * (W + 1) + i + 1] = I[j * (W + 1) + i + 1] + row; } }
  const out = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const a = Math.max(0, i - r), b = Math.min(W, i + r + 1), c = Math.max(0, j - r), d = Math.min(H, j + r + 1);
    const s = I[d * (W + 1) + b] - I[c * (W + 1) + b] - I[d * (W + 1) + a] + I[c * (W + 1) + a];
    out[j * W + i] = z[j * W + i] - s / ((b - a) * (d - c));
  }
  return out;
}
