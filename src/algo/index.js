// Fiskeplassforslag i kartet: ruteberegning (i bakgrunnstråder), lagring, utvalg og forklaring.
// Utvalget (algoPick) og forklaringene (algoLines/algoWhy) er de samme som i Fiskeguide.
import { R, ART, SRC, VERSION, ATILE, AMAXT, merc, unmerc, km, algoParams, depthFit, bunnNavn, tileGeom, rd } from './core.js';

export { R, ART, SRC };
const FD = 'https://gis.fiskeridir.no/server/services/';
const DYB = 'https://wms.geonorge.no/skwms1/wms.dybdedata2';
export const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const fmt = (n, d) => { if (n == null || isNaN(n)) return '–'; const s = Number(n).toFixed(d || 0); const p = s.split('.'); return p[0].replace('-', '−').replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (p[1] ? ',' + p[1] : ''); };

/* ---------- Fiskeridirektoratets WFS (fliser på 0,5° × 1°, hurtigbuffer) ---------- */
const WFSC = new Map();
function wfsTile(svc, type, la, lo) {
  const key = type + '|' + la + '|' + lo; if (WFSC.has(key)) return WFSC.get(key);
  const bb = [la, lo, la + 0.5, lo + 1];
  const url = FD + svc + '/MapServer/WFSServer?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=' + svc + ':' + type + '&OUTPUTFORMAT=GEOJSON&SRSNAME=urn:ogc:def:crs:EPSG::4326&BBOX=' + bb.join(',') + ',urn:ogc:def:crs:EPSG::4326';
  const pr = fetch(url).then((r) => { if (!r.ok) throw new Error('Svar ' + r.status); return r.json(); }).then((j) => j.features || []);
  pr.catch(() => WFSC.delete(key));
  WFSC.set(key, pr); return pr;
}
function tilesFor(b) { const out = []; for (let la = Math.floor(b.s * 2) / 2; la < b.n; la += 0.5) for (let lo = Math.floor(b.w); lo < b.e; lo += 1) out.push([la, lo]); return out; }
async function wfsBounds(svc, type, b) {
  const t = tilesFor(b); if (t.length > 12) throw new Error('Zoom inn for å hente data');
  const parts = await Promise.all(t.map(([la, lo]) => wfsTile(svc, type, la, lo))), seen = new Set(), out = [];
  parts.forEach((fs) => fs.forEach((f) => { const id = f.properties && (f.properties.GmlID || f.properties.objectid || f.properties.OBJECTID); if (id == null || !seen.has(id)) { seen.add(id); out.push(f); } }));
  return out;
}

/* ---------- lagring av ferdige ruter (IndexedDB, overlever omstart) ---------- */
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res) => {
    try {
      const r = indexedDB.open('fiskesim-algo', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('t');
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    } catch (e) { res(null); }
  });
  return dbp;
}
async function idb(mode, fn) { const d = await db(); if (!d) return null; return new Promise((res) => { try { const tx = d.transaction('t', mode); const rq = fn(tx.objectStore('t')); tx.oncomplete = () => res(rq && rq.result); tx.onerror = () => res(null); } catch (e) { res(null); } }); }

/* ---------- rutene ---------- */
const tkey = (tx, ty, m) => VERSION + '|' + tx + '|' + ty + '|' + m;
const ATC = new Map(), ATP = new Map(), AVER = new Map();
export function viewTiles(b) {
  const [x0, y0] = merc(b.s, b.w), [x1, y1] = merc(b.n, b.e), out = [];
  for (let ty = Math.floor(y0 / ATILE); ty <= Math.floor(y1 / ATILE); ty++) for (let tx = Math.floor(x0 / ATILE); tx <= Math.floor(x1 / ATILE); tx++) out.push([tx, ty]);
  return out;
}
const pool = []; let wid = 0; const wwait = new Map();
function worker(k) {
  if (!pool.length) {
    const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('assets/algo.worker.js?v=' + __V__, document.baseURI), { type: 'module' });
      w.onmessage = (ev) => { const p = wwait.get(ev.data.id); if (!p) return; wwait.delete(ev.data.id); if (ev.data.error) p.rej(new Error(ev.data.error)); else p.res(ev.data.res); };
      pool.push(w);
    }
  }
  return pool[k % pool.length];
}
async function atCompute(tx, ty, m, grid) {
  const { bx } = tileGeom(tx, ty);
  const sw = unmerc(bx[0], bx[1]), ne = unmerc(bx[2], bx[3]), lb = { s: sw[0], w: sw[1], n: ne[0], e: ne[1] };
  const wfs = (svc, typ) => wfsBounds(svc, typ, lb).catch(() => null);
  const [akF, akP, pasF] = await Promise.all([wfs('FiskeridirWFS_akva', 'Flate_ihht_Akvakulturregisteret'), wfs('FiskeridirWFS_akva', 'akvakultur_lokaliteter'), wfs('FiskeridirWFS_fiskeri', 'fiskeplasser_passive_redskap')]);
  // bare geometri og egenskapene algoritmen bruker sendes til tråden
  const slim = (fs) => fs && fs.map((f) => ({ geometry: f.geometry, properties: f.properties }));
  const id = ++wid;
  const res = await new Promise((res, rej) => { wwait.set(id, { res, rej }); worker(tx * 7 + ty * 13).postMessage({ id, tx, ty, m, now: Date.now(), grid, wfs: { akF: slim(akF), akP: slim(akP), pasF: slim(pasF) } }); });
  return { k: tkey(tx, ty, m), ts: Date.now(), nD: res.nD, nB: res.nB, c: res.c, blocks: res.blocks };
}
/* testkrok: poeng per blokk på ca. 175 m for én art i én rute (brukes av live-testen, lagres ikke) */
export const atGrid = (tx, ty, m, sp) => atCompute(tx, ty, m, sp);
export async function atGet(tx, ty, m) {
  const k = tkey(tx, ty, m); if (ATC.has(k)) return ATC.get(k); if (ATP.has(k)) return ATP.get(k);
  const pr = (async () => {
    const saved = await idb('readonly', (s) => s.get(k));
    if (saved && Date.now() - saved.ts < 14 * 86400e3) { ATC.set(k, saved); return saved; }
    const t = await atCompute(tx, ty, m);
    ATC.set(k, t); idb('readwrite', (s) => s.put(t, k));
    return t;
  })();
  ATP.set(k, pr); pr.then(() => ATP.delete(k), () => ATP.delete(k));
  return pr;
}

/* dybden hos Kartverket i et punkt (minste intervall der flere overlapper) */
export async function gfiDepth(lat, lon) {
  const d = 0.0004, url = DYB + '?service=WMS&version=1.1.1&request=GetFeatureInfo&styles=&srs=EPSG:4326&format=image/png&width=101&height=101&x=50&y=50&info_format=text/plain&feature_count=3&layers=Dybdelag&query_layers=Dybdelag&bbox=' + [lon - d * 2, lat - d, lon + d * 2, lat + d].join(',');
  const r = await fetch(url); if (!r.ok) throw new Error('Svar ' + r.status);
  const t = await r.text(), a = [...t.matchAll(/minimumsdybde = '([\d.]+)'/g)].map((m) => +m[1]), b = [...t.matchAll(/maksimumsdybde = '([\d.]+)'/g)].map((m) => +m[1]);
  if (!a.length) return null; let best = null; a.forEach((v, i) => { const w = [v, b[i] != null ? b[i] : v]; if (!best || w[1] - w[0] < best[1] - best[0]) best = w; }); return best;
}

/* velg forslagene i utsnittet: felles utvalg på tvers av rutene, så kontroll av dybden hos Kartverket */
async function algoPick(b, m, list, K, alive) {
  const tl = viewTiles(b), near = new Set(); tl.forEach(([tx, ty]) => { for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) near.add((tx + a) + '|' + (ty + c)); });
  const pool = {}; near.forEach((s) => { const [tx, ty] = s.split('|'), t = ATC.get(tkey(tx, ty, m)); if (!t) return; Object.keys(t.c).forEach((sp) => { (pool[sp] = pool[sp] || []).push(...t.c[sp]); }); });
  const inV = (r) => r.lat >= b.s && r.lat <= b.n && r.lon >= b.w && r.lon <= b.e, res = [];
  let feil = 0;
  for (const sp of list) {
    const all = (pool[sp] || []).slice().sort((a, b2) => b2.sc - a.sc || a.lat - b2.lat || a.lon - b2.lon), keep = [];
    for (const r of all) { if (keep.some((k) => km([k.lat, k.lon], [r.lat, r.lon]) < 0.35)) continue; keep.push(r); }
    const vis = keep.filter(inV); let got = 0, i0 = 0;
    while (got < K && i0 < vis.length) {
      const batch = vis.slice(i0, i0 + (K - got) + 2); i0 += batch.length;
      await Promise.all(batch.map(async (r) => { const key = r.lat.toFixed(5) + ',' + r.lon.toFixed(5); if (!AVER.has(key)) AVER.set(key, await gfiDepth(r.lat, r.lon).catch(() => null)); }));
      if (!alive()) return null;
      for (const r of batch) { if (got >= K) break; const P = algoParams(sp, m, r.lat, r.lon); if (!P || P.skip) continue;
        const v = AVER.get(r.lat.toFixed(5) + ',' + r.lon.toFixed(5)), o = Object.assign({}, r, { P, fredet: P.fredet, ver: !!v });
        if (v) { o.dA = v[0]; o.dB = v[1]; if (depthFit(Math.min(Math.max((P.core[0] + P.core[1]) / 2, v[0]), v[1]), P) < 0.25) { feil++; continue; } if (v[1] - v[0] > 60) o.grov = true; }
        res.push(o); got++; } }
  }
  return { res: res.sort((a, b2) => b2.sc - a.sc), feil };
}

/* Kjør for et kartutsnitt b = {s, w, n, e}. sel = valgte arter ([] = alle), m = måned 0–11. */
let RUN = 0;
export async function algoRun(b, m, sel, onNote = () => {}) {
  const run = ++RUN, alive = () => run === RUN;
  const want = sel.filter((k) => R.algo[k]), list = want.length ? want : Object.keys(R.algo), K = want.length ? 6 : 2;
  const tl = viewTiles(b);
  const need = []; for (const [tx, ty] of tl) { const k = tkey(tx, ty, m); if (!ATC.has(k)) need.push([tx, ty]); }
  if (need.length > AMAXT || tl.length > 3 * AMAXT) return { res: [], note: 'Zoom inn for å få fiskeplasser.', zoom: true };
  let done = 0, err = null, next = 0;
  const cx = (b.w + b.e) / 2, cy = (b.s + b.n) / 2, c0 = merc(cy, cx);
  need.sort((p, q2) => Math.hypot((p[0] + 0.5) * ATILE - c0[0], (p[1] + 0.5) * ATILE - c0[1]) - Math.hypot((q2[0] + 0.5) * ATILE - c0[0], (q2[1] + 0.5) * ATILE - c0[1]));
  if (need.length) onNote(`Beregner fiskeplasser: 0 av ${need.length} ruter`);
  await Promise.all([0, 1, 2].map(async () => { while (next < need.length && alive()) { const [tx, ty] = need[next++];
    try { await atGet(tx, ty, m); } catch (e) { err = err || e; }
    done++; if (alive()) onNote(`Beregner fiskeplasser: ${done} av ${need.length} ruter`); } }));
  if (!alive()) return null;
  if (err && done && !tl.some(([tx, ty]) => ATC.has(tkey(tx, ty, m)))) return { res: [], note: 'Fikk ikke hentet dybdedata fra Kartverket.', err: true };
  onNote('Kontrollerer dybden for forslagene');
  const p = await algoPick(b, m, list, K, alive); if (!p || !alive()) return null;
  const ts = tl.map(([tx, ty]) => ATC.get(tkey(tx, ty, m))).filter(Boolean), nD = ts.reduce((a, t) => a + t.nD, 0);
  const skips = list.filter((sp) => { const P = algoParams(sp, m, cy, cx); return P && P.skip; });
  const nf = p.res.filter((r) => r.fredet).length;
  let note = !nD ? 'Ingen dybdedata i kartutsnittet.' : p.res.length ? p.res.length + ' fiskeplasser' + (nf ? ` (${nf} fredet eller forbudt nå – vises for læring)` : '')
    : skips.length === list.length ? 'Ingen forslag' : 'Ingen tydelige steder her for ' + (want.length ? 'valgt art' : 'artene') + ' denne måneden.';
  if (p.feil) note += ` · ${p.feil} tatt bort fordi dybden hos Kartverket ikke passet`;
  if (err) note += ' · noen ruter kunne ikke hentes';
  if (skips.length && want.length) note += ' (' + skips.map((sp) => ART[sp].no + ': ikke vanlig i dette området').join('; ') + ')';
  // rangering per art når arter er valgt (1 = best)
  p.res.forEach((r) => { r.rank = 0; });
  want.forEach((sp) => p.res.filter((r) => r.sp === sp).sort((a, c) => (c.raw ?? c.sc) - (a.raw ?? a.sc) || c.sc - a.sc).forEach((r, i) => { r.rank = i + 1; })); // flest poeng (uten tak) = nr. 1
  return { res: p.res, note };
}
export function clearCache() { ATC.clear(); AVER.clear(); return idb('readwrite', (s) => s.clear()); }
export const tilesCached = () => ATC.size;

/* ---------- forklaring (samme tekster som Fiskeguide) ---------- */
const SHORT = [['fogr_', 'Fisk og rask'], ['seeberg_', 'Seeberg'], ['snl_', 'SNL'], ['raf', 'Råfisklaget'], ['nofima', 'Nofima'], ['met_', 'MET'], ['kv_', 'Kartverket'], ['njff_', 'NJFF'], ['hk_', 'Hooked'], ['hi_', 'HI'], ['aof_', 'Alt om Fiske'], ['fd_', 'Fiskeridir.'], ['ngu_', 'NGU'], ['yt_', 'YouTube'], ['hooked_', 'Hooked'], ['jf_', 'Jakt & Fiske'], ['blueye_', 'Blueye'], ['ahp_', 'Atlanterhavsparken'], ['klikk_', 'klikk.no'], ['sfm_', 'Sport Fishing Mag.'], ['tsf_', 'Talk Sea Fishing']];
const short = (id) => (SHORT.find(([p]) => id.indexOf(p) === 0) || [0, 'Kilde'])[1];
export const src = (ids) => (ids || []).filter((i) => SRC[i]).map((i) => '<a class="tag k" href="' + esc(SRC[i][1]) + '" target="_blank" rel="noopener" title="' + esc(SRC[i][0]) + '">' + esc(short(i)) + '</a>').join('');

export function algoLines(r) {
  const fe = r.fe, out = [];
  if (r.P.fredet) out.push('<span class="fred">Fredet nå: ' + esc(r.P.fredet) + ' Vises bare for læring.</span>');
  out.push('Algoritmen ser etter ' + r.P.core[0] + '–' + r.P.core[1] + ' m for ' + esc(ART[r.sp].no.toLowerCase()) + (r.grov ? ' (Kartverket har bare et grovt dybdeintervall her)' : ''));
  if (fe.edge > 0.5) out.push('Bratt kant: fra ca. ' + fmt(fe.mn, 0) + ' til ' + fmt(fe.mx, 0) + ' m på et par hundre meter' + (fe.foot > 0.5 ? ', punktet ligger ved foten' : fe.top > 0.5 ? ', punktet ligger på toppen av kanten' : ''));
  if (fe.peak > 0.4) out.push('Topp eller grunne: ca. ' + fmt(fe.ringMean - fe.d0, 0) + ' m grunnere enn bunnen rundt (ca. 400 m unna)');
  else if (fe.knoll > 0.5 && ((r.P.w.knoll || 0) > 0 || (r.P.b && r.P.b.knoll))) out.push('Liten topp eller forhøyning: ca. ' + fmt(fe.ringMean - fe.d0, 0) + ' m grunnere enn bunnen rundt');
  if (fe.nose > 0.5 && ((r.P.w.nose || 0) > 0 || (r.P.b && r.P.b.nose))) out.push('Nebb eller odde på en kant: dypere vann på flere sider – her samles ofte strøm og mat');
  if (fe.shelf > 0.5 && r.P.b && r.P.b.shelf) out.push('Hylle: nesten flatt like rundt, med en kant ned mot ca. ' + fmt(fe.shD, 0) + ' m innen ca. 250 m – kveita ligger ofte på slike hyller nær dypere vann');
  if (fe.basin > 0.4 && (r.P.w.basin || 0) > 0) out.push('Grop eller basseng: ca. ' + fmt(fe.d0 - fe.ringMean, 0) + ' m dypere enn bunnen rundt – her samles ofte mudder');
  if (fe.slake > 0.6 && (r.P.w.slake || 0) > 0) out.push('Slak bakke: bunnen skrår jevnt, ca. ' + fmt(fe.mn, 0) + '–' + fmt(fe.mx, 0) + ' m like rundt');
  else if (fe.flat > 0.7 && (r.P.w.flat || 0) > 0) out.push('Flat bunn');
  if (fe.sund > 0.4 && ((r.P.b && r.P.b.sund) || 0) > 0) out.push('Smalt sund (ca. ' + fmt(Math.round(fe.sundW / 50) * 50, 0) + ' m bredt) – her går tidevannsstrømmen ofte sterkere');
  if (fe.neardeep && (r.P.w.neardeep || 0) > 0) out.push('Nær dypere vann');
  if (fe.shore && (r.P.w.shore || 0) > 0) out.push(fe.shore === 1 ? 'Nær land (under ca. 100 m)' : 'Ca. 100–300 m fra land');
  const bu = R.algo[r.sp].bunn;
  if (fe.bt) { const ok = bu && (bu.pref.indexOf(fe.bt) >= 0 || (bu.overgang && fe.ov)), bad = bu && bu.avoid && bu.avoid.indexOf(fe.bt) >= 0;
    out.push('Bunntype (NGU): ' + esc(bunnNavn(fe.bt).toLowerCase()) + (bu ? (ok ? ' – passer: ' : bad ? ' – passer dårlig: ' : ' – ') + esc(ART[r.sp].no.toLowerCase()) + ' liker ' + esc(bu.t) + src(bu.s) : '') + src(['ngu_sed'])); }
  if (r.fp) out.push('Ligger i en fiskeplass fiskerne har registrert for ' + esc(ART[r.sp].no.toLowerCase()) + ' denne måneden (' + esc(r.fp) + ')');
  if (r.P.varsel) out.push('<span class="warn">' + esc(r.P.varsel) + '</span>');
  return out;
}
export function algoWhy(r) {
  const A = R.algo[r.sp], grad = r.sc >= 0.8 ? 'godt' : r.sc >= 0.6 ? 'middels' : 'svakt';
  return '<div class="pal"><b>' + esc(ART[r.sp].no) + (r.rank ? ' nr. ' + r.rank : '') + '</b> <span class="pmut">passer kriteriene ' + grad + '</span><ul class="pul">' + algoLines(r).map((t) => '<li>' + t + '</li>').join('') + '</ul>' +
    '<span class="pmut">Grunnlag: ' + esc(A.hvorfor + (r.P.hvorfor ? '; ' + r.P.hvorfor : '')) + '.</span> ' + src(A.kilde) + (A.fsim ? ' <span class="tag">lagt til i Fiskesim</span>' : '') +
    ' <a class="more" href="https://rdrugis.github.io/Fiskeguide/#' + (A.fsim ? 'arter' : 'art-' + esc(r.sp)) + '" target="_blank" rel="noopener">Mer om ' + esc(ART[r.sp].no.toLowerCase()) + ' i Fiskeguiden</a></div>';
}
export { rd, km };
