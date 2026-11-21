// Broer (også flytebruer) er tegnet som land i sjøkartets dybdeområder. Uten rettelse ville dybden mellom
// kurvene gå mot 0 m inntil brua, og båten kunne ikke krysse den. Her finnes smale, lange landstriper som
// er festet til land i begge ender (typisk bru), og de gjøres om til sjø med dybdeintervallet fra vannet ved siden av.
// Smale holmer og skjær (ikke festet til land) og odder/kaier (festet i én ende) beholdes som land.
import { edt } from './contourdepth.js';

/**
 * @param {Int8Array} cls  −1 land, −2 tørrfall, ≥0 dybdeintervall. Endres på stedet.
 * @param {number} res  meter per celle
 * @param {Uint8Array} [mask]  0 land, 1 sjø, 2 tørrfall – oppdateres også
 * @returns {number} antall celler som ble gjort om til sjø
 */
export function openBridges(cls, W, H, res, mask = null, { halfWidth = 11, minLen = 30, elong = 3, gap = 28 } = {}) {
  const N = W * H;
  const rT = Math.max(1, halfWidth / res);
  const notLand = new Uint8Array(N);
  let land = 0;
  for (let p = 0; p < N; p++) { if (cls[p] !== -1) notLand[p] = 1; else land++; }
  if (!land || land === N) return 0;
  // morfologisk åpning av landet med en skive (radius rT): det som ikke dekkes, er smalt land
  const dW = edt(notLand, W, H);
  const core = new Uint8Array(N); let anyCore = false;
  for (let p = 0; p < N; p++) if (cls[p] === -1 && dW[p] > rT * rT) { core[p] = 1; anyCore = true; }
  const dC = anyCore ? edt(core, W, H) : null;
  const r2 = (rT + 0.75) ** 2;
  const thin = new Uint8Array(N); let anyThin = false;
  for (let p = 0; p < N; p++) if (cls[p] === -1 && (!dC || dC[p] > r2)) { thin[p] = 1; anyThin = true; }
  if (!anyThin) return 0;

  const seen = new Uint8Array(N), stack = new Int32Array(N), pix = new Int32Array(N);
  let changed = 0;
  const gapPx = Math.max(4, gap / res), minLenPx = minLen / res;
  for (let s = 0; s < N; s++) {
    if (!thin[s] || seen[s]) continue;
    // sammenhengende stripe (8-naboskap)
    let sp = 0, n = 0; stack[sp++] = s; seen[s] = 1;
    let i0 = W, i1 = -1, j0 = H, j1 = -1;
    while (sp) {
      const p = stack[--sp]; pix[n++] = p;
      const i = p % W, j = (p / W) | 0;
      if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj; if (jj < 0 || jj >= H) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di; if (ii < 0 || ii >= W) continue;
          const q = jj * W + ii;
          if (thin[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
        }
      }
    }
    const L = Math.hypot(i1 - i0 + 1, j1 - j0 + 1), width = n / L;
    if (L < minLenPx || L < elong * width) continue;
    // festepunkter mot bredt land: må finnes i (minst) to ender som ligger et stykke fra hverandre
    let ax = -1, ay = -1, far = 0;
    for (let k = 0; k < n; k++) {
      const p = pix[k], i = p % W, j = (p / W) | 0;
      let touches = false;
      for (let dj = -1; dj <= 1 && !touches; dj++) {
        const jj = j + dj; if (jj < 0 || jj >= H) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di; if (ii < 0 || ii >= W) continue;
          const q = jj * W + ii;
          if (cls[q] === -1 && !thin[q]) { touches = true; break; }
        }
      }
      // stripe som går ut av bildet regnes som festet der (vi ser ikke hva som er utenfor)
      if (!touches && (i === 0 || j === 0 || i === W - 1 || j === H - 1)) touches = true;
      if (!touches) continue;
      if (ax < 0) { ax = i; ay = j; } else far = Math.max(far, Math.hypot(i - ax, j - ay));
    }
    if (ax < 0 || far < gapPx) continue;
    for (let k = 0; k < n; k++) cls[pix[k]] = -9;
    changed += n;
  }
  if (!changed) return 0;
  // fyll med dybdeintervallet fra sjøen rett ved siden av, runde for runde
  const snap = new Int8Array(N), cnt = new Int32Array(128);
  for (let pass = 0; pass < 64; pass++) {
    let left = 0;
    snap.set(cls); // bare verdier fra forrige runde, så grunne klasser ikke sprer seg langs hele brua
    for (let p = 0; p < N; p++) {
      if (snap[p] !== -9) continue;
      const i = p % W, j = (p / W) | 0;
      // vanligste klasse blant naboene (likt: den grunneste), så kurvene krysser brua omtrent der de ville gjort
      let best = -1, bestN = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj; if (jj < 0 || jj >= H) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di; if (ii < 0 || ii >= W) continue;
          const c = snap[jj * W + ii];
          if (c < 0) continue;
          cnt[c]++;
          if (cnt[c] > bestN || (cnt[c] === bestN && c < best)) { best = c; bestN = cnt[c]; }
        }
      }
      for (let dj = -1; dj <= 1; dj++) { const jj = j + dj; if (jj < 0 || jj >= H) continue; for (let di = -1; di <= 1; di++) { const ii = i + di; if (ii < 0 || ii >= W) continue; const c = snap[jj * W + ii]; if (c >= 0) cnt[c] = 0; } }
      if (best >= 0) { cls[p] = best; if (mask) mask[p] = 1; } else left++;
    }
    if (!left) break;
  }
  for (let p = 0; p < N; p++) if (cls[p] === -9) cls[p] = -1;
  return changed;
}

/**
 * Flytebruer (f.eks. Nordhordlandsbrua): pongtongene er tegnet som en rekke små «holmer» på linje i sjøkartet.
 * Finner rekker av minst 5 like store, små holmer (150–3000 m²) som ligger på en nesten rett (evt. svakt buet) linje med jevn avstand (under 160 m),
 * og gjør dem om til sjø med dybdeintervallet rundt. Vanlige holmer og skjær ligger sjelden slik.
 * @returns {number} antall celler som ble gjort om til sjø
 */
export function openPontoons(cls, W, H, res) {
  const N = W * H, a1 = 150 / (res * res), a2 = 3000 / (res * res), maxD = 160 / res;
  const seen = new Uint8Array(N), st = new Int32Array(N), isl = [];
  for (let s = 0; s < N; s++) {
    if (cls[s] !== -1 || seen[s]) continue;
    let sp = 0, n = 0, sx = 0, sy = 0, edge = false; const pix = []; st[sp++] = s; seen[s] = 1;
    while (sp) {
      const p = st[--sp]; n++; const i = p % W, j = (p / W) | 0; sx += i; sy += j; if (pix.length <= a2 + 1) pix.push(p);
      if (i === 0 || j === 0 || i === W - 1 || j === H - 1) edge = true;
      if (i > 0 && cls[p - 1] === -1 && !seen[p - 1]) { seen[p - 1] = 1; st[sp++] = p - 1; }
      if (i < W - 1 && cls[p + 1] === -1 && !seen[p + 1]) { seen[p + 1] = 1; st[sp++] = p + 1; }
      if (j > 0 && cls[p - W] === -1 && !seen[p - W]) { seen[p - W] = 1; st[sp++] = p - W; }
      if (j < H - 1 && cls[p + W] === -1 && !seen[p + W]) { seen[p + W] = 1; st[sp++] = p + W; }
    }
    if (!edge && n >= a1 && n <= a2) isl.push({ x: sx / n, y: sy / n, pix, g: -1 });
  }
  if (isl.length < 4) return 0;
  // grupper holmer som ligger nær hverandre
  let ng = 0;
  for (let k = 0; k < isl.length; k++) {
    if (isl[k].g >= 0) continue; isl[k].g = ng; const q = [k];
    while (q.length) { const a = isl[q.pop()]; for (const b of isl) if (b.g < 0 && Math.hypot(a.x - b.x, a.y - b.y) <= maxD) { b.g = ng; q.push(isl.indexOf(b)); } }
    ng++;
  }
  let changed = 0;
  for (let g = 0; g < ng; g++) {
    const m = isl.filter((o) => o.g === g); if (m.length < 5) continue;
    // pongtongene er like store; naturlige skjærrekker er det sjelden
    const sz = m.map((o) => o.pix.length), sm = sz.reduce((a, b) => a + b, 0) / sz.length;
    if (Math.sqrt(sz.reduce((a, b) => a + (b - sm) ** 2, 0) / sz.length) > 0.3 * sm) continue;
    // rett linje (hovedakse) og jevn avstand
    const mx = m.reduce((s, o) => s + o.x, 0) / m.length, my = m.reduce((s, o) => s + o.y, 0) / m.length;
    let sxx = 0, syy = 0, sxy = 0; for (const o of m) { const dx = o.x - mx, dy = o.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th);
    const along = m.map((o) => (o.x - mx) * ux + (o.y - my) * uy).sort((p, q) => p - q);
    const rms = Math.sqrt(m.reduce((s, o) => s + ((o.x - mx) * -uy + (o.y - my) * ux) ** 2, 0) / m.length) * res;
    const gaps = along.slice(1).map((v, i) => v - along[i]), gm = gaps.reduce((s, v) => s + v, 0) / gaps.length;
    const gsd = Math.sqrt(gaps.reduce((s, v) => s + (v - gm) ** 2, 0) / gaps.length);
    // flytebruer kan være buet: tillat avvik fra rett linje på inntil 5 % av lengden
    const len = (along[along.length - 1] - along[0]) * res;
    if (rms > Math.max(25, 0.05 * len) || gsd > 0.35 * gm) continue;
    // kjede, ikke klynge: hver holme har høyst to naboer innen avstanden
    if (m.some((a) => m.filter((b) => b !== a && Math.hypot(a.x - b.x, a.y - b.y) <= maxD).length > 2)) continue;
    for (const o of m) for (const p of o.pix) { cls[p] = -9; changed++; }
  }
  if (!changed) return 0;
  // fyll med flertallsklassen fra sjøen rundt, runde for runde
  for (let pass = 0; pass < 40; pass++) {
    const snap = cls.slice(); let left = 0;
    for (let p = 0; p < N; p++) {
      if (snap[p] !== -9) continue;
      const i = p % W, j = (p / W) | 0, cnt = new Map(); let best = -9, bn = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
        const v = snap[jj * W + ii]; if (v < 0) continue; const c = (cnt.get(v) || 0) + 1; cnt.set(v, c); if (c > bn) { bn = c; best = v; }
      }
      if (best >= 0) cls[p] = best; else left++;
    }
    if (!left) break;
  }
  for (let p = 0; p < N; p++) if (cls[p] === -9) cls[p] = -1;
  return changed;
}
