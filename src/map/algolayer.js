// Fiskeplasser fra algoritmen i kartet (av/på), med forklaring per art. Plasser du velger («Behold i kartet»)
// blir liggende i kartet også når forslagene er slått av, til du fjerner dem.
import { algoRun, heatTiles, ATILE, ART, R, esc, km, HIDDEN } from '../algo/index.js';
import { unmerc } from '../algo/core.js';

const starBg = (cols) => cols.length > 1 ? 'conic-gradient(' + cols.map((c, i) => c + ' ' + Math.round(i * 100 / cols.length) + '% ' + Math.round((i + 1) * 100 / cols.length) + '%').join(',') + ')' : cols[0];
const load = (k, d) => { try { const v = localStorage.getItem('fiskesim.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem('fiskesim.' + k, JSON.stringify(v)); } catch (e) { /* privat modus */ } };

export class AlgoLayer {
  constructor(api, { onNote = () => {}, onSaved = () => {}, onReport = null } = {}) {
    this.api = api; this.onNote = onNote; this.onSaved = onSaved; this.onReport = onReport;
    this.on = load('algo', false); this.sel = load('algoSel', []).filter((k) => !HIDDEN.includes(k)); this.mon = load('algoMon', 'now');
    this.markers = []; this.saved = load('plasser', []); this.savedMarkers = [];
    this.timer = 0; this.heat = load('algoHeat', false); this.heatIds = new Set();
    api.map.on('moveend', () => this.schedule());
    api.onStyle(() => { this.heatIds.clear(); this.drawHeat(); });
    this.drawSaved();
    if (this.on) this.schedule(50);
  }
  month() { return this.mon === 'now' ? new Date().getMonth() : +this.mon; }
  setOn(on) { this.on = on; save('algo', on); if (on) this.schedule(10); else { this.clear(); this.clearHeat(); this.onNote(''); } }
  setHeat(on) { this.heat = on; save('algoHeat', on); if (on) { this.drawHeat(); this.schedule(10); } else this.clearHeat(); }
  setSel(sel) { this.sel = sel; save('algoSel', sel); this.drawHeat(); this.schedule(10); }
  setMonth(m) { this.mon = m; save('algoMon', m); this.drawHeat(); this.schedule(10); }
  schedule(ms = 350) { clearTimeout(this.timer); if (!this.on) return; this.timer = setTimeout(() => this.run(), ms); }

  async run() {
    const map = this.api.map;
    if (map.getZoom() < 10.5) { this.clear(); this.onNote('Zoom inn for å se fiskeplasser.'); return; }
    const b = map.getBounds(), bb = { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() };
    this.onNote('Beregner fiskeplasser …', true);
    let out;
    try { out = await algoRun(bb, this.month(), this.sel, (t) => this.onNote(t + ' …', true)); }
    catch (e) { this.onNote('Fikk ikke beregnet fiskeplasser: ' + (e.message || e)); return; }
    if (!out || !this.on) return;
    this.res = out.res; this.draw(); this.drawHeat(); this.onNote(out.note); this.onSaved();
  }

  /* fargekartet: alle ferdige ruter i utsnittet settes sammen til ett bilde (myk overgang, ingen skjøter).
     Fargen er relativ til utsnittet og glir fra blått (svakest her) via lyst og oransje til rødt (beste ca. 5 %).
     Poengene er de samme som algoritmen bruker for forslagene. */
  drawHeat() {
    const map = this.api.map;
    if (!this.on || !this.heat || map.getZoom() < 10.5) { this.clearHeat(); return; }
    const b = map.getBounds(), tiles = heatTiles({ s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() }, this.month(), this.sel);
    if (!tiles.length) { this.clearHeat(); return; }
    const T = new Map(tiles.map((t) => [t.tx + '|' + t.ty, t]));
    const X0 = Math.min(...tiles.map((t) => t.tx)) * ATILE, X1 = (Math.max(...tiles.map((t) => t.tx)) + 1) * ATILE;
    const Y0 = Math.min(...tiles.map((t) => t.ty)) * ATILE, Y1 = (Math.max(...tiles.map((t) => t.ty)) + 1) * ATILE;
    const P = 60, W = Math.round((X1 - X0) / P), H = Math.round((Y1 - Y0) / P), val = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) { const y = Y1 - (j + 0.5) * P, ty = Math.floor(y / ATILE);
      for (let i = 0; i < W; i++) { const x = X0 + (i + 0.5) * P, t = T.get(Math.floor(x / ATILE) + '|' + ty); if (!t) continue;
        const B = t.bs * 10, bi = Math.floor((x - t.x0) / B), bj = Math.floor((t.y1 - y) / B);
        if (bi >= 0 && bj >= 0 && bi < t.nb && bj < t.nb) val[j * W + i] = t.v[bj * t.nb + bi]; } }
    // myk overgang: glatt verdiene (to runder boksfilter, ca. én blokk) – sjø uten poeng drar ned mot kanten
    const sea = new Uint8Array(W * H); for (let k = 0; k < W * H; k++) sea[k] = val[k] ? 1 : 0;
    let f = Float32Array.from(val); const tmp = new Float32Array(W * H), R2 = 3;
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let a = 0, n = 0; for (let d = -R2; d <= R2; d++) { const x = i + d; if (x < 0 || x >= W) continue; a += f[j * W + x]; n++; } tmp[j * W + i] = a / n; }
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let a = 0, n = 0; for (let d = -R2; d <= R2; d++) { const y = j + d; if (y < 0 || y >= H) continue; a += tmp[y * W + i]; n++; } f[j * W + i] = a / n; }
    }
    for (let k = 0; k < W * H; k++) val[k] = sea[k] ? Math.max(1, Math.round(f[k])) : 0;
    // farge etter rangering i utsnittet (andel av sjøen her med lavere poeng), glidende fra blått (svakt) til rødt (best)
    const cnt = new Uint32Array(256); let tot = 0; for (const v of val) if (v) { cnt[v]++; tot++; }
    const pct = new Float32Array(256); let acc = 0; for (let v = 1; v < 256; v++) { acc += cnt[v]; pct[v] = tot ? acc / tot : 0; }
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d'), im = g.createImageData(W, H);
    for (let k = 0; k < W * H; k++) { const v = val[k]; if (!v) continue; im.data.set(heatColor(pct[v]), k * 4); }
    g.putImageData(im, 0, 0);
    const ll = (x, y) => { const [la, lo] = unmerc(x, y); return [lo, la]; };
    const coordinates = [ll(X0, Y1), ll(X1, Y1), ll(X1, Y0), ll(X0, Y0)], url = cv.toDataURL();
    if (map.getSource('heat')) map.getSource('heat').updateImage({ url, coordinates });
    else { map.addSource('heat', { type: 'image', url, coordinates });
      const before = ['fa-pt', 'pt', 'fa-kl'].find((l) => map.getLayer(l));
      map.addLayer({ id: 'heat', type: 'raster', source: 'heat', paint: { 'raster-opacity': 0.85, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } }, before); }
    this.heatIds.add('heat');
  }
  removeHeat(id) { const map = this.api.map; if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); this.heatIds.delete(id); }
  clearHeat() { for (const id of [...this.heatIds]) this.removeHeat(id); }

  clear() { this.markers.forEach((m) => m.remove()); this.markers = []; }

  // forslag for flere arter på nesten samme sted blir ett merke med artenes farger (som i Fiskeguide)
  groups() {
    const used = new Set(), res = this.res || [], out = [];
    res.forEach((r, n) => {
      if (used.has(n)) return; const grp = [r]; used.add(n);
      res.forEach((q, m) => { if (!used.has(m) && km([r.lat, r.lon], [q.lat, q.lon]) < 0.15) { grp.push(q); used.add(m); } });
      out.push(grp);
    });
    return out;
  }
  draw() {
    this.clear();
    if (!this.on) return;
    const ml = this.api.maplibregl;
    this.groups().forEach((grp) => {
      const r = grp[0];
      if (this.savedAt(r.lat, r.lon)) return; // allerede beholdt: vises som stjerne
      const cols = grp.map((g) => ART[g.sp].col), allF = grp.every((g) => g.fredet), rk = grp.map((g) => g.rank).filter(Boolean);
      const el = document.createElement('button');
      el.className = 'algo-pt' + (allF ? ' fredet' : '');
      el.setAttribute('aria-label', 'Fiskeplass: ' + grp.map((g) => ART[g.sp].no).join(', '));
      el.innerHTML = `<span style="background:${starBg(cols)}">${rk.length ? Math.min(...rk) : '★'}</span>`;
      const pop = new ml.Popup({ maxWidth: '340px', className: 'pop algo', offset: 14 }).setHTML(this.popupHTML(grp));
      pop.on('open', () => this.wirePopup(pop, grp));
      const mk = new ml.Marker({ element: el }).setLngLat([r.lon, r.lat]).setPopup(pop).addTo(this.api.map);
      // trykk på forslaget åpner forklaringen (som i Fiskeguide). Klikket stoppes her så kartet ikke også åpner
      // punktinfo – derfor åpnes boblen direkte, ikke via kartets klikk.
      el.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(mk); });
      this.markers.push(mk);
    });
  }

  // én boble om gangen
  toggle(mk) {
    const pop = mk.getPopup(); if (!pop) return;
    if (pop.isOpen()) { pop.remove(); return; }
    if (this.openPop && this.openPop !== pop) this.openPop.remove();
    mk.togglePopup(); this.openPop = pop;
  }

  // kort boble: art, poeng (0–100), dybde og «Behold i kartet» – uten forklaring av algoritmen
  popupHTML(grp) {
    const r = grp[0], on = this.savedAt(r.lat, r.lon);
    return `<div class="pal">${grp.map(spLine).join('')}${depthLine(r.fe && r.fe.d0, r.ver ? [r.dA, r.dB] : null)}` +
      `<div class="pfoot"><button class="btn sm${on ? '' : ' primary'}" data-a="save">${on ? 'Fjern fra kartet' : '★ Behold i kartet'}</button></div>${REP}</div>`;
  }
  wirePopup(pop, grp) {
    const el = pop.getElement(); if (!el) return;
    this.wireReport(el, pop, { lon: r0(grp[0].lon), lat: r0(grp[0].lat), sp: grp.map((x) => x.sp), sc: grp.map((x) => pct(x)), mon: this.mon });
    el.querySelector('[data-a="save"]')?.addEventListener('click', () => { const was = this.savedAt(grp[0].lat, grp[0].lon); this.toggleSaved(grp); if (!was) { pop.remove(); this.draw(); } else { pop.setHTML(this.popupHTML(grp)); this.wirePopup(pop, grp); } });
  }

  // «Fikk fisk her» / «Ingen fisk her»: åpner fangstloggen med forslaget fylt inn
  wireReport(el, pop, info) {
    if (!el || !this.onReport) return;
    el.querySelector('[data-a="fikk"]')?.addEventListener('click', () => { pop.remove(); this.onReport(info, true); });
    el.querySelector('[data-a="ingen"]')?.addEventListener('click', () => { pop.remove(); this.onReport(info, false); });
  }

  /* lagrede plasser (fra algoritmeforslag) */
  savedAt(lat, lon) { return this.saved.find((s) => km([s.lat, s.lon], [lat, lon]) < 0.05); }
  toggleSaved(grp) {
    const r = grp[0], on = this.savedAt(r.lat, r.lon);
    if (on) this.saved = this.saved.filter((s) => s !== on);
    else this.saved.push(this.entry(grp));
    save('plasser', this.saved); this.drawSaved(); this.onSaved();
  }
  // alle forslag i kartutsnittet på én gang
  keepAll() {
    let n = 0;
    for (const grp of this.groups()) if (!this.savedAt(grp[0].lat, grp[0].lon)) { this.saved.push(this.entry(grp)); n++; }
    save('plasser', this.saved); this.drawSaved(); this.draw(); this.onSaved();
    return n;
  }
  entry(grp) { const r = grp[0]; return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), lat: +r.lat.toFixed(5), lon: +r.lon.toFixed(5), t: Date.now(), sp: grp.map((x) => x.sp), sc: grp.map((x) => pct(x)), fr: grp.map((x) => (x.P && x.P.fredet) || ''), d: r.fe && r.fe.d0 != null ? Math.round(r.fe.d0) : null, iv: r.ver ? [r.dA, r.dB] : null }; }
  remove(id) { this.saved = id === '*' ? [] : this.saved.filter((x) => x.id !== id); save('plasser', this.saved); this.drawSaved(); if (this.on) this.draw(); this.onSaved(); }
  flyTo(id) { const s = this.saved.find((x) => x.id === id); if (s) this.api.map.flyTo({ center: [s.lon, s.lat], zoom: Math.max(this.api.map.getZoom(), 14.5) }); }
  drawSaved() {
    this.savedMarkers.forEach((m) => m.remove()); this.savedMarkers = [];
    const ml = this.api.maplibregl;
    for (const s of this.saved) {
      const el = document.createElement('button'); el.className = 'algo-pt saved';
      el.setAttribute('aria-label', 'Lagret fiskeplass: ' + s.sp.map((k) => ART[k]?.no || k).join(', '));
      el.innerHTML = `<span style="background:${starBg(s.sp.map((k) => ART[k]?.col || '#9fb3c2'))}">★</span>`;
      const html = `<div class="pal">` + s.sp.map((k, i) => spLine({ sp: k, pct: s.sc ? s.sc[i] : null, P: { fredet: s.fr ? s.fr[i] : '' } })).join('') + depthLine(s.d, s.iv) +
        `<div class="pmut">Lagret ${new Date(s.t).toLocaleDateString('nb-NO')}</div><div class="pfoot"><button class="btn sm" data-a="del">Fjern fra kartet</button></div>${REP}</div>`;
      const pop = new ml.Popup({ maxWidth: '340px', className: 'pop algo', offset: 14 }).setHTML(html);
      pop.on('open', () => { const pe = pop.getElement(); pe?.querySelector('[data-a="del"]')?.addEventListener('click', () => { pop.remove(); this.remove(s.id); }); this.wireReport(pe, pop, { lon: s.lon, lat: s.lat, sp: s.sp, sc: s.sc || [], mon: this.mon, lagret: true }); });
      const mk = new ml.Marker({ element: el }).setLngLat([s.lon, s.lat]).setPopup(pop).addTo(this.api.map);
      el.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(mk); });
      this.savedMarkers.push(mk);
    }
  }
}

const REP = '<div class="pfoot prep"><button class="btn sm" data-a="fikk">Fikk fisk her</button><button class="btn sm" data-a="ingen">Ingen fisk her</button></div>';
const r0 = (v) => +(+v).toFixed(5);
// poeng: algoritmens poeng × 100 uten tak (før ble alt over 100 kuttet til 100, så de beste plassene så like ut)
const score = (sc) => Math.round(Math.max(0, Math.min(1, sc || 0)) * 100);
const pct = (r) => r.raw != null ? Math.round(Math.max(0, r.raw) * 100) : score(r.sc);
function spLine(r) {
  const a = ART[r.sp] || {}, fr = r.P && r.P.fredet;
  return `<div class="psp"><span class="pdot" style="background:${a.col || '#9fb3c2'}"></span><b>${esc(a.no || r.sp)}</b>` +
    (r.pct != null || r.sc != null ? `<span class="pscore" title="Algoritmens poeng (kan gå over 100)">${r.pct != null ? r.pct : pct(r)}<small> poeng</small></span>` : '') + `</div>` +
    (fr ? `<div class="pfred">${esc(fr)}</div>` : '');
}
function depthLine(d, iv) {
  const ivs = iv ? String(iv[0]).replace('.', ',') + '–' + String(iv[1]).replace('.', ',') + ' m' : '';
  if (d == null && !iv) return '';
  return `<div class="pdep">Dybde: <b>${d != null ? 'ca. ' + Math.round(d) + ' m' : ivs}</b>${d != null && iv ? ` <span class="pmut">(sjøkart ${ivs})</span>` : ''}</div>`;
}

export const SPECIES = () => Object.keys(R.algo).filter((k) => !HIDDEN.includes(k)).map((k) => ({ k, no: ART[k].no, col: ART[k].col }));

// fargeskala for fargekartet (andel 0–1 av sjøen i utsnittet med lavere poeng): blått → lyst → oransje → rødt
const HEATC = [[0, [90, 140, 220, 50]], [0.5, [150, 185, 235, 70]], [0.72, [235, 200, 170, 110]], [0.86, [240, 140, 70, 150]], [0.95, [225, 60, 45, 185]], [1, [205, 25, 35, 205]]];
function heatColor(x) {
  for (let i = 1; i < HEATC.length; i++) { const [a, ca] = HEATC[i - 1], [b, cb] = HEATC[i]; if (x <= b) { const f = (x - a) / (b - a); return ca.map((v, k) => Math.round(v + (cb[k] - v) * f)); } }
  return HEATC[HEATC.length - 1][1];
}
