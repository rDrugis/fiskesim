// Drivstoffkalkulator: trykk punkter i kartet for ruten, så regnes distanse, tid, liter og kroner.
// Forbruk (liter i timen ved valgt fart), fart og literpris settes av brukeren og huskes i nettleseren.
const R = 6371008.8, rad = Math.PI / 180, NM = 1852;
const dist = (a, b) => { const x = (b[0] - a[0]) * rad * Math.cos((a[1] + b[1]) / 2 * rad), y = (b[1] - a[1]) * rad; return R * Math.hypot(x, y); };
const fmt = (v, d = 0) => Number(v).toLocaleString('nb-NO', { minimumFractionDigits: d, maximumFractionDigits: d });
import { autoRoute } from './autoroute.js';
const DEF = { kn: 20, lph: 20, pris: 26, reserve: 20, retur: false, auto: false, mind: 2 }; // 26 kr/l: snittpris bensin okt. 2026 (SSB), endres av brukeren
export const ICON_FUEL = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M3 21h13M7 7h5"/><path d="M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"/></svg>';

export class Fuel {
  constructor(api, panel, { onMode = () => {} } = {}) {
    this.api = api; this.panel = panel; this.onMode = onMode; this.pts = []; this.legs = []; this.busy = 0; this.on = false;
    try { this.o = { ...DEF, ...JSON.parse(localStorage.getItem('fiskesim.fuel') || '{}') }; } catch (e) { this.o = { ...DEF }; }
    api.onStyle((map) => this.addLayers(map));
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      if (b.dataset.f === 'close') this.clear();
      else if (b.dataset.f === 'undo') { this.pts.pop(); this.legs.length = this.pts.length; this.sync(); this.render(); }
      else if (b.dataset.f === 'reset') { this.pts = []; this.legs = []; this.sync(); this.render(); }
    });
    panel.addEventListener('input', (e) => {
      const k = e.target.dataset.k; if (!k) return;
      this.o[k] = e.target.type === 'checkbox' ? e.target.checked : Math.max(0, parseFloat(String(e.target.value).replace(',', '.')) || 0);
      try { localStorage.setItem('fiskesim.fuel', JSON.stringify(this.o)); } catch (err) { /* privat */ }
      if (k === 'auto') this.render();
      if (k === 'auto' || k === 'mind') { clearTimeout(this.rt); this.rt = setTimeout(() => this.reroute(), k === 'mind' ? 600 : 0); }
      this.renderOut();
    });
  }
  get active() { return this.on; }
  addLayers(map) {
    if (!map.getSource('fu')) map.addSource('fu', { type: 'geojson', data: this.geo() });
    if (!map.getLayer('fu-line')) map.addLayer({ id: 'fu-line', type: 'line', source: 'fu', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#ffd23f', 'line-width': 3, 'line-dasharray': [2, 1.2] }, layout: { 'line-cap': 'round' } });
    if (!map.getLayer('fu-pt')) map.addLayer({ id: 'fu-pt', type: 'circle', source: 'fu', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#ffd23f', 'circle-stroke-color': '#10202a', 'circle-stroke-width': 2 } });
  }
  geo() {
    const f = this.pts.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }));
    if (this.pts.length > 1) f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: this.line() }, properties: {} });
    return { type: 'FeatureCollection', features: f };
  }
  sync() { const s = this.api.map.getSource('fu'); if (s) s.setData(this.geo()); }
  start() { this.on = true; this.onMode(true); this.panel.classList.remove('hidden'); this.render(); }
  clear() { this.on = false; this.pts = []; this.legs = []; this.sync(); this.panel.classList.add('hidden'); this.onMode(false); }
  click(lon, lat) {
    if (!this.on) return false; this.pts.push([lon, lat]); this.legs.length = this.pts.length;
    if (this.o.auto && this.pts.length > 1) this.routeLeg(this.pts.length - 1);
    this.sync(); this.render(); return true;
  }
  // linjen i kartet: auto-rute der den finnes, ellers rett strek
  line() { const out = [this.pts[0]]; for (let i = 1; i < this.pts.length; i++) { const l = this.legs[i]; if (l && l.path) out.push(...l.path.slice(1)); else out.push(this.pts[i]); } return out; }
  async routeLeg(i) {
    const a = this.pts[i - 1], b = this.pts[i], tag = { a, b, mind: this.o.mind }; this.legs[i] = { tag, busy: true }; this.busy++; this.renderOut();
    let r; try { r = await autoRoute(this.api.navGrid, this.api.depthsAt, a, b, { minDepth: this.o.mind }); } catch (e) { r = { error: 'Ruteberegning feilet' }; }
    this.busy--; if (this.legs[i] && this.legs[i].tag === tag) { this.legs[i] = { tag, ...r }; this.sync(); }
    this.renderOut();
  }
  reroute() { this.legs = new Array(this.pts.length); if (this.o.auto) for (let i = 1; i < this.pts.length; i++) this.routeLeg(i); this.sync(); this.renderOut(); }

  calc() {
    let m = 0; const L = this.line(); for (let i = 1; i < L.length; i++) m += dist(L[i - 1], L[i]);
    const o = this.o, nm = (m / NM) * (o.retur ? 2 : 1), h = o.kn > 0 ? nm / o.kn : 0, l = h * o.lph, lr = l * (1 + o.reserve / 100);
    return { nm, h, l, lr, kr: l * o.pris, lpn: o.kn > 0 ? o.lph / o.kn : 0 };
  }
  render() {
    const o = this.o, inp = (k, lab, unit, step) => `<label class="fuin"><span>${lab}</span><input type="number" inputmode="decimal" min="0" step="${step}" data-k="${k}" value="${o[k]}"><em>${unit}</em></label>`;
    this.panel.innerHTML = `
      <header><h2>Drivstoff</h2><span class="pmut">trykk punkter i kartet for ruten</span><span class="psp"></span><button class="iconbtn sm" data-f="close" aria-label="Lukk">✕</button></header>
      <div class="fuout"></div>
      <div class="fugrid">${inp('kn', 'Fart', 'knop', 1)}${inp('lph', 'Forbruk', 'l/time', 1)}${inp('pris', 'Pris', 'kr/l', 0.5)}${inp('reserve', 'Reserve', '%', 5)}</div>
      <label class="tog"><input type="checkbox" data-k="retur" ${o.retur ? 'checked' : ''}><span>Tur-retur</span></label>
      <label class="tog"><input type="checkbox" data-k="auto" ${o.auto ? 'checked' : ''}><span>Auto-rute rundt land og grunner</span></label>
      <div class="fugrid fuauto${o.auto ? '' : ' hidden'}">${inp('mind', 'Min. dybde', 'm', 0.5)}</div>
      <div class="furow"><button class="btn sm" data-f="undo" ${this.pts.length ? '' : 'disabled'}>Angre punkt</button><button class="btn sm" data-f="reset" ${this.pts.length ? '' : 'disabled'}>Ny rute</button></div>
      <p class="pmut">Forbruket varierer mye med båt, last, sjø og motor – sjekk motorens forbrukstabell. ${o.auto ? 'Auto-ruten er bare for å anslå distanse, <b>ikke til navigasjon</b>: rutenettet er grovt, og små skjær kan mangle.' : 'Rett linje mellom punktene, uten strøm og vind.'}</p>`;
    this.renderOut();
  }
  renderOut() {
    const el = this.panel.querySelector('.fuout'); if (!el) return;
    if (this.pts.length < 2) { el.innerHTML = `<p class="pmut">${this.pts.length ? 'Trykk neste punkt …' : 'Trykk startpunktet i kartet.'}</p>`; return; }
    const r = this.calc(), hh = Math.floor(r.h), mm = Math.round((r.h - hh) * 60);
    const errs = this.o.auto ? this.legs.filter((l) => l && (l.error || l.warn)).map((l) => l.error ? l.error + ' – den etappen er regnet som rett linje' : l.warn) : [];
    const cell = this.o.auto ? Math.max(0, ...this.legs.filter((l) => l && l.cell).map((l) => l.cell)) : 0;
    const note = this.busy ? '<p class="pmut">Beregner rute rundt land …</p>' : errs.length ? `<p class="pmut">${errs[0]}.</p>` : cell ? `<p class="pmut">Auto-rute, rutenett ca. ${cell} m.</p>` : '';
    el.innerHTML = `<div class="fubig"><div><b>${fmt(r.nm, 1)}</b> nm</div><div><b>${hh ? hh + ' t ' : ''}${mm} min</b></div><div><b>${fmt(r.l, 1)}</b> l</div><div><b>${fmt(r.kr)}</b> kr</div></div>
      ${note}<p class="pmut">Ha med minst <b>${fmt(r.lr, 0)} l</b> (med ${fmt(this.o.reserve)} % reserve) · ${fmt(r.lpn, 2)} l per nautisk mil</p>`;
  }
}
