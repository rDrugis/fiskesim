// Habitatkart: terrengformer per celle (25 m), og hvor godt hver art trives der.
import { SPECIES } from './species.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Bygger trekk fra terrenggridet: dybde, helning, TPI, avstand til land, nærhet til dypere vann og skrenter
export function buildFeatures(g, cell = 25) {
  const step = Math.max(1, Math.round(cell / g.res));
  const W = Math.floor(g.W / step), H = Math.floor(g.H / step);
  const f = { W, H, cell: step * g.res, x0: g.x0, y1: g.y1, depth: new Float32Array(W * H), slope: new Float32Array(W * H), tpi: new Float32Array(W * H), shore: new Float32Array(W * H), hard: new Float32Array(W * H), sed: new Uint8Array(W * H), sea: new Uint8Array(W * H) };
  // avstand til land (m) med to-pass avstandstransform på fullt grid
  const N = g.W * g.H, dist = new Float32Array(N);
  for (let p = 0; p < N; p++) dist[p] = g.mask[p] === 0 ? 0 : 1e9;
  const r = g.res, d2 = r * Math.SQRT2;
  for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) {
    const p = j * g.W + i; let v = dist[p];
    if (i > 0) v = Math.min(v, dist[p - 1] + r); if (j > 0) v = Math.min(v, dist[p - g.W] + r);
    if (i > 0 && j > 0) v = Math.min(v, dist[p - g.W - 1] + d2); if (i < g.W - 1 && j > 0) v = Math.min(v, dist[p - g.W + 1] + d2);
    dist[p] = v;
  }
  for (let j = g.H - 1; j >= 0; j--) for (let i = g.W - 1; i >= 0; i--) {
    const p = j * g.W + i; let v = dist[p];
    if (i < g.W - 1) v = Math.min(v, dist[p + 1] + r); if (j < g.H - 1) v = Math.min(v, dist[p + g.W] + r);
    if (i < g.W - 1 && j < g.H - 1) v = Math.min(v, dist[p + g.W + 1] + d2); if (i > 0 && j < g.H - 1) v = Math.min(v, dist[p + g.W - 1] + d2);
    dist[p] = v;
  }
  for (let J = 0; J < H; J++) for (let I = 0; I < W; I++) {
    let sd = 0, sh = 0, st = 0, ss = 0, sea = 0, n = 0, maxSl = 0, sedVote = new Uint16Array(6);
    for (let jj = 0; jj < step; jj++) for (let ii = 0; ii < step; ii++) {
      const i = I * step + ii, j = J * step + jj, p = j * g.W + i;
      if (g.mask[p] === 0) continue;
      const zx = g.z[j * g.W + Math.min(g.W - 1, i + 1)] - g.z[j * g.W + Math.max(0, i - 1)];
      const zy = g.z[Math.min(g.H - 1, j + 1) * g.W + i] - g.z[Math.max(0, j - 1) * g.W + i];
      const sl = Math.atan(Math.hypot(zx, zy) / (2 * g.res)) * 57.3;
      sd += -g.z[p]; sh += g.hard[p] / 255; st += g.tpi[p]; ss += sl; maxSl = Math.max(maxSl, sl); sea++; n++;
      sedVote[g.sed[p]]++;
    }
    const q = J * W + I;
    if (n === 0) { f.sea[q] = 0; continue; }
    f.sea[q] = sea / (step * step) > 0.5 ? 1 : 0;
    f.depth[q] = sd / n; f.hard[q] = sh / n; f.tpi[q] = st / n; f.slope[q] = Math.max(ss / n, maxSl * 0.6);
    let best = 0; for (let k = 1; k < 6; k++) if (sedVote[k] > sedVote[best]) best = k; f.sed[q] = best;
    const ci = Math.min(g.W - 1, I * step + (step >> 1)), cj = Math.min(g.H - 1, J * step + (step >> 1));
    f.shore[q] = dist[cj * g.W + ci];
  }
  // nær dypere vann (innen 300 m) og nær skrent (innen 60 m)
  f.deeper = new Float32Array(W * H); f.nearSteep = new Float32Array(W * H);
  const R1 = Math.max(1, Math.round(300 / f.cell)), R2 = Math.max(1, Math.round(60 / f.cell));
  for (let J = 0; J < H; J++) for (let I = 0; I < W; I++) {
    const q = J * W + I; if (!f.sea[q]) continue;
    let mx = f.depth[q], ms = 0;
    for (let dj = -R1; dj <= R1; dj += 2) for (let di = -R1; di <= R1; di += 2) {
      const a = I + di, b = J + dj; if (a < 0 || b < 0 || a >= W || b >= H) continue;
      const qq = b * W + a; if (f.sea[qq] && f.depth[qq] > mx) mx = f.depth[qq];
      if (Math.abs(di) <= R2 && Math.abs(dj) <= R2 && f.slope[qq] > ms) ms = f.slope[qq];
    }
    f.deeper[q] = mx - f.depth[q]; f.nearSteep[q] = ms;
  }
  return f;
}

function rangeFit(d, core, range) {
  if (d >= core[0] && d <= core[1]) return 1;
  if (d < range[0] || d > range[1]) return 0;
  if (d < core[0]) return 0.15 + 0.85 * clamp01((d - range[0]) / Math.max(1, core[0] - range[0]));
  return 0.15 + 0.85 * clamp01((range[1] - d) / Math.max(1, range[1] - core[1]));
}

export function depthPref(sp, month) {
  const S = SPECIES[sp]; let core = S.depth.core, range = S.depth.range;
  for (const [k, v] of Object.entries(S.depth.mnd || {})) {
    const [a, b] = k.split('-').map(Number), m = month + 1;
    if (a <= b ? m >= a && m <= b : m >= a || m <= b) { core = v.core || core; range = v.range || range; }
  }
  return { core, range };
}

// Terrengtrekk (0–1) i en habitatcelle
export function terrainTraits(f, q) {
  const slope = f.slope[q], tpi = f.tpi[q];
  return {
    edge: clamp01((slope - 8) / 20),
    peak: clamp01(tpi / 5),
    shore: clamp01(1 - f.shore[q] / 160),
    flat: clamp01(1 - slope / 7),
    basin: clamp01(-tpi / 4) * clamp01(1 - slope / 8),
    foot: clamp01(-tpi / 3) * (f.nearSteep[q] > 15 ? 1 : 0.35),
    neardeep: clamp01(f.deeper[q] / 40),
  };
}

// Habitatkvalitet 0–1 for en art i en celle
export function suitability(sp, f, q, month, sst = 10) {
  const S = SPECIES[sp];
  if (!f.sea[q]) return 0;
  const depth = f.depth[q];
  const { core, range } = depthPref(sp, month);
  let dfit = S.pelagic && !S.surface ? Math.max(rangeFit(depth, core, range), depth > core[0] ? 0.6 : 0) : S.surface ? (depth > 6 ? 1 : 0.4) : rangeFit(depth, core, range);
  if (dfit <= 0) return 0;
  const t = terrainTraits(f, q);
  let tw = 0, ts = 0;
  for (const [k, w] of Object.entries(S.terr || {})) { tw += w; ts += w * t[k]; }
  const terr = tw > 0 ? ts / tw : 0.5;
  let bot = 1;
  if (S.bunn && S.bunn.hardPref != null && !S.pelagic) bot = 1 - Math.abs(f.hard[q] - S.bunn.hardPref) * 0.85;
  if (f.sed[q] && S.bunn) {
    if ((S.bunn.pref || []).includes(f.sed[q])) bot = Math.max(bot, 0.95);
    if ((S.bunn.avoid || []).includes(f.sed[q])) bot *= 0.35;
  }
  if (S.bunn && S.bunn.overgang) { /* lange: overgangen hard/myk – kanter gir bonus */ bot = Math.min(1, bot + 0.2 * t.edge); }
  let temp = 1;
  if (S.tempMin && sst < S.tempMin) temp = Math.max(0.05, 1 - (S.tempMin - sst) / 3);
  return dfit * (0.3 + 0.7 * terr) * Math.max(0.05, bot) * temp;
}
