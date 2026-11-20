// Fargelagt dybderelieff for kartet: Kartverkets 50 m-modell, skyggelagt, tegnet per kartflis.
import { UTM33, merc, tileBounds3857 } from '../geo/proj.js';
import { bathy50 } from '../data/kartverket.js';
import { sample } from '../data/grid.js';

// Grunt er varmt, dypt er kaldt (slik fiskekart ofte viser dybden).
export const PALETTES = {
  dybde: [[0, [232, 92, 60]], [4, [242, 132, 52]], [9, [246, 178, 62]], [16, [222, 214, 76]], [26, [150, 206, 88]], [40, [72, 192, 150]], [60, [46, 176, 202]], [95, [48, 144, 220]], [150, [50, 108, 206]], [240, [52, 80, 182]], [400, [56, 58, 150]], [800, [44, 36, 112]]],
  natt: [[0, [52, 86, 112]], [10, [38, 70, 98]], [30, [28, 56, 84]], [80, [20, 44, 70]], [200, [14, 33, 56]], [600, [9, 22, 40]]],
};

export function depthRGB(d, pal = PALETTES.dybde) {
  if (d <= pal[0][0]) return pal[0][1];
  for (let k = 1; k < pal.length; k++) {
    if (d <= pal[k][0]) {
      const [a, ca] = pal[k - 1], [b, cb] = pal[k], t = (d - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
    }
  }
  return pal[pal.length - 1][1];
}

const b50Cache = new Map();
async function b50ForBox(bb) {
  // Felles blokker på 10 km slik at nabofliser deler samme nedlasting
  const B = 10000, x0 = Math.floor(bb[0] / B) * B, y0 = Math.floor(bb[1] / B) * B, x1 = Math.ceil(bb[2] / B) * B, y1 = Math.ceil(bb[3] / B) * B;
  const blocks = [];
  for (let x = x0; x < x1; x += B) for (let y = y0; y < y1; y += B) {
    const key = x + ':' + y;
    if (!b50Cache.has(key)) b50Cache.set(key, bathy50([x - 100, y - 100, x + B + 100, y + B + 100]).catch((e) => { b50Cache.delete(key); throw e; }));
    blocks.push(b50Cache.get(key));
  }
  if (b50Cache.size > 80) { const k = b50Cache.keys().next().value; b50Cache.delete(k); }
  return Promise.all(blocks);
}

function sampleBlocks(blocks, x, y) {
  for (const g of blocks) {
    if (x >= g.x0 && x < g.x0 + g.W * g.res && y <= g.y1 && y > g.y1 - g.H * g.res) return sample(g, x, y);
  }
  return NaN;
}

export async function reliefTile(z, x, y, palName = 'dybde', size = 256) {
  const pal = PALETTES[palName] || PALETTES.dybde;
  const [mx0, my0, mx1, my1] = tileBounds3857(z, x, y);
  const corners = [[mx0, my0], [mx1, my0], [mx0, my1], [mx1, my1]].map(([a, b]) => UTM33.forward(...merc.inverse(a, b)));
  const bb = [Math.min(...corners.map((c) => c[0])) - 120, Math.min(...corners.map((c) => c[1])) - 120, Math.max(...corners.map((c) => c[0])) + 120, Math.max(...corners.map((c) => c[1])) + 120];
  const blocks = await b50ForBox(bb);
  const N = size + 2, dep = new Float32Array(N * N), ux = new Float32Array(N * N), uy = new Float32Array(N * N);
  const px = (mx1 - mx0) / size;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const [lon, lat] = merc.inverse(mx0 + (i - 0.5) * px, my1 - (j - 0.5) * px);
    const [e, n] = UTM33.forward(lon, lat);
    dep[j * N + i] = sampleBlocks(blocks, e, n); ux[j * N + i] = e; uy[j * N + i] = n;
  }
  const img = new ImageData(size, size);
  const ex = 3.2; // overdreven høyde gjør bunnformene synlige
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const p = (j + 1) * N + i + 1, d = dep[p];
    const o = (j * size + i) * 4;
    if (!(d === d)) { img.data[o + 3] = 0; continue; }
    const dl = dep[p - 1], dr = dep[p + 1], du = dep[p - N], dd = dep[p + N];
    const gx = ((dr === dr ? dr : d) - (dl === dl ? dl : d)) / (2 * px), gy = ((dd === dd ? dd : d) - (du === du ? du : d)) / (2 * px);
    // normal for overflaten z = −d, lys fra nordvest
    const nx = gx * ex, ny = -gy * ex, nz = 1, nl = Math.hypot(nx, ny, nz);
    const L = [-0.5, 0.5, 0.7071];
    const lam = (nx * L[0] + ny * L[1] + nz * L[2]) / nl;
    const shade = Math.max(0.35, Math.min(1.25, 0.25 + 0.95 * lam));
    const c = depthRGB(d, pal);
    img.data[o] = Math.min(255, c[0] * shade); img.data[o + 1] = Math.min(255, c[1] * shade); img.data[o + 2] = Math.min(255, c[2] * shade); img.data[o + 3] = 255;
  }
  const cv = new OffscreenCanvas(size, size);
  cv.getContext('2d').putImageData(img, 0, 0);
  return createImageBitmap(cv);
}
