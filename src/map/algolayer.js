// Fiskeplasser fra algoritmen i kartet (av/på), med forklaring per art. Plasser du velger («Behold i kartet»)
// blir liggende i kartet også når forslagene er slått av, til du fjerner dem.
import { algoRun, algoWhy, algoLines, ART, R, esc, km } from '../algo/index.js';

const plain = (h) => String(h).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const starBg = (cols) => cols.length > 1 ? 'conic-gradient(' + cols.map((c, i) => c + ' ' + Math.round(i * 100 / cols.length) + '% ' + Math.round((i + 1) * 100 / cols.length) + '%').join(',') + ')' : cols[0];
const load = (k, d) => { try { const v = localStorage.getItem('fiskesim.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem('fiskesim.' + k, JSON.stringify(v)); } catch (e) { /* privat modus */ } };

export class AlgoLayer {
  constructor(api, { onNote = () => {}, onSaved = () => {} } = {}) {
    this.api = api; this.onNote = onNote; this.onSaved = onSaved;
    this.on = load('algo', false); this.sel = load('algoSel', []); this.mon = load('algoMon', 'now');
    this.markers = []; this.saved = load('plasser', []); this.savedMarkers = [];
    this.timer = 0;
    api.map.on('moveend', () => this.schedule());
    this.drawSaved();
    if (this.on) this.schedule(50);
  }
  month() { return this.mon === 'now' ? new Date().getMonth() : +this.mon; }
  setOn(on) { this.on = on; save('algo', on); if (on) this.schedule(10); else { this.clear(); this.onNote(''); } }
  setSel(sel) { this.sel = sel; save('algoSel', sel); this.schedule(10); }
  setMonth(m) { this.mon = m; save('algoMon', m); this.schedule(10); }
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
    this.res = out.res; this.draw(); this.onNote(out.note); this.onSaved();
  }

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

  popupHTML(grp) {
    const r = grp[0], on = this.savedAt(r.lat, r.lon);
    const dep = r.ver ? `<div class="pdep">Kartverket: <b>${String(r.dA).replace('.', ',')}–${String(r.dB).replace('.', ',')} m</b>${r.dB - r.dA > 60 ? ' <span class="pmut">grovt intervall</span>' : ''}</div>` : '';
    return dep + `<div class="pfoot"><button class="btn sm${on ? '' : ' primary'}" data-a="save">${on ? 'Fjern fra kartet' : '★ Behold i kartet'}</button>${on ? '' : ' <span class="pmut">blir liggende også når forslagene er av</span>'}</div>` + grp.map(algoWhy).join('<hr class="phr">');
  }
  wirePopup(pop, grp) {
    const el = pop.getElement(); if (!el) return;
    el.querySelector('[data-a="save"]')?.addEventListener('click', () => { const was = this.savedAt(grp[0].lat, grp[0].lon); this.toggleSaved(grp); if (!was) { pop.remove(); this.draw(); } else { pop.setHTML(this.popupHTML(grp)); this.wirePopup(pop, grp); } });
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
  entry(grp) { const r = grp[0]; return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), lat: +r.lat.toFixed(5), lon: +r.lon.toFixed(5), t: Date.now(), sp: grp.map((x) => x.sp), why: grp.map((x) => ({ sp: x.sp, l: algoLines(x).map(plain) })) }; }
  remove(id) { this.saved = id === '*' ? [] : this.saved.filter((x) => x.id !== id); save('plasser', this.saved); this.drawSaved(); if (this.on) this.draw(); this.onSaved(); }
  flyTo(id) { const s = this.saved.find((x) => x.id === id); if (s) this.api.map.flyTo({ center: [s.lon, s.lat], zoom: Math.max(this.api.map.getZoom(), 14.5) }); }
  drawSaved() {
    this.savedMarkers.forEach((m) => m.remove()); this.savedMarkers = [];
    const ml = this.api.maplibregl;
    for (const s of this.saved) {
      const el = document.createElement('button'); el.className = 'algo-pt saved';
      el.setAttribute('aria-label', 'Lagret fiskeplass: ' + s.sp.map((k) => ART[k]?.no || k).join(', '));
      el.innerHTML = `<span style="background:${starBg(s.sp.map((k) => ART[k]?.col || '#9fb3c2'))}">★</span>`;
      const html = `<div class="pal"><b>Min plass: ${esc(s.sp.map((k) => ART[k]?.no || k).join(', '))}</b><br><span class="pmut">${new Date(s.t).toLocaleDateString('nb-NO')} · ${s.lat.toFixed(4).replace('.', ',')} N, ${s.lon.toFixed(4).replace('.', ',')} Ø</span>` +
        s.why.map((w) => `<p style="margin:8px 0 2px"><b>${esc(ART[w.sp]?.no || w.sp)}</b></p><ul class="pul">${w.l.map((x) => `<li${/^Fredet nå/.test(x) ? ' class="fred"' : ''}>${esc(x)}</li>`).join('')}</ul>`).join('') +
        `<div class="pfoot"><button class="btn sm" data-a="del">Fjern fra kartet</button></div></div>`;
      const pop = new ml.Popup({ maxWidth: '340px', className: 'pop algo', offset: 14 }).setHTML(html);
      pop.on('open', () => pop.getElement()?.querySelector('[data-a="del"]')?.addEventListener('click', () => { pop.remove(); this.remove(s.id); }));
      const mk = new ml.Marker({ element: el }).setLngLat([s.lon, s.lat]).setPopup(pop).addTo(this.api.map);
      el.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(mk); });
      this.savedMarkers.push(mk);
    }
  }
}

export const SPECIES = () => Object.keys(R.algo).map((k) => ({ k, no: ART[k].no, col: ART[k].col }));
