// Terrengmodellen (Kartverket, nasjonal topobaty-modell, 50 m i sjøen) som bunnform innenfor sjøkartets intervaller.
// Rekkefølgen er fast, så kildene ikke slåss:
//   1) sjøkartets dybdeintervaller er absolutte grenser
//   2) terrengmodellen gir bare FORMEN på bunnen innenfor intervallet, og viker der sjøkartet vet mer:
//      nær land, der dybdekurvene ligger tettere enn modellens 50 m-ruter, og mot kanten av området den dekker
//   3) loddskuddene er fasit og retter alt rundt seg (fitPoints etterpå)
import { edt } from '../../src/data/contourdepth.js';

export const WMAX = 0.8;                                         // største vekt på terrengmodellen
const LAND = [75, 200], KURVE = [25, 100], KANT = [100, 400];    // avstander (m) der den tones inn
const ramp = (m, [a, b]) => { const s = Math.min(1, Math.max(0, (m - a) / (b - a))); return s * s * (3 - 2 * s); };

function bil(a, N, u, v) {
  const x = u - 0.5, y = v - 0.5;
  const i = Math.max(0, Math.min(N - 2, Math.floor(x))), j = Math.max(0, Math.min(N - 2, Math.floor(y)));
  const tx = Math.min(1, Math.max(0, x - i)), ty = Math.min(1, Math.max(0, y - j));
  const p = j * N + i; let A = a[p], B = a[p + 1], C = a[p + N], D = a[p + N + 1];
  if (!(A === A && B === B && C === C && D === D)) { let s = 0, n = 0; for (const q of [A, B, C, D]) if (q === q) { s += q; n++; } if (!n) return NaN; const mm = s / n; if (!(A === A)) A = mm; if (!(B === B)) B = mm; if (!(C === C)) C = mm; if (!(D === D)) D = mm; }
  return (A * (1 - tx) + B * tx) * (1 - ty) + (C * (1 - tx) + D * tx) * ty;
}

/** Terrengmodellen (NDTM × NDTM over blockBB, EPSG:3857) samplet på rutenettet bb (N × N). */
export function dtmOn(dtm, NDTM, blockBB, bb, N) {
  const out = new Float32Array(N * N), sx = (blockBB[2] - blockBB[0]) / NDTM, sy = (blockBB[3] - blockBB[1]) / NDTM, px = (bb[2] - bb[0]) / N;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const mx = bb[0] + (i + 0.5) * px, my = bb[3] - (j + 0.5) * px;
    out[j * N + i] = bil(dtm, NDTM, (mx - blockBB[0]) / sx, (blockBB[3] - my) / sy);
  }
  return out;
}

/** Blander terrengmodellen inn i dybden (etter contourDepth, før fitPoints). */
export function blendDtm(dep, cls, N, res, dtm, IV) {
  const fL = new Uint8Array(N * N), fK = new Uint8Array(N * N), fE = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const p = j * N + i, c = cls[p];
    fL[p] = c < 0 ? 1 : 0;
    fK[p] = c >= 0 && ((i < N - 1 && cls[p + 1] !== c) || (j < N - 1 && cls[p + N] !== c)) ? 1 : 0;   // dybdekurve
    fE[p] = c >= 0 && !(dtm[p] === dtm[p]) ? 1 : 0;                                                  // sjø uten modell
  }
  const dL = edt(fL, N, N), dK = edt(fK, N, N), dE = edt(fE, N, N);
  for (let p = 0; p < N * N; p++) {
    const c = cls[p], t = dtm[p]; if (c < 0 || !(t === t) || !(dep[p] === dep[p])) continue;
    const w = WMAX * ramp(Math.sqrt(dL[p]) * res, LAND) * ramp(Math.sqrt(dK[p]) * res, KURVE) * ramp(Math.sqrt(dE[p]) * res, KANT);
    if (!w) continue;
    const lo = IV[c][1], hi = IV[c][2];
    dep[p] = Math.min(hi, Math.max(lo, dep[p] + w * (Math.min(hi, Math.max(lo, t)) - dep[p])));
  }
}
