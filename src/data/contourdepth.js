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
  const out = new Float32Array(W * H); // kvadrerte avstander i celler er heltall < 2^24: eksakt i 32 bit
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
export function contourDepth(cls, W, H, res, intervals, prior = null, maxDist = 0, smooth = 2) {
  // maxDist (celler): kurver lenger unna enn dette regnes som «ikke funnet». Gir like svar uansett hvor i
  // en kartflis punktet ligger, så flisene passer sammen uten skjøter.
  const cap = maxDist > 0 ? maxDist * maxDist : INF;
  const N = W * H, depth = new Float32Array(N).fill(NaN);
  const present = new Set();
  for (let p = 0; p < N; p++) if (cls[p] >= 0) present.add(cls[p]);
  // grunnere/dypere avgjøres av intervallene (ikke rekkefølgen), så også grove intervaller som 0,5–100 m virker
  const shallowerThan = (c, lo) => c < 0 || intervals[c][2] <= lo + 1e-6;
  const deeperThan = (c, hi) => c >= 0 && intervals[c][1] >= hi - 1e-6;
  // utstrekningen til hvert intervall: avstandene regnes bare i et vindu rundt intervallet, utvidet med rekkevidden
  // (kurver lenger unna enn maxDist teller ikke uansett), så små intervaller koster lite. Gir nøyaktig samme svar.
  const bx = new Map();
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const c = cls[j * W + i]; if (c < 0) continue;
    let b = bx.get(c); if (!b) bx.set(c, b = [i, j, i, j]); else { if (i < b[0]) b[0] = i; if (i > b[2]) b[2] = i; if (j < b[1]) b[1] = j; if (j > b[3]) b[3] = j; } }
  const ext = maxDist > 0 ? maxDist + 1 : Math.max(W, H);
  for (const k of present) {
    const lo = intervals[k][1], hi = intervals[k][2], b0 = bx.get(k);
    const x0 = Math.max(0, b0[0] - ext), y0 = Math.max(0, b0[1] - ext), x1 = Math.min(W - 1, b0[2] + ext), y1 = Math.min(H - 1, b0[3] + ext);
    const Ww = x1 - x0 + 1, Hw = y1 - y0 + 1, feat = new Uint8Array(Ww * Hw);
    for (let j = 0; j < Hw; j++) for (let i = 0; i < Ww; i++) feat[j * Ww + i] = shallowerThan(cls[(j + y0) * W + i + x0], lo) ? 1 : 0;   // land, tørrfall og grunnere områder
    const dAw = edt(feat, Ww, Hw);
    let anyDeeper = false;
    for (let j = 0; j < Hw; j++) for (let i = 0; i < Ww; i++) { const v = deeperThan(cls[(j + y0) * W + i + x0], hi) ? 1 : 0; feat[j * Ww + i] = v; if (v) anyDeeper = true; }
    const dBw = anyDeeper ? edt(feat, Ww, Hw) : null;
    const wi = (p) => ((p / W | 0) - y0) * Ww + (p % W) - x0;
    // typisk avstand mellom kurvene brukes der en av dem mangler (5 % helning)
    const Ls = Math.max(40, (hi - lo) / 0.05);
    // Når en kurve nærmer seg rekkevidden (maxDist), tones den ut mykt i stedet for å forsvinne brått:
    // da blir det ingen synlige kanter i flaten der den ene kurven går ut av rekkevidde.
    const capM = cap < INF ? Math.sqrt(cap) * res : Infinity, fadeM = capM * 0.45;
    const wOf = (m) => capM === Infinity ? 1 : m >= capM ? 0 : m <= capM - fadeM ? 1 : (() => { const t = (capM - m) / fadeM; return t * t * (3 - 2 * t); })();
    for (let jj = b0[1]; jj <= b0[3]; jj++) for (let ii = b0[0]; ii <= b0[2]; ii++) {
      const p = jj * W + ii;
      if (cls[p] !== k) continue;
      const q = wi(p), dA = dAw[q], dB = dBw ? dBw[q] : INF;
      const a = dA >= INF || dA > cap ? Infinity : Math.sqrt(dA) * res;
      const b = dB >= INF || dB > cap ? Infinity : Math.sqrt(dB) * res;
      const fa = a < Infinity ? wOf(a) : 0, fb = b < Infinity ? wOf(b) : 0;
      const pr = prior && prior[p] === prior[p] ? Math.min(hi, Math.max(lo, prior[p])) : null;
      // fire tilfeller blandes etter hvor godt kurvene «sees»
      const eAB = fa > 0 && fb > 0 ? lo + (hi - lo) * a / (a + b) : 0;
      // bare grunnere kurve: bunnen av et basseng, dybden øker bort fra kurven og flater ut
      const eA = fa > 0 && fb < 1 ? (pr != null ? lo + (pr - lo) * (1 - Math.exp(-a / Math.min(Ls, 200))) : lo + (hi - lo) * (1 - Math.exp(-a / Ls))) : 0;
      // bare dypere kurve: toppen av en grunne
      const eB = fb > 0 && fa < 1 ? (pr != null ? hi - (hi - pr) * (1 - Math.exp(-b / Math.min(Ls, 200))) : hi - (hi - lo) * (1 - Math.exp(-b / Ls))) : 0;
      const e0 = pr != null ? pr : (lo + hi) / 2;
      const d = fa * fb * eAB + fa * (1 - fb) * eA + (1 - fa) * fb * eB + (1 - fa) * (1 - fb) * e0;
      depth[p] = d;
    }
  }
  for (let p = 0; p < N; p++) if (cls[p] === -2) depth[p] = -0.4;
  smoothWithin(depth, cls, W, H, intervals, smooth);
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

/**
 * Målte punkter (loddskudd og grunner) i fiskekartet. Avviket mellom punktet og anslaget spres jevnt ut rundt
 * punktet (normert Gauss-vekt, så en klynge punkter gir samme avvik mellom seg, ikke «kuler»). Der sjøkartet bare har
 * et grovt intervall (f.eks. 0,5–100 m) rekker hvert punkt lenger (sigG), ellers sigma. Resultatet holdes innenfor
 * intervallet. Returnerer punktene som «nåler» (celle, dybde) til diffuseWithin, så flaten går jevnt fra punktene
 * over til neste kjente dybde (kurve eller land).
 * points: [kol, rad, dybde, …] i cellekoordinater. coarse(k): true for grove intervall-klasser.
 */
export function fitPoints(depth, cls, W, H, res, points, intervals, coarse, sigma = 90, sigG = 200) {
  const pins = [];
  if (!points.length) return pins;
  const sum = new Float32Array(W * H), wsum = new Float32Array(W * H);
  for (let k = 0; k < points.length; k += 3) {
    const ci = points[k], cj = points[k + 1], pd = points[k + 2];
    const i0 = Math.round(ci), j0 = Math.round(cj);
    if (i0 < 0 || j0 < 0 || i0 >= W || j0 >= H) continue;
    const p0 = j0 * W + i0, here = depth[p0], c = cls[p0];
    if (!(here === here) || c < 0) continue;
    const lo = intervals[c][1], hi = intervals[c][2], v = Math.min(hi, Math.max(lo, pd));
    pins.push(p0, v);
    const sg = (coarse(c) ? sigG : sigma) / res, rad = Math.ceil(sg * 2.2), s2 = 2 * sg * sg, r = v - here;
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
    if (!wsum[p] || !(depth[p] === depth[p]) || cls[p] < 0) continue;
    const lo = intervals[cls[p]][1], hi = intervals[cls[p]][2];
    // vekten mot 1 nær punktene og mot 0 langt unna (0,15 ≈ et punkt i ca. 2 sigma avstand)
    // jevn interpolasjon mellom punktene: nesten full vekt så lenge det finnes et punkt innen ca. 2 sigma (ikke tilbake
    // til modellen mellom to nære punkter, som ga «flekker»), og en myk overgang til kurvene lenger unna
    const v = depth[p] + sum[p] / (wsum[p] + 0.02) * Math.min(1, wsum[p] / 0.1);
    depth[p] = v < lo ? lo : v > hi ? hi : v;
  }
  return pins;
}

/**
 * Utglatting med føringer: gjentatt lite boksfilter over sjøcellene, og etter hver runde klemmes hver celle inn i
 * sitt eget intervall igjen. Det gir den glatteste flaten som fortsatt holder seg innenfor sjøkartets intervaller
 * (kurvene blir liggende der de ligger), og fjerner «kammer» som oppstår ved taggete kurver i dypt vann.
 * iters runder med radius r: glatter over omtrent r·√(iters·2/3) celler.
 */
export function diffuseWithin(depth, cls, W, H, intervals, iters, r = 2, pins = null) {
  if (iters < 1) return;
  const N = W * H, ok = new Uint8Array(N), lo = new Float32Array(N), hi = new Float32Array(N);
  for (let p = 0; p < N; p++) { const k = cls[p]; if (k >= 0 && depth[p] === depth[p]) { ok[p] = 1; lo[p] = intervals[k][1]; hi[p] = intervals[k][2]; } }
  const v = new Float32Array(N), c = new Float32Array(N), tv = new Float32Array(N), tc = new Float32Array(N);
  const pass = (src, srcC, dst, dstC, horiz) => {
    const L = horiz ? W : H, M = horiz ? H : W, st = horiz ? 1 : W, ln = horiz ? W : 1;
    for (let m = 0; m < M; m++) {
      const o = m * ln; let s = 0, n = 0;
      for (let q = 0; q <= Math.min(L - 1, r); q++) { s += src[o + q * st]; n += srcC[o + q * st]; }
      for (let q = 0; q < L; q++) {
        const p = o + q * st; dst[p] = s; dstC[p] = n;
        const a = q + r + 1, b = q - r;
        if (a < L) { s += src[o + a * st]; n += srcC[o + a * st]; }
        if (b >= 0) { s -= src[o + b * st]; n -= srcC[o + b * st]; }
      }
    }
  };
  for (let it = 0; it < iters; it++) {
    // land og tørrfall står fast på 0 m, så flaten går mot null ved land også der sjøkartet bare har et grovt intervall
    for (let p = 0; p < N; p++) { if (ok[p]) { v[p] = depth[p]; c[p] = 1; } else if (cls[p] === -1 || cls[p] === -2) { v[p] = 0; c[p] = 1; } else { v[p] = 0; c[p] = 0; } }
    pass(v, c, tv, tc, true); pass(tv, tc, v, c, false);
    for (let p = 0; p < N; p++) if (ok[p] && c[p] > 0) { const d = v[p] / c[p]; depth[p] = d < lo[p] ? lo[p] : d > hi[p] ? hi[p] : d; }
    // målte punkter står fast
    if (pins) for (let k = 0; k < pins.length; k += 2) depth[pins[k]] = pins[k + 1];
  }
}

/**
 * Brå kanter: der flere dybdekurver ligger oppå hverandre (f.eks. 150, 200, 250, 300 og 400 m ved Salhus), hopper
 * dybden flere intervaller fra én celle til den neste. Her finnes slike sprang (mer enn jump meter mellom naboceller),
 * og i et belte på ca. band meter rundt dem glattes dybden uten å holdes inne i sjøkartets intervaller. Resultatet er
 * en bratt bakke i stedet for en loddrett vegg. Utenfor beltet er dybden uendret, og land står fast.
 * Merk: i beltet kan dybden avvike fra intervallet i sjøkartet (bakken legges litt ut på begge sider av kurvene).
 */
export function relaxCliffs(depth, W, H, res, jump = 25, band = 50) {
  const N = W * H, cliff = new Uint8Array(N);
  let any = false;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const p = j * W + i, d = depth[p]; if (!(d === d)) continue;
    if (i + 1 < W) { const e = depth[p + 1]; if (e === e && Math.abs(e - d) > jump) { cliff[p] = cliff[p + 1] = 1; any = true; } }
    if (j + 1 < H) { const e = depth[p + W]; if (e === e && Math.abs(e - d) > jump) { cliff[p] = cliff[p + W] = 1; any = true; } }
  }
  if (!any) return 0;
  // beltet: avstand til et sprang (EDT i celler)
  const R = Math.max(2, Math.round(band / res)), dist = edt(cliff, W, H), free = new Uint8Array(N);
  let n = 0;
  for (let p = 0; p < N; p++) if (depth[p] === depth[p] && dist[p] <= R * R) { free[p] = 1; n++; } // edt gir kvadrert avstand
  // glatting innenfor beltet; cellene utenfor (og land) står fast og gir randverdiene
  const v = new Float32Array(N), c = new Float32Array(N), tv = new Float32Array(N), tc = new Float32Array(N), r = 2;
  const pass = (src, srcC, dst, dstC, horiz) => {
    const L = horiz ? W : H, M = horiz ? H : W, st = horiz ? 1 : W, ln = horiz ? W : 1;
    for (let m = 0; m < M; m++) {
      const o = m * ln; let a = 0, b = 0;
      for (let q = 0; q <= Math.min(L - 1, r); q++) { a += src[o + q * st]; b += srcC[o + q * st]; }
      for (let q = 0; q < L; q++) {
        const p = o + q * st; dst[p] = a; dstC[p] = b;
        const x = q + r + 1, y = q - r;
        if (x < L) { a += src[o + x * st]; b += srcC[o + x * st]; }
        if (y >= 0) { a -= src[o + y * st]; b -= srcC[o + y * st]; }
      }
    }
  };
  const iters = Math.min(120, Math.max(4, Math.round(R * R / 2)));
  for (let it = 0; it < iters; it++) {
    for (let p = 0; p < N; p++) { const d = depth[p]; if (d === d) { v[p] = d; c[p] = 1; } else { v[p] = 0; c[p] = 0; } }
    pass(v, c, tv, tc, true); pass(tv, tc, v, c, false);
    for (let p = 0; p < N; p++) if (free[p] && c[p] > 0) depth[p] = v[p] / c[p];
  }
  return n;
}
