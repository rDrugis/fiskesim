// Dybdemodell: anslår dybden i hver celle mellom sjøkartets dybdekurver.
//
// Grunnlag (Kartverket):
//  • Dybdeområdene i WMS-laget «Dybdelag» gir sjø/land og dybdeintervall per celle (fargen koder intervallet).
//    Grensen mellom to intervaller er en dybdekurve (5, 10, 20, 30 … m) og brukes som fast verdi.
//  • Dybdepunkter, grunner og skjær fra WFS-tjenesten gir eksakte dybder i enkeltpunkter.
//  • Dybdemodellen i 50 m-ruter (WCS) brukes som svak føring der det ikke finnes kurver eller punkter.
// Mellom de faste verdiene løses en glatt flate (Laplace med svak føring mot 50 m-modellen),
// med flernivå-løser. Resultatet holdes innenfor intervallet fra sjøkartet.

// Rød kanal i Kartverkets farger for «Dybdelag» → intervall (kontrollert mot GetFeatureInfo 20.11.2026).
export const DYBDELAG = [
  [230, 0.5, 5], [219, 5, 10], [209, 10, 20], [199, 20, 30], [195, 30, 40], [189, 40, 50],
  [184, 50, 100], [171, 100, 150], [166, 150, 200], [161, 200, 250], [156, 250, 300],
  [150, 300, 350], [145, 350, 400], [140, 400, 450], [137, 450, 500], [133, 500, 800], [120, 800, 1500],
];
export const SHORE_Z = 1.6; // strandlinja (middel høyvann) over sjøkartnull, typisk Vestlandet

function classOf(r, g, b) {
  // Dybdelag-fargene er lyseblå (B = 255, G > R). Andre farger regnes som tørrfall/annet.
  if (b < 240 || g < r) return -2;
  let best = -1, bd = 1e9;
  for (let k = 0; k < DYBDELAG.length; k++) { const d = Math.abs(DYBDELAG[k][0] - r); if (d < bd) { bd = d; best = k; } }
  return bd <= 6 ? best : -1;
}

// rgba: Uint8ClampedArray fra WMS GetMap (layers=Dybdelag,Torrfall). Gir maske og intervall.
export function decodeDybdelag(rgba, W, H) {
  const mask = new Uint8Array(W * H); // 0 land, 1 sjø, 2 tørrfall
  const cls = new Int8Array(W * H).fill(-1);
  for (let i = 0; i < W * H; i++) {
    const a = rgba[i * 4 + 3];
    if (a < 128) continue;
    const c = classOf(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    if (c === -2) { mask[i] = 2; continue; }
    mask[i] = 1; cls[i] = c;
  }
  // Kantpiksler (blandingsfarger) uten klasse: arv fra nabo
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const p = j * W + i; if (mask[p] !== 1 || cls[p] >= 0) continue;
      for (const q of [p - 1, p + 1, p - W, p + W]) { if (q >= 0 && q < W * H && cls[q] >= 0) { cls[p] = cls[q]; break; } }
    }
  }
  return { mask, cls };
}

// Leser punkter (Dybdepunkt, Grunne, Skjær) fra WFS GML 3.2. Returnerer [x, y, dybde, …] i UTM33.
export function parseWfsPoints(text, depthTag = 'dybde') {
  const out = [];
  const parts = text.split('<wfs:member>');
  const re = new RegExp('<app:' + depthTag + '>([^<]*)</app:' + depthTag + '>');
  for (let k = 1; k < parts.length; k++) {
    const m = parts[k];
    const p = m.match(/<gml:pos>([^<]*)</);
    if (!p) continue;
    const xy = p[1].trim().split(/\s+/);
    const d = depthTag ? m.match(re) : null;
    out.push(+xy[0], +xy[1], d ? parseFloat(d[1]) : 0);
  }
  return out;
}

// Fyller hull i prior (50 m-modellen) med nærmeste gyldige verdi (enkel utvidelse).
function fillNaN(a, W, H, maxPass = 64) {
  for (let pass = 0; pass < maxPass; pass++) {
    let changed = 0; const src = a.slice();
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const p = j * W + i; if (src[p] === src[p]) continue;
      let s = 0, n = 0;
      if (i > 0 && src[p - 1] === src[p - 1]) { s += src[p - 1]; n++; }
      if (i < W - 1 && src[p + 1] === src[p + 1]) { s += src[p + 1]; n++; }
      if (j > 0 && src[p - W] === src[p - W]) { s += src[p - W]; n++; }
      if (j < H - 1 && src[p + W] === src[p + W]) { s += src[p + W]; n++; }
      if (n) { a[p] = s / n; changed++; }
    }
    if (!changed) break;
  }
}

function downsample(src, W, H, mode) {
  const w = Math.ceil(W / 2), h = Math.ceil(H / 2), out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let s = 0, n = 0, mn = Infinity;
    for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
      const ii = 2 * i + di, jj = 2 * j + dj; if (ii >= W || jj >= H) continue;
      const v = src[jj * W + ii]; if (v !== v) continue; s += v; n++; if (v < mn) mn = v;
    }
    out[j * w + i] = n ? (mode === 'min' ? mn : s / n) : NaN;
  }
  return { a: out, w, h };
}

function upsample(src, w, h, W, H) {
  const out = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    const fy = Math.min(h - 1, Math.max(0, (j + 0.5) / 2 - 0.5)); const j0 = Math.floor(fy), j1 = Math.min(h - 1, j0 + 1), ty = fy - j0;
    for (let i = 0; i < W; i++) {
      const fx = Math.min(w - 1, Math.max(0, (i + 0.5) / 2 - 0.5)); const i0 = Math.floor(fx), i1 = Math.min(w - 1, i0 + 1), tx = fx - i0;
      const a = src[j0 * w + i0], b = src[j0 * w + i1], c = src[j1 * w + i0], d = src[j1 * w + i1];
      out[j * W + i] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}

// Rød-svart Gauss–Seidel med overrelaksasjon. Løser for avviket r = dybde − prior:
// fritt avvik glattes (Laplace) og dempes mot 0 bort fra faste verdier (skjerming lambda per celle).
function relax(r, fixed, lam, W, H, sweeps, omega, P, lo, hi, noClamp) {
  for (let s = 0; s < sweeps; s++) {
    for (let color = 0; color < 2; color++) {
      for (let j = 0; j < H; j++) {
        for (let i = (j + color) & 1; i < W; i += 2) {
          const p = j * W + i;
          if (fixed[p] === fixed[p]) continue;
          let sum = 0, n = 0;
          if (i > 0) { sum += r[p - 1]; n++; }
          if (i < W - 1) { sum += r[p + 1]; n++; }
          if (j > 0) { sum += r[p - W]; n++; }
          if (j < H - 1) { sum += r[p + W]; n++; }
          let v = r[p] + omega * (sum / (n + lam[p]) - r[p]);
          if (lo && !noClamp[p]) {
            const u = P[p] + v, a = lo[p], b = hi[p];
            if (a === a && u < a) v = a - P[p]; else if (b === b && u > b) v = b - P[p];
          }
          r[p] = v;
        }
      }
    }
  }
}

/**
 * Løser dybden (positiv nedover, negativ = over sjøkartnull) i et rutenett.
 * @param {object} o
 *  W,H,res          rutenettet
 *  mask, cls        fra decodeDybdelag (cls = indeks i DYBDELAG, −1 ukjent)
 *  prior            Float32Array med 50 m-modellens dybde (positiv), NaN der den mangler
 *  points           [col, row, dybde, …] i cellekoordinater (desimal), fra dybdepunkter og grunner
 *  rocks            [col, row, …] skjær
 *  screenLen        lengde (m) der 50 m-modellen begynner å styre mellom faste verdier
 */
export function solveDepth(o) {
  const { W, H, res, mask, cls } = o;
  const N = W * H;
  const prior = o.prior ? Float32Array.from(o.prior) : new Float32Array(N).fill(NaN);
  const lo = new Float32Array(N).fill(NaN), hi = new Float32Array(N).fill(NaN);
  const fixedSum = new Float32Array(N), fixedN = new Uint16Array(N);
  const noClamp = new Uint8Array(N);
  const add = (p, v) => { fixedSum[p] += v; fixedN[p]++; };

  for (let p = 0; p < N; p++) {
    if (mask[p] === 1 && cls[p] >= 0) {
      let a = DYBDELAG[cls[p]][1], b = DYBDELAG[cls[p]][2];
      // Lyseste farge brukes også for grove, ukartlagte intervaller (0,5–100 m). Stol da på 50 m-modellen.
      if (cls[p] === 0 && prior[p] === prior[p] && prior[p] > 9) { a = NaN; b = NaN; }
      lo[p] = a; hi[p] = b;
    } else if (mask[p] === 2) { lo[p] = -SHORE_Z; hi[p] = 0.3; }
  }

  // Faste verdier: kurver (grenser mellom intervaller) og strandlinja
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const p = j * W + i;
    if (mask[p] === 0) continue;
    const nbs = [];
    if (i < W - 1) nbs.push(p + 1); if (j < H - 1) nbs.push(p + W); if (i > 0) nbs.push(p - 1); if (j > 0) nbs.push(p - W);
    for (const q of nbs) {
      if (mask[q] === 0) { // kyst
        if (mask[p] === 2) add(p, -0.5);
        else add(p, lo[p] === lo[p] ? Math.max(0.5, lo[p] === 0.5 ? 0.5 : lo[p]) : 0.5);
        continue;
      }
      if (q < p) continue; // hver grense én gang (høyre/ned)
      const a = lo[p], b = hi[p], c = lo[q], d = hi[q];
      if (!(a === a && c === c) || (a === c && b === d)) continue;
      if (b <= c) { add(p, b); add(q, c); }
      else if (d <= a) { add(p, a); add(q, d); }
    }
  }
  const fixed = new Float32Array(N).fill(NaN);
  for (let p = 0; p < N; p++) {
    if (mask[p] === 0) fixed[p] = -SHORE_Z;
    else if (fixedN[p]) fixed[p] = fixedSum[p] / fixedN[p];
  }
  // Punkter overstyrer: dybdepunkter, grunner og skjær
  const setPt = (fx, fy, d, rad) => {
    const ci = Math.round(fx - 0.5), cj = Math.round(fy - 0.5);
    for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
      const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      const p = jj * W + ii;
      const r2 = di * di + dj * dj;
      if (r2 <= rad * rad && mask[p] !== 0) {
        if (r2 === 0 || fixed[p] !== fixed[p]) fixed[p] = d;
      }
    }
    const R = 3 + rad;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const ii = ci + di, jj = cj + dj; if (ii >= 0 && jj >= 0 && ii < W && jj < H) noClamp[jj * W + ii] = 1;
    }
  };
  const pts = o.points || [];
  for (let k = 0; k < pts.length; k += 3) setPt(pts[k], pts[k + 1], pts[k + 2], 0);
  const rocks = o.rocks || [];
  for (let k = 0; k < rocks.length; k += 2) setPt(rocks[k], rocks[k + 1], 0.0, res < 6 ? 1 : 0);

  // Prior: fyll hull, og bruk intervallets midte der 50 m-modellen mangler
  for (let p = 0; p < N; p++) {
    if (prior[p] !== prior[p] && lo[p] === lo[p] && hi[p] === hi[p] && mask[p] === 1) prior[p] = (lo[p] + hi[p]) / 2;
    if (mask[p] === 0) prior[p] = NaN;
  }

  // Prior overalt (fyll hull med naboverdier) og avvik i faste celler
  const P = Float32Array.from(prior);
  fillNaN(P, W, H, 400);
  for (let p = 0; p < N; p++) if (P[p] !== P[p]) P[p] = mask[p] === 0 ? -SHORE_Z : 10;
  const fixedR = new Float32Array(N).fill(NaN);
  for (let p = 0; p < N; p++) if (fixed[p] === fixed[p]) fixedR[p] = fixed[p] - P[p];
  // Skjerming: brede intervaller (dypt vann) stoler mer på 50 m-modellen, smale (nær land) mer på kurvene
  const screen = o.screenLen || 160;
  const lenFor = (p) => { const w = hi[p] - lo[p]; if (!(w === w)) return screen * 0.5; return w >= 50 ? screen * 0.35 : w >= 10 ? screen * 0.6 : screen; };

  // Flernivåløsning på avviket
  const levels = [{ W, H, fixed: fixedR, len: Float32Array.from({ length: N }, (_, p) => lenFor(p)) }];
  while (levels[levels.length - 1].W > 48 && levels[levels.length - 1].H > 48) {
    const L = levels[levels.length - 1];
    const f = downsample(L.fixed, L.W, L.H, 'mean'), ln = downsample(L.len, L.W, L.H, 'mean');
    levels.push({ W: f.w, H: f.h, fixed: f.a, len: ln.a });
  }
  let r = null;
  for (let k = levels.length - 1; k >= 0; k--) {
    const L = levels[k], resK = res * 2 ** k;
    const lam = new Float32Array(L.W * L.H);
    for (let p = 0; p < lam.length; p++) { const l = L.len[p] === L.len[p] ? L.len[p] : screen; lam[p] = (resK / l) ** 2; }
    if (!r) r = new Float32Array(L.W * L.H);
    else { const C = levels[k + 1]; r = upsample(r, C.W, C.H, L.W, L.H); }
    for (let p = 0; p < r.length; p++) if (L.fixed[p] === L.fixed[p]) r[p] = L.fixed[p];
    const sweeps = k === levels.length - 1 ? 300 : k === 0 ? 40 : 24;
    relax(r, L.fixed, lam, L.W, L.H, sweeps, 1.6, P, k === 0 ? lo : null, hi, noClamp);
  }
  const u = new Float32Array(N);
  for (let p = 0; p < N; p++) u[p] = P[p] + r[p];
  // Sikre at sjøceller ikke havner over strandlinja og at landceller er faste
  for (let p = 0; p < N; p++) {
    if (mask[p] === 0) u[p] = -SHORE_Z;
    else if (mask[p] === 1 && u[p] < 0.2 && !(fixed[p] === fixed[p] && fixed[p] < 0.2)) u[p] = 0.2;
  }
  return { depth: u, lo, hi, fixed };
}

// Intervallet slik det står i sjøkartet for en celle (til visning «ca. 34 m (30–40 m)»).
export function chartInterval(lo, hi, v) {
  if (!(lo === lo)) return null;
  if (lo === 10 && hi === 20) return v < 15 ? [10, 15] : [15, 20];
  return [lo, hi];
}
