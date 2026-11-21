// Terreng (land og sjøbunn) for 3D-visningen, regnet i en egen tråd.
import { UTM33 } from '../geo/proj.js';

export const NEAR = { size: 2400, res: 4 };
export const FAR = { size: 30000, res: 50 };

let worker = null, nextId = 1;
const pending = new Map();
function terrainWorker() {
  if (!worker) {
    worker = new Worker(new URL('assets/terrain.worker.js?v=' + __V__, document.baseURI), { type: 'module' });
    worker.onmessage = (ev) => {
      const { id } = ev.data, p = pending.get(id); if (!p) return;
      if (ev.data.stage) { p.onStage?.(ev.data.stage); return; }
      pending.delete(id);
      if (ev.data.ok) p.res(ev.data.grid); else p.rej(new Error(ev.data.error));
    };
    worker.onerror = (e) => { for (const p of pending.values()) p.rej(new Error('Terrengberegningen stoppet' + (e.message ? ': ' + e.message : ''))); pending.clear(); worker = null; };
  }
  return worker;
}

export function buildTerrainAsync(args, onStage) {
  const id = nextId++;
  return new Promise((res, rej) => { pending.set(id, { res, rej, onStage }); terrainWorker().postMessage({ id, args }); });
}

function restartWorker() {
  if (!worker) return;
  worker.terminate(); worker = null;
  for (const p of pending.values()) p.rej(new Error('avbrutt'));
  pending.clear();
}

// Bygger dybdemodellen for en plass så snart den er klikket på: kortet viser samme dybde som spillet,
// og båten er klar raskere når man setter den ut.
let pre = null;
const nearArgs = (E0, N0) => ({ cx: E0, cy: N0, size: NEAR.size, res: NEAR.res, points: true, pointsSize: NEAR.size, ngu: true, msl: 0.9 });
export function prefetchNear(lon, lat, onStage) {
  const [E, N] = UTM33.forward(lon, lat), E0 = Math.round(E), N0 = Math.round(N), key = E0 + ':' + N0;
  if (pre && pre.key === key) { if (onStage) pre.listeners.push(onStage); return pre.promise; }
  if (pre && !pre.done) restartWorker();
  const listeners = onStage ? [onStage] : [];
  const p = buildTerrainAsync(nearArgs(E0, N0), (s) => listeners.forEach((f) => f(s)));
  const entry = (pre = { key, promise: p, done: false, listeners });
  p.then(() => { entry.done = true; }, () => { entry.done = true; if (pre === entry) pre = null; });
  return p;
}

// Finn nærmeste punkt med minst minDepth meter vann (lokale koordinater)
export function findWater(world, x, y, minDepth = 2.5) {
  if (world.depthAt(x, y) >= minDepth) return [x, y];
  for (let r = 8; r < 900; r += 8) {
    const n = Math.max(8, Math.round(r / 4));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (world.depthAt(px, py) >= minDepth) return [px, py];
    }
  }
  return [x, y];
}

