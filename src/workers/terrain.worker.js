import { buildTerrain } from '../data/terrainbuild.js';

self.onmessage = async (ev) => {
  const { id, args } = ev.data;
  try {
    const g = await buildTerrain({ ...args, onStage: (s) => self.postMessage({ id, stage: s }) });
    const transfer = [g.z.buffer, g.mask.buffer, g.lo.buffer, g.hi.buffer, g.hard.buffer, g.sed.buffer, g.tpi.buffer];
    self.postMessage({ id, ok: true, grid: g }, transfer);
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.message || e) });
  }
};
