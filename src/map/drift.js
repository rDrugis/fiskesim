// Drift: hvor båten driver med strøm og vind (beregningen er den samme som i Fiskeguide).
// Nytt oppsett: du trykker der du vil fiske, og kartet viser hvor du bør stoppe motoren for å drive over punktet,
// med et bånd for usikkerheten og perler hvert 5. minutt.
//  • Strøm: MET Norway oceanforecast (havmodellen, nærmeste modellpunkt).
//  • Vind: MET Norway locationforecast (10 m).
//  • Vinddrift (leeway): andel av vinden etter båttype og lengde, målt i felt (USCG, MET). Båten driver ±ang° ut fra
//    rett nedvind; ytterkantene av båndet er de to retningene.
import { SRC } from '../data/sources.js';

const R = 6371008.8, rad = Math.PI / 180, KN = 1.94384;
const DIRS = ['N', 'NNØ', 'NØ', 'ØNØ', 'Ø', 'ØSØ', 'SØ', 'SSØ', 'S', 'SSV', 'SV', 'VSV', 'V', 'VNV', 'NV', 'NNV'];
const compass = (d) => DIRS[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];
const fmt = (v, d = 0) => Number(v).toLocaleString('nb-NO', { minimumFractionDigits: d, maximumFractionDigits: d });
const clock = (t) => new Date(t).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' });
const dest = (p, dir, m) => { const dy = m * Math.cos(dir * rad) / R / rad, dx = m * Math.sin(dir * rad) / (R * Math.cos(p[1] * rad)) / rad; return [p[0] + dx, p[1] + dy]; };
const dist = (a, b) => { const x = (b[0] - a[0]) * rad * Math.cos((a[1] + b[1]) / 2 * rad), y = (b[1] - a[1]) * rad; return R * Math.hypot(x, y); };
const brg = (a, b) => { const x = (b[0] - a[0]) * Math.cos((a[1] + b[1]) / 2 * rad), y = b[1] - a[1]; return (Math.atan2(x, y) / rad + 360) % 360; };

export const BOATS = {
  open: { navn: 'Åpen båt eller konsollbåt', kort: 'Åpen', pts: [[4.2, 0.0398], [5.8, 0.0493]], ang: 20,
    tekst: 'Målt i felt: 14 fots påhengsbåt 4,0 % av vinden og 19 fots konsollbåt 4,9 %; en 4,15 m åpen skiff ved Fedje ca. 4 %. Lengder mellom målingene er interpolert.' },
  cabin: { navn: 'Båt med kahytt eller styrehus', kort: 'Kahytt', pts: [[6.1, 0.0582], [12, 0.040]], ang: 30,
    tekst: 'Målt i felt: 20 fots kabinbåt 5,8 % av vinden og et mellomstort fiskefartøy 4,0 % (30 ± 15° ut fra nedvind). Lengder mellom er et grovt anslag.' },
};
const KILDER = [
  ['MET Norway: oceanforecast (strøm) og locationforecast (vind)', 'https://api.met.no/weatherapi/'],
  ['USCG R&D Center (1992): leeway for 14 og 19 fots åpne båter og 20 fots kabinbåt', 'https://apps.dtic.mil/sti/pdfs/ADA252345.pdf'],
  ['USCG-studie (AGRIS): mellomstort fiskefartøy 4,0 % av vinden', 'https://agris.fao.org/search/en/records/647367ba53aa8c89630ce903'],
  ['Breivik mfl., MET report 17/2010: leeway målt med skiff ved Fedje', 'https://www.met.no/publikasjoner/met-report/met-report-2010/_/attachment/download/a8b16efd-55af-4418-b403-f14aa924b723:14e9e81be5596a1ff441ca0e93eb4c6b2b4348c9/MET-report-17-2010.pdf'],
];
export const leeRate = (M, len) => { const P = M.pts; if (len <= P[0][0]) return P[0][1]; if (len >= P[P.length - 1][0]) return P[P.length - 1][1];
  for (let i = 1; i < P.length; i++) if (len <= P[i][0]) { const f = (len - P[i - 1][0]) / (P[i][0] - P[i - 1][0]); return P[i - 1][1] + f * (P[i][1] - P[i - 1][1]); } return P[0][1]; };

// lineær interpolasjon i tid (vektorer interpoleres som komponenter, så retningen blir riktig rundt nord)
function vecAt(series, t) {
  if (!series.length) return null;
  if (t <= series[0].t) return series[0];
  for (let i = 1; i < series.length; i++) if (series[i].t >= t) { const a = series[i - 1], b = series[i], f = (t - a.t) / (b.t - a.t); return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; }
  return series[series.length - 1];
}
const toVec = (sp, toDir) => ({ x: sp * Math.sin(toDir * rad), y: sp * Math.cos(toDir * rad) });

const CACHE = new Map();
async function getJSON(url) {
  for (let k = 0; k < 2; k++) { try { const r = await fetch(url); if (r.ok) return await r.json(); if (r.status === 404 || r.status === 422) return null; } catch (e) { /* prøv igjen */ } await new Promise((res) => setTimeout(res, 1000)); }
  return null;
}
export async function fetchFlow(lon, lat) {
  const la = lat.toFixed(3), lo = lon.toFixed(3), key = la + ',' + lo, hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < 15 * 60e3) return hit.v;
  const [loc, oce] = await Promise.all([
    getJSON(`${SRC.met}/locationforecast/2.0/compact?lat=${la}&lon=${lo}`),
    getJSON(`${SRC.met}/oceanforecast/2.0/complete?lat=${la}&lon=${lo}`),
  ]);
  const wind = loc ? loc.properties.timeseries.map((e) => { const d = e.data.instant.details; return { t: Date.parse(e.time), ...toVec(d.wind_speed || 0, ((d.wind_from_direction || 0) + 180) % 360) }; }) : [];
  const cur = oce ? oce.properties.timeseries.map((e) => { const d = e.data.instant.details; return d.sea_water_speed == null ? null : { t: Date.parse(e.time), ...toVec(d.sea_water_speed, d.sea_water_to_direction || 0) }; }).filter(Boolean) : [];
  const v = { wind, cur, ok: !!wind.length, cur0: !!cur.length };
  CACHE.set(key, { at: Date.now(), v });
  return v;
}

/* Driftbanen gjennom målpunktet: lead minutter før (der du stopper motoren) og after minutter etter.
   Returnerer midtlinja og de to ytterkantene (±ang ut fra nedvind), med punkt hvert 5. minutt. */
export function driftPaths(F, target, t0, boat, lead = 10, after = 30) {
  const M = BOATS[boat.type] || BOATS.open, rate = leeRate(M, +boat.len || 4.6), STEP = 5;
  const vel = (t, da) => {
    const c = vecAt(F.cur, t) || { x: 0, y: 0 }, w = vecAt(F.wind, t) || { x: 0, y: 0 };
    const U = Math.hypot(w.x, w.y), wd = (Math.atan2(w.x, w.y) / rad + 360) % 360, ld = (wd + da) * rad;
    return { x: c.x + rate * U * Math.sin(ld), y: c.y + rate * U * Math.cos(ld), c, U, wd };
  };
  const path = (da) => {
    const back = [target.slice()], fwd = [target.slice()];
    for (let m = STEP; m <= lead; m += STEP) { const v = vel(t0 - (m - STEP / 2) * 60e3, da), sp = Math.hypot(v.x, v.y), dir = Math.atan2(v.x, v.y) / rad; back.push(dest(back[back.length - 1], dir + 180, sp * STEP * 60)); }
    for (let m = STEP; m <= after; m += STEP) { const v = vel(t0 + (m - STEP / 2) * 60e3, da), sp = Math.hypot(v.x, v.y), dir = Math.atan2(v.x, v.y) / rad; fwd.push(dest(fwd[fwd.length - 1], dir, sp * STEP * 60)); }
    return back.reverse().concat(fwd.slice(1)); // fra start (−lead) til slutt (+after)
  };
  const mid = path(0), L = path(-M.ang), Rr = path(M.ang), v0 = vel(t0, 0), sp = Math.hypot(v0.x, v0.y);
  return { mid, L, R: Rr, step: STEP, lead, after, M, rate,
    sp, dir: (Math.atan2(v0.x, v0.y) / rad + 360) % 360,
    cs: Math.hypot(v0.c.x, v0.c.y), cd: (Math.atan2(v0.c.x, v0.c.y) / rad + 360) % 360,
    U: v0.U, wd: v0.wd, lw: rate * v0.U };
}

const ICON_DRIFT = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8c2-1.5 4-1.5 6 0s4 1.5 6 0"/><path d="M3 13c2-1.5 4-1.5 6 0s4 1.5 6 0"/><path d="M15 18h6M18 15l3 3-3 3"/></svg>';
export { ICON_DRIFT };

export class Drift {
  constructor(api, panel, { onMode = () => {}, onOpen = () => {} } = {}) {
    this.api = api; this.panel = panel; this.onMode = onMode; this.onOpen = onOpen;
    this.target = null; this.res = null; this.F = null; this.picking = false; this.run = 0; this.ofs = 0; this.lead = 10; this.mk = null; this.startMk = null;
    try { this.boat = JSON.parse(localStorage.getItem('fiskesim.boat')) || { type: 'open', len: 4.6 }; } catch (e) { this.boat = { type: 'open', len: 4.6 }; }
    api.onStyle((map) => this.addLayers(map));
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-d]'); if (!b) return;
      const k = b.dataset.d, v = b.dataset.v;
      if (k === 'clear') this.clear();
      else if (k === 'here') { const c = this.api.map.getCenter(); this.click(c.lng, c.lat); }
      else if (k === 'new') this.start();
      else if (k === 'ofs') { this.ofs = +v; this.calc(); }
      else if (k === 'lead') { this.lead = +v; this.calc(); }
      else if (k === 'btype') { this.boat.type = v; this.saveBoat(); this.calc(); }
      else if (k === 'blen') { this.boat.len = Math.max(2, Math.min(30, Math.round((+this.boat.len + +v) * 10) / 10)); this.saveBoat(); this.calc(); }
    });
  }
  get active() { return this.picking; }
  get shown() { return !!this.target || this.picking; }
  saveBoat() { try { localStorage.setItem('fiskesim.boat', JSON.stringify(this.boat)); } catch (e) { /* privat */ } }

  addLayers(map) {
    if (!map.getSource('dr')) map.addSource('dr', { type: 'geojson', data: this.geo() });
    const has = (id) => map.getLayer(id);
    if (!has('dr-band')) map.addLayer({ id: 'dr-band', type: 'fill', source: 'dr', filter: ['==', ['get', 'k'], 'band'], paint: { 'fill-color': '#bfe9ff', 'fill-opacity': 0.16 } });
    if (!has('dr-edge')) map.addLayer({ id: 'dr-edge', type: 'line', source: 'dr', filter: ['==', ['get', 'k'], 'edge'], paint: { 'line-color': '#bfe9ff', 'line-width': 1, 'line-opacity': 0.45, 'line-dasharray': [2, 3] } });
    if (!has('dr-lead')) map.addLayer({ id: 'dr-lead', type: 'line', source: 'dr', filter: ['==', ['get', 'k'], 'lead'], paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-opacity': 0.9, 'line-dasharray': [1, 1.6] }, layout: { 'line-cap': 'round' } });
    if (!has('dr-line')) map.addLayer({ id: 'dr-line', type: 'line', source: 'dr', filter: ['==', ['get', 'k'], 'after'], paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-opacity': 0.95 }, layout: { 'line-cap': 'round' } });
    if (!has('dr-bead')) map.addLayer({ id: 'dr-bead', type: 'circle', source: 'dr', filter: ['==', ['get', 'k'], 'bead'],
      paint: { 'circle-radius': ['case', ['get', 'big'], 5, 3], 'circle-color': '#0f232d', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
    if (!has('dr-min')) map.addLayer({ id: 'dr-min', type: 'symbol', source: 'dr', filter: ['all', ['==', ['get', 'k'], 'bead'], ['get', 'big']],
      layout: { 'text-field': ['get', 'lbl'], 'text-size': 12, 'text-offset': [0, -1.3], 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': false },
      paint: { 'text-color': '#ffffff', 'text-halo-color': '#0b1820', 'text-halo-width': 1.6 } });
  }
  geo() {
    const f = [], r = this.res; if (!r) return { type: 'FeatureCollection', features: f };
    const n = r.mid.length, li = r.lead / r.step;
    // usikkerheten vises bare framover fra fiskeplassen (bakover er det bare én strek til der du stopper)
    const fL = r.L.slice(li), fR = r.R.slice(li);
    f.push({ type: 'Feature', properties: { k: 'band' }, geometry: { type: 'Polygon', coordinates: [fL.concat(fR.slice().reverse(), [fL[0]])] } });
    f.push({ type: 'Feature', properties: { k: 'edge' }, geometry: { type: 'LineString', coordinates: fL } });
    f.push({ type: 'Feature', properties: { k: 'edge' }, geometry: { type: 'LineString', coordinates: fR } });
    f.push({ type: 'Feature', properties: { k: 'lead' }, geometry: { type: 'LineString', coordinates: r.mid.slice(0, li + 1) } });
    f.push({ type: 'Feature', properties: { k: 'after' }, geometry: { type: 'LineString', coordinates: r.mid.slice(li) } });
    for (let i = 1; i < n; i++) { if (i === li) continue; const m = (i - li) * r.step, big = m % 15 === 0 && m > 0;
      f.push({ type: 'Feature', properties: { k: 'bead', big, lbl: '+' + m + ' min' }, geometry: { type: 'Point', coordinates: r.mid[i] } }); }
    return { type: 'FeatureCollection', features: f };
  }
  sync() { const s = this.api.map.getSource('dr'); if (s) s.setData(this.geo()); }

  start() {
    this.clear(true); this.onOpen();
    this.picking = true; this.onMode(true);
    this.api.map.getCanvas().style.cursor = 'crosshair';
    this.show(`<header><h2>Drift</h2><span class="pmut">Trykk der du vil fiske – du får se hvor du skal stoppe motoren</span><span class="psp"></span>
      <button class="btn sm primary" data-d="here">Bruk krysset</button><button class="btn sm" data-d="clear">Avbryt</button></header>`);
  }
  click(lng, lat) {
    if (!this.picking) return false;
    this.picking = false; this.onMode(false); this.api.map.getCanvas().style.cursor = '';
    this.target = [lng, lat]; this.marker(); this.calc(true);
    return true;
  }
  marker() {
    const ml = this.api.maplibregl;
    if (this.mk) this.mk.remove();
    const el = document.createElement('div'); el.className = 'dr-tgt'; el.title = 'Fiskeplassen – dra for å flytte';
    this.mk = new ml.Marker({ element: el, draggable: true }).setLngLat(this.target).addTo(this.api.map);
    this.mk.on('dragend', () => { const p = this.mk.getLngLat(); this.target = [p.lng, p.lat]; this.calc(true); });
  }
  startMarker(p) {
    const ml = this.api.maplibregl;
    if (!this.startMk) { const el = document.createElement('div'); el.className = 'dr-start'; el.innerHTML = '<span>Stopp her</span>'; this.startMk = new ml.Marker({ element: el, anchor: 'bottom' }); }
    this.startMk.setLngLat(p).addTo(this.api.map);
  }
  clear(keepPanel) {
    this.run++; this.target = null; this.res = null; this.F = null;
    if (this.picking) { this.picking = false; this.onMode(false); }
    this.api.map.getCanvas().style.cursor = '';
    if (this.mk) { this.mk.remove(); this.mk = null; }
    if (this.startMk) { this.startMk.remove(); this.startMk = null; }
    this.sync();
    if (!keepPanel) this.panel.classList.add('hidden');
  }
  show(html) { this.panel.innerHTML = html; this.panel.classList.remove('hidden'); }

  async calc(refetch) {
    if (!this.target) return;
    const run = ++this.run;
    if (refetch || !this.F) {
      this.show(this.headHTML() + '<p class="hint">Henter strøm og vind fra MET …</p>');
      let F; try { F = await fetchFlow(this.target[0], this.target[1]); } catch (e) { F = null; }
      if (run !== this.run) return;
      if (!F || !F.ok) { this.res = null; this.sync(); this.show(this.headHTML() + '<p class="hint warn">Fikk ikke hentet vindvarsel fra MET for punktet.</p>'); return; }
      this.F = F;
    }
    const t0 = Date.now() + this.ofs * 3600e3;
    this.res = driftPaths(this.F, this.target, t0, this.boat, this.lead, 30); this.t0 = t0;
    this.sync(); this.startMarker(this.res.mid[0]);
    this.show(this.headHTML() + this.bodyHTML());
  }

  headHTML() {
    return `<header><h2>Drift</h2><span class="psp"></span><button class="btn sm" data-d="new">Nytt punkt</button><button class="btn sm" data-d="clear">Fjern</button></header>`;
  }
  dial(r) {
    // kompassrose med tre piler: strøm (blå), vinddrift (grå) og samlet drift (hvit). Lengdene skaleres mot største.
    const S = 46, c = S, mx = Math.max(r.sp, r.cs, r.lw, 0.05), k = (S - 10) / mx;
    const arrow = (sp, dir, cls, w) => { if (sp < 0.003) return ''; const L = sp * k, x = c + L * Math.sin(dir * rad), y = c - L * Math.cos(dir * rad), a1 = (dir + 155) * rad, a2 = (dir - 155) * rad, h = Math.min(9, 3 + L * 0.25);
      return `<g class="${cls}"><line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke-width="${w}"/><path d="M${x.toFixed(1)},${y.toFixed(1)}L${(x + h * Math.sin(a1)).toFixed(1)},${(y - h * Math.cos(a1)).toFixed(1)}L${(x + h * Math.sin(a2)).toFixed(1)},${(y - h * Math.cos(a2)).toFixed(1)}Z"/></g>`; };
    const ticks = [0, 90, 180, 270].map((d) => `<text x="${c + (S - 2) * Math.sin(d * rad)}" y="${c - (S - 2) * Math.cos(d * rad) + 4}" text-anchor="middle">${['N', 'Ø', 'S', 'V'][d / 90]}</text>`).join('');
    return `<svg class="drdial" viewBox="0 0 ${2 * S} ${2 * S}" width="${2 * S}" height="${2 * S}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${S - 12}" class="ring"/>${ticks}
      ${arrow(r.lw, r.wd, 'aw', 2)}${arrow(r.cs, r.cd, 'ac', 2)}${arrow(r.sp, r.dir, 'at', 3.5)}<circle cx="${c}" cy="${c}" r="3" class="hub"/></svg>`;
  }
  bodyHTML() {
    const r = this.res, F = this.F, b = this.boat, M = r.M, lead = dist(r.mid[0], this.target), back = brg(this.target, r.mid[0]);
    const end = r.mid[r.mid.length - 1], d30 = dist(this.target, end);
    const chips = (k, list, cur) => list.map(([v, t]) => `<button class="chip${cur === v ? ' on' : ''}" data-d="${k}" data-v="${v}">${t}</button>`).join('');
    const slow = r.sp * KN < 0.15;
    return `<div class="drgrid">
      ${this.dial(r)}
      <div class="drmain">
        <div class="drbig num"><b>${fmt(r.sp * KN, 1)}</b> kn <span>mot ${compass(r.dir)}</span></div>
        <p class="drgo">${slow ? 'Nesten ingen drift – du blir liggende nær punktet.' : `Stopp motoren ca. <b>${fmt(Math.round(lead / 10) * 10)} m ${compass(back)}</b> for punktet, så driver du over det etter ca. ${r.lead} min og ${fmt(Math.round(d30 / 10) * 10)} m videre på en halvtime.`}</p>
        <p class="drleg"><span><i class="lc"></i>Strøm ${F.cur0 ? fmt(r.cs * KN, 1) + ' kn mot ' + compass(r.cd) : 'mangler'}</span><span><i class="lw"></i>Vind ${fmt(r.U, 0)} m/s gir ${fmt(r.lw * KN, 1)} kn mot ${compass(r.wd)}</span></p>
      </div>
    </div>
    <div class="drctl">
      <div class="drrow"><span class="drl">Når</span>${chips('ofs', [[0, 'Nå'], [1, '+1 t'], [2, '+2 t'], [3, '+3 t'], [6, '+6 t']], this.ofs)}<span class="pmut num">kl. ${clock(this.t0)}</span></div>
      <div class="drrow"><span class="drl">Start</span>${chips('lead', [[5, '5 min'], [10, '10 min'], [15, '15 min']], this.lead)}<span class="pmut">før punktet</span></div>
      <div class="drrow"><span class="drl">Båt</span>${chips('btype', [['open', BOATS.open.kort], ['cabin', BOATS.cabin.kort]], b.type)}
        <span class="drlen"><button class="chip" data-d="blen" data-v="-0.5" aria-label="Kortere">−</button><b class="num">${fmt(b.len, 1)} m</b><button class="chip" data-d="blen" data-v="0.5" aria-label="Lengre">+</button></span></div>
    </div>
    ${F.cur0 ? '' : '<p class="hint warn">MET har ikke strømvarsel her – bare vinddrift er med.</p>'}
    <details class="drmore"><summary>Slik er det regnet ut</summary><p>Strømmen er fra METs havmodell (nærmeste modellpunkt) og vinden fra METs punktvarsel. Vinddriften er ${fmt(r.rate * 100, 1)} % av vinden for ${M.navn.toLowerCase()}. ${M.tekst} Båndet viser spredningen når båten driver ±${M.ang}° ut fra rett nedvind. Usikkert: i sund, bak nes og nær land kan strømmen avvike mye fra modellen, og tidevannsstrømmen i trange sund er ofte sterkere enn modellen viser.</p>
      <ul>${KILDER.map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${t}</a></li>`).join('')}</ul></details>`;
  }
}
