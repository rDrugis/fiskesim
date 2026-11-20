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
