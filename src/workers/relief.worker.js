// Fiskekart-fliser: dybden mellom sjøkartets dybdekurver (samme metode som i 3D-terrenget), glatt fargelagt
// med svak skyggelegging og tynne dybdekurver. Regnes på zoom ≤ 12 med kant rundt, og skaleres jevnt opp ved
// større zoom, så kartet blir glatt uten trappetrinn.
import { decodeDybdelag, DYBDELAG } from '../data/depthmodel.js';
import { contourDepth } from '../data/contourdepth.js';
import { fetchCached, SRC } from '../data/sources.js';
import { PAL, rgb } from '../map/palette.js';

const R = 6378137, ORIG = Math.PI * R;
const tileMerc = (z, x, y) => { const s = (2 * ORIG) / 2 ** z; return [-ORIG + x * s, ORIG - (y + 1) * s, -ORIG + (x + 1) * s, ORIG - y * s]; };
const latOfMercY = (my) => (Math.atan(Math.exp(my / R)) * 2 - Math.PI / 2) * 180 / Math.PI;

const CZ = 12, SIZE = 256, MARG = 128;
const cache = new Map(); // beregnede z ≤ 12-fliser: { dep, wet, N }

async function computeTile(z, x, y) {
  const key = z + '/' + x + '/' + y;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    const [mx0, my0, mx1, my1] = tileMerc(z, x, y);
    const px = (mx1 - mx0) / SIZE, N = SIZE + 2 * MARG;
    const bb = [mx0 - MARG * px, my0 - MARG * px, mx1 + MARG * px, my1 + MARG * px];
    const url = `${SRC.wmsDybde}?service=WMS&version=1.1.1&request=GetMap&layers=Dybdelag,Torrfall&styles=&srs=EPSG:3857&format=image/png&transparent=true&width=${N}&height=${N}&bbox=${bb.map((v) => v.toFixed(2)).join(',')}`;
    const buf = await fetchCached(url, { timeout: 40000 });
    const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }));
    const c = new OffscreenCanvas(N, N), ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const { mask, cls } = decodeDybdelag(ctx.getImageData(0, 0, N, N).data, N, N);
    const c2 = new Int8Array(N * N);
    let water = 0;
    for (let p = 0; p < N * N; p++) { c2[p] = mask[p] === 0 ? -1 : mask[p] === 2 ? -2 : cls[p] >= 0 ? cls[p] : 0; if (mask[p]) water++; }
    const lat = latOfMercY((my0 + my1) / 2), res = px * Math.cos(lat * Math.PI / 180);
    const dep = water ? contourDepth(c2, N, N, res, DYBDELAG, null) : null;
    const wet = new Float32Array(N * N); for (let p = 0; p < N * N; p++) wet[p] = mask[p] ? 1 : 0;
    return { dep, wet, N, res, cls: c2 };
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  if (cache.size > 48) cache.delete(cache.keys().next().value);
  return p;
}

// Bilineær prøve i en beregnet flis (u, v i flisens pikselkoordinater uten kant)
function bil(a, N, u, v) {
  const x = u + MARG - 0.5, y = v + MARG - 0.5;
  const i = Math.max(0, Math.min(N - 2, Math.floor(x))), j = Math.max(0, Math.min(N - 2, Math.floor(y)));
  const tx = Math.min(1, Math.max(0, x - i)), ty = Math.min(1, Math.max(0, y - j));
  const p = j * N + i;
  let A = a[p], B = a[p + 1], C = a[p + N], D = a[p + N + 1];
  // NaN (land) i et hjørne: bruk snittet av de andre
  if (!(A === A && B === B && C === C && D === D)) {
    let s = 0, n = 0; for (const q of [A, B, C, D]) if (q === q) { s += q; n++; }
    if (!n) return NaN; const m = s / n; if (!(A === A)) A = m; if (!(B === B)) B = m; if (!(C === C)) C = m; if (!(D === D)) D = m;
  }
  return (A * (1 - tx) + B * tx) * (1 - ty) + (C * (1 - tx) + D * tx) * ty;
}

const LEVELS = [5, 10, 20, 30, 40, 50, 100, 150, 200, 250, 300, 400, 500];

async function renderTile(z, x, y, palName) {
  const pal = PAL[palName] || PAL.dag;
  let base, u0 = 0, v0 = 0, scale = 1;
  if (z <= CZ) base = await computeTile(z, x, y);
  else {
    const k = z - CZ, px = x >> k, py = y >> k;
    base = await computeTile(CZ, px, py);
    scale = 1 / 2 ** k; u0 = (x - (px << k)) * SIZE * scale; v0 = (y - (py << k)) * SIZE * scale;
  }
  const img = new ImageData(SIZE, SIZE);
  if (!base.dep) return createImageBitmap(img);
  const S = SIZE + 2, D = new Float32Array(S * S), Wt = new Float32Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const u = u0 + (i - 0.5) * scale, v = v0 + (j - 0.5) * scale;
    D[j * S + i] = bil(base.dep, base.N, u, v);
    Wt[j * S + i] = bil(base.wet, base.N, u, v);
  }
  const pxm = base.res * scale; // meter per piksel i denne flisen
  const ex = 2.2, L = [-0.55, 0.55, 0.63];
  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
    const p = (j + 1) * S + i + 1, o = (j * SIZE + i) * 4;
    const d = D[p], w = Wt[p];
    if (!(d === d) || w < 0.02) { img.data[o + 3] = 0; continue; }
    let c;
    if (d < 0) c = [148, 152, 112]; // tørrfall
    else c = rgb(d, pal);
    const dl = D[p - 1], dr = D[p + 1], du = D[p - S], dd = D[p + S];
    const gx = ((dr === dr ? dr : d) - (dl === dl ? dl : d)) / (2 * pxm), gy = ((dd === dd ? dd : d) - (du === du ? du : d)) / (2 * pxm);
    const nx = gx * ex, ny = -gy * ex, nl = Math.hypot(nx, ny, 1);
    const lam = (nx * L[0] + ny * L[1] + L[2]) / nl;
    const shade = Math.min(1.3, 1 + 0.3 * (lam - 0.63) / 0.37);
    let r = c[0] * shade, g = c[1] * shade, b = c[2] * shade;
    // tynne dybdekurver der flaten krysser en kurvedybde
    for (const lv of LEVELS) {
      if ((d - lv) * (dr - lv) < 0 || (d - lv) * (dd - lv) < 0) {
        const a = lv % 50 === 0 ? 0.45 : 0.28;
        r = r * (1 - a) + 20 * a; g = g * (1 - a) + 34 * a; b = b * (1 - a) + 52 * a;
        break;
      }
    }
    img.data[o] = Math.min(255, r); img.data[o + 1] = Math.min(255, g); img.data[o + 2] = Math.min(255, b); img.data[o + 3] = Math.round(255 * Math.min(1, w * 1.6));
  }
  return createImageBitmap(img);
}

self.onmessage = async (ev) => {
  const { id, z, x, y, pal } = ev.data;
  try {
    const bmp = await renderTile(z, x, y, pal);
    self.postMessage({ id, bmp }, [bmp]);
  } catch (e) {
    self.postMessage({ id, error: String(e.message || e) });
  }
};
