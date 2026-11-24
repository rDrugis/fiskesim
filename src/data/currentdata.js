// Strømdata fra MET sin havmodell NorKyst v3 (800 m, timesprognose), lagt på et fast rutenett i EPSG:3857
// av tools/strom/strom.py på GitHub og lest fra grenen strom-data. Brukes både i kartet (piler) og i
// tegnetrådene (det varmefargede strømkartet).
export const CURRENT_BASE = 'https://raw.githubusercontent.com/rDrugis/fiskesim/strom-data/';

// varmefarger for strømfarten (m/s): mørk blå = stille, rød/lilla = sterk
export const HEAT = [[0, [12, 28, 82]], [0.08, [24, 92, 190]], [0.16, [0, 170, 200]], [0.25, [60, 180, 90]], [0.36, [240, 220, 60]], [0.5, [250, 150, 40]], [0.7, [230, 60, 50]], [1.0, [175, 25, 105]]];
export function heat(s) {
  if (s <= HEAT[0][0]) return HEAT[0][1];
  for (let k = 1; k < HEAT.length; k++) if (s <= HEAT[k][0]) { const [a, ca] = HEAT[k - 1], [b, cb] = HEAT[k], t = (s - a) / (b - a); return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]; }
  return HEAT[HEAT.length - 1][1];
}

let metaP = null, metaAt = 0;
const frames = new Map();
export function currentMeta(force = false) {
  if (!metaP || force || Date.now() - metaAt > 30 * 60e3) {
    metaAt = Date.now();
    metaP = fetch(CURRENT_BASE + 'meta.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('Svar ' + r.status); return r.json(); });
    metaP.then(() => frames.clear(), () => { metaP = null; });
  }
  return metaP;
}
// timen nærmest et tidspunkt (ms)
export const nearestHour = (M, t) => { let best = 0; M.t.forEach((v, i) => { if (Math.abs(v - t) < Math.abs(M.t[best] - t)) best = i; }); return best; };

// én time: u og v i m/s (Float32, NaN = ingen data); hullene langs land fylles fra naboene (inntil ca. 3 ruter),
// så strømfargen når helt inn til land i det varmefargede kartet
export function currentFrame(M, h) {
  const key = M.laget + ':' + h;
  if (!frames.has(key)) {
    const p = fetch(CURRENT_BASE + `h${String(h).padStart(3, '0')}.bin`).then((r) => { if (!r.ok) throw new Error('Svar ' + r.status); return r.arrayBuffer(); }).then((b) => {
      const n = M.nx * M.ny, ui = new Int8Array(b, 0, n), vi = new Int8Array(b, n, n), u = new Float32Array(n), v = new Float32Array(n);
      for (let k = 0; k < n; k++) { u[k] = ui[k] === -128 ? NaN : ui[k] * M.scale; v[k] = vi[k] === -128 ? NaN : vi[k] * M.scale; }
      const raw = { u: u.slice(), v: v.slice() };
      for (let it = 0; it < 3; it++) {
        const nu = u.slice(), nv = v.slice();
        for (let j = 0; j < M.ny; j++) for (let i = 0; i < M.nx; i++) {
          const k = j * M.nx + i; if (u[k] === u[k]) continue;
          let su = 0, sv = 0, c = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= M.nx || jj >= M.ny) continue; const q = jj * M.nx + ii; if (u[q] === u[q]) { su += u[q]; sv += v[q]; c++; } }
          if (c) { nu[k] = su / c; nv[k] = sv / c; }
        }
        u.set(nu); v.set(nv);
      }
      return { u, v, raw };
    });
    p.catch(() => frames.delete(key)); frames.set(key, p);
    if (frames.size > 12) frames.delete(frames.keys().next().value);
  }
  return frames.get(key);
}

// fart (m/s) i et punkt i EPSG:3857, bilineært mellom rutene; NaN utenfor dataene
export function speedAt(M, F, mx, my) {
  const cell = (M.bbox[2] - M.bbox[0]) / M.nx, x = (mx - M.bbox[0]) / cell - 0.5, y = (M.bbox[3] - my) / cell - 0.5;
  if (x < -0.5 || y < -0.5 || x > M.nx - 0.5 || y > M.ny - 0.5) return NaN;
  const i = Math.max(0, Math.min(M.nx - 2, Math.floor(x))), j = Math.max(0, Math.min(M.ny - 2, Math.floor(y))), tx = Math.min(1, Math.max(0, x - i)), ty = Math.min(1, Math.max(0, y - j));
  let su = 0, sv = 0, sw = 0;
  for (const [di, dj, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
    const k = (j + dj) * M.nx + i + di, u = F.u[k]; if (u === u && w > 0) { su += u * w; sv += F.v[k] * w; sw += w; }
  }
  return sw > 0 ? Math.hypot(su / sw, sv / sw) : NaN;
}
