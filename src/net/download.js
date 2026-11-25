// Nedlasting av et område for bruk uten nett: fiskekartet (dybdeflisene), grunnkart (OpenFreeMap),
// terreng (skyggelegging) og ev. Kartverkets sjøkart. Alt lagres i offline-lageret (net/offline.js).
import { SRC } from '../data/sources.js';
import { OFF, offFetch, saveArea, areaBytes } from './offline.js';

const tileOf = (lon, lat, z) => {
  const n = 2 ** z, r = lat * Math.PI / 180;
  return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)];
};
function tiles(bb, z0, z1) {
  const out = [];
  for (let z = z0; z <= z1; z++) {
    const [x0, y0] = tileOf(bb[0], bb[3], z), [x1, y1] = tileOf(bb[2], bb[1], z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  }
  return out;
}

// anslått størrelse per flis (byte), ut fra flisene som brukes i Vestland
const AVG = { ofm: 22e3, dem: 60e3, relief: 40e3, kv: 25e3 };
const FONTS = ['Noto Sans Regular', 'Noto Sans Italic', 'Noto Sans Bold'], RANGES = ['0-255', '256-511', '8192-8447'];
export const MAX_BYTES = 600e6;

export function plan(bb, { sjokart = false } = {}) {
  const P = { ofm: tiles(bb, 6, 14), dem: tiles(bb, 6, 12), relief: tiles(bb, 7, 14), kv: sjokart ? tiles(bb, 8, 15) : [] };
  const est = P.ofm.length * AVG.ofm + P.dem.length * AVG.dem + P.relief.length * AVG.relief + P.kv.length * AVG.kv;
  return { P, est, n: P.ofm.length + P.dem.length + P.relief.length + P.kv.length + FONTS.length * RANGES.length + 2 };
}

async function pool(items, n, fn, stop) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length && !stop()) { const it = items[i++]; await fn(it); } }));
}

// Laster ned området. onProg({ done, total, fail, phase }). Gir området som ble lagret.
export async function downloadArea(api, { bb, name, sjokart = false }, onProg, isStopped = () => false) {
  const { P, n } = plan(bb, { sjokart });
  const id = 'a' + Date.now().toString(36);
  let done = 0, fail = 0;
  const tick = (phase, ok = true) => { done++; if (!ok) fail++; onProg && onProg({ done, total: n, fail, phase }); };
  const get = async (u, phase) => {
    for (let k = 0; k < 2; k++) {
      try { const r = await offFetch(fetch, u); if (r.ok || r.status === 404 || r.status === 204) { if (r.body) await r.arrayBuffer(); tick(phase); return r; } } catch (e) { /* prøv igjen */ }
      await new Promise((res) => setTimeout(res, 800));
    }
    tick(phase, false); return null;
  };
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* ikke støttet */ }
  OFF.rec = id; OFF.bytes = 0; OFF.n = 0;
  await api.reliefRec(id);
  try {
    // fiskekartet: dybdeintervallene og flisene, regnet ut i trådene akkurat som når du ser på kartet
    await get(new URL('pre/iv.json', document.baseURI).href, 'Fiskekart');
    for (let z = 7; z <= 14 && !isStopped(); z++) {
      await pool(P.relief.filter((t) => t[0] === z), 8, async ([zz, x, y]) => {
        try { await api.reliefPrefetch(zz, x, y); tick('Fiskekart'); } catch (e) { tick('Fiskekart', false); }
      }, isStopped);
    }
    // grunnkart (land, veier, stedsnavn i kartet)
    let tpl = null;
    try { const r = await offFetch(fetch, SRC.ofm); if (r.ok) tpl = (await r.json()).tiles[0]; } catch (e) { tpl = null; }
    tick('Grunnkart', !!tpl);
    if (tpl) await pool(P.ofm, 8, ([z, x, y]) => get(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y), 'Grunnkart'), isStopped);
    else { done += P.ofm.length; fail += P.ofm.length; }
    for (const f of FONTS) for (const r of RANGES) await get(SRC.ofmGlyphs.replace('{fontstack}', f).replace('{range}', r), 'Grunnkart');
    // terreng (skyggelegging på land)
    await pool(P.dem, 8, ([z, x, y]) => get(SRC.terrarium.replace('{z}', z).replace('{x}', x).replace('{y}', y), 'Terreng'), isStopped);
    // Kartverkets sjøkart
    const kv = SRC.wmtsKV('sjokartraster');
    await pool(P.kv, 6, ([z, x, y]) => get(kv.replace('{z}', z).replace('{x}', x).replace('{y}', y), 'Sjøkart'), isStopped);
  } finally {
    OFF.rec = null;
    await api.reliefRec(null).catch(() => null);
  }
  if (isStopped()) return null;
  const bytes = (await areaBytes())[id] || 0;
  const area = { id, name, bb, sjokart, ts: Date.now(), bytes, fail, n };
  await saveArea(area);
  return area;
}

// Navn på området: nærmeste fjord, sund eller øy ved midten (Kartverkets stedsnavn), ellers koordinatene
export async function areaName(lon, lat) {
  try {
    const r = await fetch(`${SRC.stedsnavn}/punkt?nord=${lat.toFixed(5)}&ost=${lon.toFixed(5)}&koordsys=4258&radius=5000&treffPerSide=100&side=1&utkoordsys=4258`);
    const j = await r.json(), all = (j.navn || []).filter((n) => n.stedsnavn && n.stedsnavn[0]);
    const best = all.find((n) => /fjord|sund/i.test(n.navneobjekttype)) || all.find((n) => /øy|tettsted|by\b|bygdelag/i.test(n.navneobjekttype)) || all[0];
    if (best) return best.stedsnavn[0]['skrivemåte'];
  } catch (e) { /* uten nett */ }
  return `${lat.toFixed(2).replace('.', ',')}° N, ${lon.toFixed(2).replace('.', ',')}° Ø`;
}
