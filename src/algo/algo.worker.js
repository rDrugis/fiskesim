// Regner én 6 × 6 km-rute av fiskeplassalgoritmen i bakgrunnen. Bildene hentes her (samme adresser som Fiskeguide).
import { computeTile, tileGeom } from './core.js';

const NMG = 'https://wms.geonorge.no/skwms1/wms.nmg', DYB = 'https://wms.geonorge.no/skwms1/wms.dybdedata2';
const NGU = 'https://geo.ngu.no/mapserver/MarinBunnsedimenterWMS2';
const q = (bb, w, h) => '?service=WMS&version=1.1.1&request=GetMap&styles=&srs=EPSG:3857&format=image/png&transparent=true&width=' + w + '&height=' + h + '&bbox=' + bb.map((v) => v.toFixed(1)).join(',');

async function wmsImg(url, W, H) {
  let err;
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(url); if (!r.ok) throw new Error('Svar ' + r.status);
      const bm = await createImageBitmap(await r.blob());
      const c = new OffscreenCanvas(W, H), x = c.getContext('2d'); x.drawImage(bm, 0, 0); // som i Fiskeguide (uten willReadFrequently)
      return x.getImageData(0, 0, W, H).data;
    } catch (e) { err = e; await new Promise((res) => setTimeout(res, 800 * (k + 1))); }
  }
  throw err;
}

self.onmessage = async (ev) => {
  const { id, tx, ty, m, now, wfs, grid } = ev.data;
  try {
    const G = tileGeom(tx, ty), { bx, W, H, bl, nL } = G;
    const [dd, bd, ld, dl] = await Promise.all([
      wmsImg(DYB + q(bx, W, H) + '&layers=Dybdelag', W, H),
      wmsImg(NGU + q(bx, W, H) + '&layers=NiN_DK_Det', W, H).catch(() => null),
      wmsImg(NMG + q(bl, nL, nL) + '&layers=Landareal', nL, nL).catch(() => null),
      wmsImg(DYB + q(bl, nL, nL) + '&layers=Dybdelag', nL, nL).catch(() => null),
    ]);
    const dbg = grid ? { grid } : null;
    const res = await computeTile(tx, ty, m, { dd, bd, ld, dl, akF: wfs.akF, akP: wfs.akP, pasF: wfs.pasF }, { now: new Date(now), dbg });
    if (dbg) res.blocks = dbg.blocks || [];
    self.postMessage({ id, res });
  } catch (e) {
    self.postMessage({ id, error: String(e && e.message || e) });
  }
};
