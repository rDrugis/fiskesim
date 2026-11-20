// Dybde mellom dybdekurvene: for hvert punkt i et dybdeområde (f.eks. 20–30 m) brukes avstanden til nærmeste
// grunnere kurve (dA) og nærmeste dypere kurve (dB): dybde = lo + (hi − lo) · dA / (dA + dB).
// Avstandene regnes med eksakt euklidsk avstandstransform (Felzenszwalb & Huttenlocher 2012).
// Der det ikke finnes en dypere kurve innen rekkevidde (bunnen av et basseng), brukes 50 m-modellen innenfor intervallet.

const INF = 1e20;

// 1D kvadrert avstandstransform langs en linje (nedre omhylling av parabler; uendelige verdier hoppes over)
function dt1(f, n, d, v, z) {
  let k = -1;
  for (let q = 0; q < n; q++) {
    if (f[q] >= INF) continue;
    if (k < 0) { k = 0; v[0] = q; z[0] = -INF; z[1] = INF; continue; }
    let r = v[k], s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r);
    while (s <= z[k]) { k--; r = v[k]; s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  if (k < 0) { for (let q = 0; q < n; q++) d[q] = INF; return; }
  let j = 0;
  for (let q = 0; q < n; q++) {
    while (z[j + 1] < q) j++;
    const r = v[j];
    d[q] = (q - r) * (q - r) + f[r];
  }
}

// Kvadrert avstand (i celler) til nærmeste celle der feat er sann
export function edt(feat, W, H) {
  const out = new Float64Array(W * H);
  const n = Math.max(W, H);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = feat[y * W + x] ? 0 : INF;
    dt1(f, H, d, v, z);
    for (let y = 0; y < H; y++) out[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) f[x] = out[o + x];
    dt1(f, W, d, v, z);
    for (let x = 0; x < W; x++) out[o + x] = d[x];
  }
  return out;
}

/**
 * @param {Int8Array} cls  −1 land, −2 tørrfall, 0.. indeks i intervals
 * @param {Array} intervals  [[farge, lo, hi], …]
 * @param {number} res  cellestørrelse i meter
 * @param {Float32Array} [prior]  grov dybde (50 m-modellen), NaN der den mangler
 * @returns {Float32Array} dybde (positiv nedover), NaN på land, −0,4 på tørrfall
 */
export function contourDepth(cls, W, H, res, intervals, prior = null) {
  const N = W * H, depth = new Float32Array(N).fill(NaN);
  const present = new Set();
  for (let p = 0; p < N; p++) if (cls[p] >= 0) present.add(cls[p]);
  const feat = new Uint8Array(N);
  for (const k of present) {
    const lo = intervals[k][1], hi = intervals[k][2];
    for (let p = 0; p < N; p++) feat[p] = cls[p] < k ? 1 : 0;   // land, tørrfall og grunnere områder
    const dA = edt(feat, W, H);
    let anyDeeper = false;
    for (let p = 0; p < N; p++) { const b = cls[p] > k ? 1 : 0; feat[p] = b; if (b) anyDeeper = true; }
    const dB = anyDeeper ? edt(feat, W, H) : null;
    // typisk avstand mellom kurvene brukes der en av dem mangler (5 % helning)
    const Ls = Math.max(40, (hi - lo) / 0.05);
    for (let p = 0; p < N; p++) {
      if (cls[p] !== k) continue;
      const a = dA[p] >= INF ? Infinity : Math.sqrt(dA[p]) * res;
      const b = !dB || dB[p] >= INF ? Infinity : Math.sqrt(dB[p]) * res;
      let d;
      if (a < Infinity && b < Infinity) d = lo + (hi - lo) * a / (a + b);
      else {
        const pr = prior && prior[p] === prior[p] ? Math.min(hi, Math.max(lo, prior[p])) : null;
        if (a < Infinity) {
          // bunnen av et basseng: dybden øker bort fra den grunnere kurven og flater ut
          const ramp = lo + (hi - lo) * (1 - Math.exp(-a / Ls));
          d = pr != null ? lo + (pr - lo) * (1 - Math.exp(-a / Math.min(Ls, 200))) : ramp;
        } else if (b < Infinity) d = pr != null ? hi - (hi - pr) * (1 - Math.exp(-b / Math.min(Ls, 200))) : hi - (hi - lo) * (1 - Math.exp(-b / Ls));
        else d = pr != null ? pr : (lo + hi) / 2;
      }
      depth[p] = d;
    }
  }
  for (let p = 0; p < N; p++) if (cls[p] === -2) depth[p] = -0.4;
  smoothWithin(depth, cls, W, H, intervals, 2);
  return depth;
}

// Glatter ut «mønet» midt mellom kurvene uten å bryte intervallene (to runder 3×3 snitt, så klemming)
export function smoothWithin(depth, cls, W, H, intervals, rounds) {
  const tmp = new Float32Array(W * H);
  for (let r = 0; r < rounds; r++) {
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const p = j * W + i, c = depth[p];
      if (!(c === c) || cls[p] < 0) { tmp[p] = c; continue; }
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) { const jj = j + dj; if (jj < 0 || jj >= H) continue; for (let di = -1; di <= 1; di++) { const ii = i + di; if (ii < 0 || ii >= W) continue; const v = depth[jj * W + ii]; if (v === v) { s += v; n++; } } }
      tmp[p] = s / n;
    }
    for (let p = 0; p < W * H; p++) {
      let v = tmp[p];
      if (cls[p] >= 0 && v === v) { const lo = intervals[cls[p]][1], hi = intervals[cls[p]][2]; v = Math.min(hi, Math.max(lo, v)); }
      depth[p] = v;
    }
  }
}

/**
 * Justerer dybden mot målte punkter (loddskudd, grunner): avviket i hvert punkt spres ut med en Gauss-vekt.
 * points: [kol, rad, dybde, …] i cellekoordinater. sigma i meter.
 */
export function applyPoints(depth, cls, W, H, res, points, intervals, sigma = 30) {
  if (!points.length) return;
  const sum = new Float32Array(W * H), wsum = new Float32Array(W * H);
  const rad = Math.ceil((sigma * 2.5) / res), s2 = (sigma / res) ** 2;
  for (let k = 0; k < points.length; k += 3) {
    const ci = points[k], cj = points[k + 1], pd = points[k + 2];
    const i0 = Math.round(ci), j0 = Math.round(cj);
    if (i0 < 0 || j0 < 0 || i0 >= W || j0 >= H) continue;
    const here = depth[j0 * W + i0];
    if (!(here === here)) continue;
    const r = pd - here;
    for (let dj = -rad; dj <= rad; dj++) {
      const j = j0 + dj; if (j < 0 || j >= H) continue;
      for (let di = -rad; di <= rad; di++) {
        const i = i0 + di; if (i < 0 || i >= W) continue;
        const d2 = (i - ci) ** 2 + (j - cj) ** 2; if (d2 > rad * rad) continue;
        const w = Math.exp(-d2 / s2), p = j * W + i;
        sum[p] += w * r; wsum[p] += w;
      }
    }
  }
  for (let p = 0; p < W * H; p++) {
    if (!wsum[p] || !(depth[p] === depth[p])) continue;
    let v = depth[p] + sum[p] / (wsum[p] + 0.15);
    if (cls[p] >= 0) { const lo = intervals[cls[p]][1] - 1, hi = intervals[cls[p]][2] + 1; v = Math.min(hi, Math.max(lo, v)); }
    depth[p] = v;
  }
}
