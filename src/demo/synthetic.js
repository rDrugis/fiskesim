// Syntetisk kystområde (brukes når kartdata ikke kan hentes, og i tester).
import { tpiGrid } from '../data/terrainbuild.js';

export function syntheticGrid(E0, N0, size = 2400, res = 4, seed = 3) {
  const W = Math.round(size / res), H = W;
  const x0 = E0 - size / 2, y1 = N0 + size / 2;
  const z = new Float32Array(W * H), mask = new Uint8Array(W * H), hard = new Uint8Array(W * H), sed = new Uint8Array(W * H);
  const noise = (x, y) => Math.sin(x * 0.013 + seed) * Math.cos(y * 0.011 - seed) + 0.5 * Math.sin(x * 0.031 - y * 0.027) + 0.25 * Math.sin(x * 0.071 + y * 0.059 + seed * 2);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = (i + 0.5) * res - size / 2, y = size / 2 - (j + 0.5) * res;
    // øy i nord, holmer, en grunntopp og en dyp renne
    const island = 260 - Math.hypot(x + 300, y - 650) + 40 * noise(x, y);
    const holme = 60 - Math.hypot(x - 420, y - 120) + 15 * noise(x * 2, y * 2);
    const top = Math.max(0, 1 - Math.hypot(x - 80, y + 260) / 220);
    let d = 35 + 70 * Math.max(0, Math.min(1, (-y + 200) / 900)) + 12 * noise(x, y);
    d -= 32 * top * top;
    d = Math.max(4, d - Math.max(0, 260 - Math.hypot(x + 300, y - 650)) * 0.15);
    const land = Math.max(island, holme);
    const p = j * W + i;
    if (land > 0) { z[p] = 1.6 + land * 0.25 + 3 * noise(x * 3, y * 3); mask[p] = 0; }
    else { const coast = Math.max(island, holme); const nearCoast = Math.max(0, 1 + coast / 60); z[p] = -Math.max(0.6, d * (1 - 0.85 * nearCoast)); mask[p] = 1; }
  }
  const tpi = tpiGrid(z, W, H, Math.round(60 / res));
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    const p = j * W + i;
    if (!mask[p]) { hard[p] = 255; continue; }
    const sl = Math.atan(Math.hypot(z[p + 1] - z[p - 1], z[p + W] - z[p - W]) / (2 * res)) * 57.3;
    const h = Math.max(0.05, Math.min(0.98, 0.3 + sl * 0.025 + Math.max(0, tpi[p]) * 0.03 - (-z[p] > 60 && sl < 4 ? 0.2 : 0)));
    hard[p] = Math.round(h * 255);
  }
  const lo = new Float32Array(W * H).fill(NaN), hi = new Float32Array(W * H).fill(NaN);
  return { x0, y1, res, W, H, z, mask, hard, sed, tpi, lo, hi, stats: { synthetic: true } };
}

// Miljø uten nett: klimaverdier
export function syntheticEnv(month = 10) {
  return null;
}
